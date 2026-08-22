import type {
  EvidenceDescriptor,
  TelemetryEvidenceReference,
} from './evidence.js';
import type { Unsubscribe } from './subscription.js';
import type { DistillationFailureReason } from './distillation-failure.js';

export const TELEMETRY_SCHEMA_VERSION = 1 as const;

export type TelemetryWave = 'afferent' | 'cognitive';
export type TelemetryOutcome = 'success' | 'failure' | 'skipped';

export type InferenceStage =
  | 'node-relevance'
  | 'node-generation'
  | 'attention-ranking'
  | 'primary-distillation'
  | 'fallback-selection'
  | 'configured-selection'
  | 'tool-elaboration'
  | 'node-splitting'
  | 'sensor-generation'
  | 'startup-summary'
  | 'provider-generate'
  | 'provider-select-best'
  | 'provider-rank-relevance'
  | 'provider-yes-no'
  | 'provider-split'
  | 'provider-generate-tools';

export interface TelemetryContext {
  readonly epochId?: string;
  readonly wave?: TelemetryWave;
  readonly candidateId?: string;
  readonly nodeId?: string;
  readonly parentSpanId?: string;
}

export interface EpochTelemetryContext extends TelemetryContext {
  readonly epochId: string;
}

export interface CandidateTelemetryContext extends EpochTelemetryContext {
  readonly wave: TelemetryWave;
  readonly candidateId: string;
  readonly nodeId: string;
}

export interface InferenceContext extends TelemetryContext {
  readonly stage: InferenceStage;
}

export interface EpochCounts {
  readonly generated: number;
  readonly attentionPassed: number;
  readonly selected: number;
}

export interface WaveCounts {
  readonly afferent: EpochCounts;
  readonly cognitive: EpochCounts;
}

export interface TelemetryEventDataMap {
  readonly 'run.started': Readonly<Record<string, never>>;
  readonly 'run.completed': {
    readonly status: Extract<TelemetryOutcome, 'success' | 'failure'>;
  };
  readonly 'epoch.started': {
    readonly inputIds: readonly string[];
  };
  readonly 'epoch.completed': {
    readonly status: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly counts: EpochCounts;
    readonly waveCounts: WaveCounts;
    readonly inferenceCount: number;
    readonly toolCallCount: number;
    readonly totalProviderDurationMs: number;
    readonly criticalPathDurationMs: number;
  };
  readonly 'candidate.generated': {
    readonly candidateId: string;
    readonly originatingNodeId: string;
    readonly wave: TelemetryWave;
    readonly contentHash: string;
    readonly evidence: readonly EvidenceDescriptor[];
    readonly inputIds: readonly string[];
  };
  readonly 'candidate.outcome': {
    readonly candidateId: string;
    readonly originatingNodeId: string;
    readonly wave: TelemetryWave;
    readonly attentionOutcome: 'bypassed' | 'passed' | 'rejected';
    readonly selectionOutcome:
      'selected' | 'supporting-evidence' | 'not-selected';
  };
  readonly 'inference.completed': {
    readonly inferenceId: string;
    readonly stage: InferenceStage;
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly errorCategory?: string;
  };
  readonly 'relevance.completed': {
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly topN: number | 'all';
    readonly rankedCandidateIds: readonly string[];
    readonly survivorCandidateIds: readonly string[];
    readonly errorCategory?: string;
  };
  readonly 'distillation.attempt-completed': {
    readonly attemptId: string;
    readonly attempt: 'primary' | 'fallback' | 'configured';
    readonly strategy: 'synthesize' | 'select-best';
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly candidateIds: readonly string[];
    readonly selectedCandidateIds: readonly string[];
    readonly evidence: readonly TelemetryEvidenceReference[];
    readonly actionDisposition: 'scheduled' | 'none';
    readonly errorCategory?: string;
    /** Bounded semantic reason, when a failed strategy produced one. */
    readonly failureReason?: DistillationFailureReason;
  };
  readonly 'distillation.fallback-activated': {
    readonly failedAttemptId: string;
    readonly errorCategory: string;
    readonly failureReason?: DistillationFailureReason;
  };
  readonly 'tool.elaboration-completed': {
    readonly requestId: string;
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly callIds: readonly string[];
    readonly errorCategory?: string;
  };
  readonly 'tool.invocation-completed': {
    readonly requestId: string;
    readonly callId: string;
    readonly toolName: string;
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly evidence?: EvidenceDescriptor;
    readonly errorCategory?: string;
  };
  readonly 'node.split-completed': {
    readonly parentNodeId: string;
    readonly childNodeIds: readonly [string, string] | readonly [];
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly errorCategory?: string;
  };
  readonly 'persistence.completed': {
    readonly operation: 'read' | 'write' | 'delete';
    readonly target: string;
    readonly durationMs: number;
    readonly outcome: Extract<TelemetryOutcome, 'success' | 'failure'>;
    readonly errorCategory?: string;
  };
  readonly 'user-input.received': {
    readonly inputId: string;
    readonly contentHash: string;
  };
  readonly 'user-input.consumed': {
    readonly inputId: string;
    readonly latencyMs: number;
  };
  readonly 'user-input.broadcast-selected': {
    readonly inputId: string;
    readonly latencyMs: number;
    readonly broadcastHash: string;
  };
  readonly 'error.reported': {
    readonly source: string;
    readonly message: string;
    readonly errorCategory: string;
    readonly diagnostics?: unknown;
  };
  readonly 'system.notice': {
    readonly message: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
}

export type TelemetryEventType = keyof TelemetryEventDataMap;

type CandidateTelemetryEvent =
  | 'candidate.generated'
  | 'candidate.outcome'
  | 'tool.elaboration-completed'
  | 'tool.invocation-completed';

type EpochTelemetryEvent =
  | 'epoch.started'
  | 'epoch.completed'
  | 'relevance.completed'
  | 'distillation.attempt-completed'
  | 'distillation.fallback-activated'
  | 'node.split-completed'
  | 'user-input.consumed'
  | 'user-input.broadcast-selected';

export type TelemetryEventContext<Type extends TelemetryEventType> =
  Type extends CandidateTelemetryEvent
    ? CandidateTelemetryContext
    : Type extends EpochTelemetryEvent
      ? EpochTelemetryContext
      : TelemetryContext;

type TelemetryEventEnvelope<Type extends TelemetryEventType> = {
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly sequence: number;
  readonly timestamp: string;
  /** Milliseconds since this recorder was created, from a monotonic clock. */
  readonly monotonicMs: number;
  readonly runId: string;
  readonly event: Type;
  readonly spanId?: string;
  readonly data: TelemetryEventDataMap[Type];
} & TelemetryEventContext<Type>;

export type TelemetryEvent<
  Type extends TelemetryEventType = TelemetryEventType,
> = {
  readonly [Name in Type]: TelemetryEventEnvelope<Name>;
}[Type];

export interface TelemetryStream {
  readonly subscribe: (
    receiver: (event: TelemetryEvent) => void,
  ) => Unsubscribe;
}

export interface TelemetryClock {
  readonly wallNow: () => Date;
  readonly monotonicNow: () => number;
}

export interface TelemetryIdFactory {
  readonly create: (kind: string) => string;
}

export interface TelemetrySpan {
  readonly spanId: string;
  readonly startedAtMs: number;
}
