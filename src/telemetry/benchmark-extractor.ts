import type {
  EpochCounts,
  TelemetryEvent,
  TelemetryEventType,
  WaveCounts,
} from '../types/telemetry.js';
import { TELEMETRY_SCHEMA_VERSION } from '../types/telemetry.js';

export interface EpochSummary {
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly runId: string;
  readonly epochId: string;
  readonly status: 'success' | 'failure';
  readonly counts: EpochCounts;
  readonly waveCounts: WaveCounts;
  readonly inferenceCount: number;
  readonly toolCallCount: number;
  readonly totalProviderDurationMs: number;
  readonly criticalPathDurationMs: number;
  readonly fallbackActivated: boolean;
  readonly distillationAttempts: number;
}

export type CandidateBenchmarkLabel =
  'search' | 'clarification' | 'unsupported-answer' | 'other';

export interface GroundedSelectionScore {
  readonly success: boolean;
  readonly harmfulSelection: boolean;
  readonly selectedCandidateIds: readonly string[];
  readonly safeAttentionSurvivorIds: readonly string[];
}

export const parseTelemetryJsonl = (contents: string): TelemetryEvent[] =>
  contents
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        throw new Error(
          `[TelemetryExtractor] line ${index + 1} is not valid JSON`,
        );
      }
      if (!isTelemetryEvent(parsed)) {
        throw new Error(
          `[TelemetryExtractor] line ${index + 1} is not a telemetry v1 event`,
        );
      }
      return parsed;
    });

export const extractEpochSummaries = (
  events: readonly TelemetryEvent[],
): EpochSummary[] => {
  if (events.length === 0) {
    return [];
  }
  const byRun = new Map<string, TelemetryEvent[]>();
  events.forEach((event) => {
    if (event.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
      throw new Error('[TelemetryExtractor] unsupported schema version');
    }
    const runEvents = byRun.get(event.runId) ?? [];
    runEvents.push(event);
    byRun.set(event.runId, runEvents);
  });

  return [...byRun.entries()].flatMap(([runId, runEvents]) =>
    extractRunEpochSummaries(runId, runEvents),
  );
};

const extractRunEpochSummaries = (
  runId: string,
  events: readonly TelemetryEvent[],
): EpochSummary[] => {
  const sequences = new Set<number>();
  const byEpoch = new Map<string, TelemetryEvent[]>();
  [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((event) => {
      if (sequences.has(event.sequence)) {
        throw new Error(
          `[TelemetryExtractor] duplicate event sequence in run ${runId}`,
        );
      }
      sequences.add(event.sequence);
      if (event.epochId === undefined) {
        return;
      }
      const epochEvents = byEpoch.get(event.epochId) ?? [];
      epochEvents.push(event);
      byEpoch.set(event.epochId, epochEvents);
    });
  return [...byEpoch.entries()].map(([epochId, epochEvents]) =>
    extractEpochSummary(runId, epochId, epochEvents),
  );
};

export const scoreGroundedSelection = (
  events: readonly TelemetryEvent[],
  epochId: string,
  labels: Readonly<Record<string, CandidateBenchmarkLabel>>,
): GroundedSelectionScore => {
  const outcomes = eventsOfType(
    events.filter((event) => event.epochId === epochId),
    'candidate.outcome',
  );
  const selectedCandidateIds = outcomes.flatMap((event) =>
    event.data.selectionOutcome === 'selected' ? [event.data.candidateId] : [],
  );
  const safeAttentionSurvivorIds = outcomes.flatMap((event) =>
    event.data.attentionOutcome === 'passed' &&
    (labels[event.data.candidateId] === 'search' ||
      labels[event.data.candidateId] === 'clarification')
      ? [event.data.candidateId]
      : [],
  );
  const harmfulSelection =
    safeAttentionSurvivorIds.length > 0 &&
    selectedCandidateIds.some(
      (candidateId) => labels[candidateId] === 'unsupported-answer',
    );
  const success =
    !harmfulSelection &&
    selectedCandidateIds.some((candidateId) => {
      const label = labels[candidateId];
      return label === 'search' || label === 'clarification';
    });
  return {
    success,
    harmfulSelection,
    selectedCandidateIds,
    safeAttentionSurvivorIds,
  };
};

const extractEpochSummary = (
  runId: string,
  epochId: string,
  events: readonly TelemetryEvent[],
): EpochSummary => {
  const started = exactlyOne(events, 'epoch.started');
  const completed = exactlyOne(events, 'epoch.completed');
  const generated = eventsOfType(events, 'candidate.generated');
  const outcomes = eventsOfType(events, 'candidate.outcome');
  const inferences = eventsOfType(events, 'inference.completed');
  const tools = eventsOfType(events, 'tool.invocation-completed');
  const relevanceEvents = eventsOfType(events, 'relevance.completed');
  if (relevanceEvents.length > 1) {
    throw new Error(
      '[TelemetryExtractor] expected at most one relevance.completed event',
    );
  }
  const relevance = relevanceEvents[0];

  requireCandidateLifecycles(generated, outcomes);
  const cognitiveCandidateIds = generated
    .filter((event) => event.data.wave === 'cognitive')
    .map((event) => event.data.candidateId);
  if (relevance?.data.outcome === 'success') {
    requireSameIds(
      'ranked candidate IDs',
      relevance.data.rankedCandidateIds,
      cognitiveCandidateIds,
    );
  }
  if (relevance !== undefined) {
    requireSameIds(
      'attention survivor IDs',
      relevance.data.survivorCandidateIds,
      outcomes.flatMap((event) =>
        event.data.wave === 'cognitive' &&
        event.data.attentionOutcome === 'passed'
          ? [event.data.candidateId]
          : [],
      ),
    );
  }

  const afferentCounts = waveCounts('afferent', generated, outcomes);
  const cognitiveCounts = waveCounts('cognitive', generated, outcomes);
  const counts: EpochCounts = {
    generated: afferentCounts.generated + cognitiveCounts.generated,
    attentionPassed:
      afferentCounts.attentionPassed + cognitiveCounts.attentionPassed,
    selected: cognitiveCounts.selected,
  };
  const totalProviderDurationMs = inferences.reduce(
    (total, event) => total + event.data.durationMs,
    0,
  );
  const criticalPathDurationMs = Math.max(
    0,
    completed.monotonicMs - started.monotonicMs,
  );
  requireEqual('candidate counts', completed.data.counts, counts);
  requireEqual('wave counts', completed.data.waveCounts, {
    afferent: afferentCounts,
    cognitive: cognitiveCounts,
  });
  if (
    completed.data.inferenceCount !== inferences.length ||
    completed.data.toolCallCount !== tools.length ||
    !approximatelyEqual(
      completed.data.totalProviderDurationMs,
      totalProviderDurationMs,
    ) ||
    !approximatelyEqual(
      completed.data.criticalPathDurationMs,
      criticalPathDurationMs,
    )
  ) {
    throw new Error('[TelemetryExtractor] emitted epoch metrics do not derive');
  }
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    runId,
    epochId,
    status: completed.data.status,
    counts,
    waveCounts: {
      afferent: afferentCounts,
      cognitive: cognitiveCounts,
    },
    inferenceCount: inferences.length,
    toolCallCount: tools.length,
    totalProviderDurationMs,
    criticalPathDurationMs,
    fallbackActivated: events.some(
      (event) => event.event === 'distillation.fallback-activated',
    ),
    distillationAttempts: events.filter(
      (event) => event.event === 'distillation.attempt-completed',
    ).length,
  };
};

const waveCounts = (
  wave: 'afferent' | 'cognitive',
  generated: readonly TelemetryEvent<'candidate.generated'>[],
  outcomes: readonly TelemetryEvent<'candidate.outcome'>[],
): EpochCounts => ({
  generated: generated.filter((event) => event.data.wave === wave).length,
  attentionPassed: outcomes.filter(
    (event) =>
      event.data.wave === wave && event.data.attentionOutcome !== 'rejected',
  ).length,
  selected: outcomes.filter(
    (event) =>
      event.data.wave === wave && event.data.selectionOutcome === 'selected',
  ).length,
});

const exactlyOne = <Type extends 'epoch.started' | 'epoch.completed'>(
  events: readonly TelemetryEvent[],
  type: Type,
): TelemetryEvent<Type> => {
  const matches = eventsOfType(events, type);
  if (matches.length !== 1) {
    throw new Error(`[TelemetryExtractor] expected one ${type} event`);
  }
  return matches[0]!;
};

const requireCandidateLifecycles = (
  generated: readonly TelemetryEvent<'candidate.generated'>[],
  outcomes: readonly TelemetryEvent<'candidate.outcome'>[],
): void => {
  const generatedById = new Map(
    generated.map((event) => [event.data.candidateId, event] as const),
  );
  if (
    generatedById.size !== generated.length ||
    outcomes.length !== generated.length
  ) {
    throw new Error('[TelemetryExtractor] candidate lifecycles are incomplete');
  }
  outcomes.forEach((outcome) => {
    const source = generatedById.get(outcome.data.candidateId);
    if (
      source === undefined ||
      source.data.originatingNodeId !== outcome.data.originatingNodeId ||
      source.data.wave !== outcome.data.wave
    ) {
      throw new Error(
        '[TelemetryExtractor] candidate lifecycle correlation differs',
      );
    }
  });
};

const requireSameIds = (
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void => {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expected.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some((id) => !expectedSet.has(id))
  ) {
    throw new Error(`[TelemetryExtractor] ${label} do not derive`);
  }
};

const eventsOfType = <Type extends TelemetryEventType>(
  events: readonly TelemetryEvent[],
  type: Type,
): TelemetryEvent<Type>[] =>
  events
    .filter((event) => event.event === type)
    .map((event) => event as unknown as TelemetryEvent<Type>);

const requireEqual = (label: string, left: unknown, right: unknown): void => {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`[TelemetryExtractor] emitted ${label} do not derive`);
  }
};

const approximatelyEqual = (left: number, right: number): boolean => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * Number.EPSILON * 16;
};

const isTelemetryEvent = (value: unknown): value is TelemetryEvent =>
  isRecord(value) &&
  value['schemaVersion'] === TELEMETRY_SCHEMA_VERSION &&
  isNonNegativeInteger(value['sequence']) &&
  typeof value['timestamp'] === 'string' &&
  !Number.isNaN(Date.parse(value['timestamp'])) &&
  isNonNegativeNumber(value['monotonicMs']) &&
  typeof value['runId'] === 'string' &&
  typeof value['event'] === 'string' &&
  isTelemetryEventType(value['event']) &&
  isRecord(value['data']) &&
  isOptionalString(value['spanId']) &&
  isOptionalString(value['parentSpanId']) &&
  hasRequiredContext(value, value['event']) &&
  isEventData(value['event'], value['data']) &&
  hasConsistentContext(value, value['event'], value['data']);

const isTelemetryEventType = (value: string): value is TelemetryEventType =>
  TELEMETRY_EVENT_TYPES.has(value as TelemetryEventType);

const TELEMETRY_EVENT_TYPES: ReadonlySet<TelemetryEventType> = new Set([
  'run.started',
  'run.completed',
  'epoch.started',
  'epoch.completed',
  'candidate.generated',
  'candidate.outcome',
  'inference.completed',
  'relevance.completed',
  'distillation.attempt-completed',
  'distillation.fallback-activated',
  'tool.elaboration-completed',
  'tool.invocation-completed',
  'node.split-completed',
  'persistence.completed',
  'user-input.received',
  'user-input.consumed',
  'user-input.broadcast-selected',
  'error.reported',
  'system.notice',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasRequiredContext = (
  value: Record<string, unknown>,
  event: TelemetryEventType,
): boolean => {
  const hasEpoch = typeof value['epochId'] === 'string';
  const hasCandidate =
    hasEpoch &&
    (value['wave'] === 'afferent' || value['wave'] === 'cognitive') &&
    typeof value['candidateId'] === 'string' &&
    typeof value['nodeId'] === 'string';
  if (CANDIDATE_CONTEXT_EVENTS.has(event) && !hasCandidate) {
    return false;
  }
  if (EPOCH_CONTEXT_EVENTS.has(event) && !hasEpoch) {
    return false;
  }
  if (NODE_CONTEXT_EVENTS.has(event) && typeof value['nodeId'] !== 'string') {
    return false;
  }
  const hasPartialCandidateContext =
    value['wave'] !== undefined || value['candidateId'] !== undefined;
  return !hasPartialCandidateContext || hasCandidate;
};

const hasConsistentContext = (
  envelope: Record<string, unknown>,
  event: TelemetryEventType,
  data: Record<string, unknown>,
): boolean => {
  if (event === 'candidate.generated' || event === 'candidate.outcome') {
    return (
      envelope['candidateId'] === data['candidateId'] &&
      envelope['nodeId'] === data['originatingNodeId'] &&
      envelope['wave'] === data['wave']
    );
  }
  return (
    event !== 'node.split-completed' ||
    envelope['nodeId'] === data['parentNodeId']
  );
};

const isEventData = (
  event: TelemetryEventType,
  data: Record<string, unknown>,
): boolean => {
  switch (event) {
    case 'run.started':
      return Object.keys(data).length === 0;
    case 'run.completed':
      return isOneOf(data['status'], ['success', 'failure']);
    case 'epoch.started':
      return isStringArray(data['inputIds']);
    case 'epoch.completed':
      return (
        isOneOf(data['status'], ['success', 'failure']) &&
        isEpochCounts(data['counts']) &&
        isWaveCounts(data['waveCounts']) &&
        isNonNegativeInteger(data['inferenceCount']) &&
        isNonNegativeInteger(data['toolCallCount']) &&
        isNonNegativeNumber(data['totalProviderDurationMs']) &&
        isNonNegativeNumber(data['criticalPathDurationMs'])
      );
    case 'candidate.generated':
      return (
        hasCandidateIdentity(data) &&
        typeof data['contentHash'] === 'string' &&
        isEvidenceArray(data['evidence']) &&
        isStringArray(data['inputIds'])
      );
    case 'candidate.outcome':
      return (
        hasCandidateIdentity(data) &&
        isOneOf(data['attentionOutcome'], ['bypassed', 'passed', 'rejected']) &&
        isOneOf(data['selectionOutcome'], [
          'selected',
          'supporting-evidence',
          'not-selected',
        ])
      );
    case 'inference.completed':
      return (
        typeof data['inferenceId'] === 'string' &&
        isOneOf(data['stage'], INFERENCE_STAGES) &&
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs'])
      );
    case 'relevance.completed':
      return (
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs']) &&
        (data['topN'] === 'all' || isNonNegativeInteger(data['topN'])) &&
        isStringArray(data['rankedCandidateIds']) &&
        isStringArray(data['survivorCandidateIds'])
      );
    case 'distillation.attempt-completed':
      return (
        typeof data['attemptId'] === 'string' &&
        isOneOf(data['attempt'], ['primary', 'fallback', 'configured']) &&
        isOneOf(data['strategy'], ['synthesize', 'select-best']) &&
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs']) &&
        isStringArray(data['candidateIds']) &&
        isStringArray(data['selectedCandidateIds']) &&
        isTelemetryEvidenceArray(data['evidence']) &&
        isOneOf(data['actionDisposition'], ['scheduled', 'none'])
      );
    case 'distillation.fallback-activated':
      return (
        typeof data['failedAttemptId'] === 'string' &&
        typeof data['errorCategory'] === 'string'
      );
    case 'tool.elaboration-completed':
      return (
        typeof data['requestId'] === 'string' &&
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs']) &&
        isStringArray(data['callIds'])
      );
    case 'tool.invocation-completed':
      return (
        typeof data['requestId'] === 'string' &&
        typeof data['callId'] === 'string' &&
        typeof data['toolName'] === 'string' &&
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs']) &&
        (data['evidence'] === undefined || isEvidence(data['evidence']))
      );
    case 'node.split-completed':
      return (
        typeof data['parentNodeId'] === 'string' &&
        Array.isArray(data['childNodeIds']) &&
        (data['childNodeIds'].length === 0 ||
          (data['childNodeIds'].length === 2 &&
            isStringArray(data['childNodeIds']))) &&
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs'])
      );
    case 'persistence.completed':
      return (
        isOneOf(data['operation'], ['read', 'write', 'delete']) &&
        typeof data['target'] === 'string' &&
        hasCompletion(data) &&
        isNonNegativeNumber(data['durationMs'])
      );
    case 'user-input.received':
      return (
        typeof data['inputId'] === 'string' &&
        typeof data['contentHash'] === 'string'
      );
    case 'user-input.consumed':
      return (
        typeof data['inputId'] === 'string' &&
        isNonNegativeNumber(data['latencyMs'])
      );
    case 'user-input.broadcast-selected':
      return (
        typeof data['inputId'] === 'string' &&
        isNonNegativeNumber(data['latencyMs']) &&
        typeof data['broadcastHash'] === 'string'
      );
    case 'error.reported':
      return (
        typeof data['source'] === 'string' &&
        typeof data['message'] === 'string' &&
        typeof data['errorCategory'] === 'string'
      );
    case 'system.notice':
      return (
        typeof data['message'] === 'string' &&
        (data['metadata'] === undefined || isRecord(data['metadata']))
      );
  }
};

const hasCandidateIdentity = (data: Record<string, unknown>): boolean =>
  typeof data['candidateId'] === 'string' &&
  typeof data['originatingNodeId'] === 'string' &&
  isOneOf(data['wave'], ['afferent', 'cognitive']);

const hasCompletion = (data: Record<string, unknown>): boolean =>
  data['outcome'] === 'success'
    ? data['errorCategory'] === undefined
    : data['outcome'] === 'failure' &&
      typeof data['errorCategory'] === 'string';

const isEpochCounts = (value: unknown): value is EpochCounts =>
  isRecord(value) &&
  isNonNegativeInteger(value['generated']) &&
  isNonNegativeInteger(value['attentionPassed']) &&
  isNonNegativeInteger(value['selected']);

const isWaveCounts = (value: unknown): value is WaveCounts =>
  isRecord(value) &&
  isEpochCounts(value['afferent']) &&
  isEpochCounts(value['cognitive']);

const isEvidence = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  typeof value['contentHash'] === 'string' &&
  (value['sourceUrls'] === undefined || isStringArray(value['sourceUrls'])) &&
  (value['artifactReferences'] === undefined ||
    isStringArray(value['artifactReferences']));

const isEvidenceArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every(isEvidence);

const isTelemetryEvidenceArray = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (reference) =>
      isEvidence(reference) &&
      isRecord(reference) &&
      isOneOf(reference['source'], ['candidate', 'afferent']) &&
      isNonNegativeInteger(reference['index']),
  );

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

const isOneOf = <Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value =>
  typeof value === 'string' && allowed.includes(value as Value);

const INFERENCE_STAGES = [
  'node-relevance',
  'node-generation',
  'attention-ranking',
  'primary-distillation',
  'fallback-selection',
  'configured-selection',
  'tool-elaboration',
  'node-splitting',
  'sensor-generation',
  'startup-summary',
  'provider-generate',
  'provider-select-best',
  'provider-rank-relevance',
  'provider-yes-no',
  'provider-split',
  'provider-generate-tools',
] as const;

const CANDIDATE_CONTEXT_EVENTS: ReadonlySet<TelemetryEventType> = new Set([
  'candidate.generated',
  'candidate.outcome',
  'tool.elaboration-completed',
  'tool.invocation-completed',
]);

const EPOCH_CONTEXT_EVENTS: ReadonlySet<TelemetryEventType> = new Set([
  'epoch.started',
  'epoch.completed',
  'relevance.completed',
  'distillation.attempt-completed',
  'distillation.fallback-activated',
  'node.split-completed',
  'user-input.consumed',
  'user-input.broadcast-selected',
]);

const NODE_CONTEXT_EVENTS: ReadonlySet<TelemetryEventType> = new Set([
  'node.split-completed',
]);
