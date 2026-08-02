import { describe, expect, it } from 'vitest';
import type {
  TelemetryClock,
  TelemetryEvent,
  TelemetryEventType,
} from '../types/telemetry.js';
import { TelemetryRecorder } from './telemetry-recorder.js';
import {
  extractEpochSummaries,
  parseTelemetryJsonl,
  scoreGroundedSelection,
} from './benchmark-extractor.js';

const recorderFixture = (runId = 'run-1') => {
  let monotonic = 0;
  let id = 0;
  const clock: TelemetryClock = {
    wallNow: () => new Date('2026-08-02T00:00:00.000Z'),
    monotonicNow: () => monotonic,
  };
  const recorder = new TelemetryRecorder({
    runId,
    clock,
    idFactory: { create: (kind) => `${kind}-${++id}` },
  });
  const events: TelemetryEvent[] = [];
  recorder.subscribe((event) => events.push(event));
  return {
    recorder,
    events,
    advance: (duration: number) => {
      monotonic += duration;
    },
  };
};

describe('benchmark telemetry extraction', () => {
  it('derives and verifies a complete epoch summary deterministically', () => {
    const { recorder, events, advance } = recorderFixture();
    const epoch = recorder.beginEpoch(['input-1']);
    recordCandidate(
      recorder,
      epoch.epochId,
      'afferent-1',
      'sensor-1',
      'afferent',
    );
    recordCandidate(
      recorder,
      epoch.epochId,
      'candidate-1',
      'memory-1',
      'cognitive',
    );
    recordCandidate(
      recorder,
      epoch.epochId,
      'candidate-2',
      'memory-2',
      'cognitive',
    );
    recordOutcome(
      recorder,
      epoch.epochId,
      'afferent-1',
      'sensor-1',
      'afferent',
      'bypassed',
      'supporting-evidence',
    );
    recordOutcome(
      recorder,
      epoch.epochId,
      'candidate-1',
      'memory-1',
      'cognitive',
      'passed',
      'selected',
    );
    recordOutcome(
      recorder,
      epoch.epochId,
      'candidate-2',
      'memory-2',
      'cognitive',
      'rejected',
      'not-selected',
    );
    recorder.record(
      'inference.completed',
      {
        inferenceId: 'inference-1',
        stage: 'attention-ranking',
        durationMs: 7,
        outcome: 'success',
      },
      epoch,
    );
    recorder.record(
      'tool.invocation-completed',
      {
        requestId: 'request-1',
        callId: 'call-1',
        toolName: 'search',
        durationMs: 3,
        outcome: 'success',
      },
      {
        ...epoch,
        wave: 'cognitive',
        candidateId: 'candidate-tool',
        nodeId: 'tool-node',
      },
    );
    recorder.record(
      'distillation.fallback-activated',
      { failedAttemptId: 'attempt-1', errorCategory: 'TypeError' },
      epoch,
    );
    advance(20);
    recorder.completeEpoch(epoch, {
      status: 'success',
      counts: { generated: 3, attentionPassed: 2, selected: 1 },
      waveCounts: {
        afferent: { generated: 1, attentionPassed: 1, selected: 0 },
        cognitive: { generated: 2, attentionPassed: 1, selected: 1 },
      },
    });

    expect(extractEpochSummaries(events)).toEqual([
      {
        schemaVersion: 1,
        runId: 'run-1',
        epochId: epoch.epochId,
        status: 'success',
        counts: { generated: 3, attentionPassed: 2, selected: 1 },
        waveCounts: {
          afferent: { generated: 1, attentionPassed: 1, selected: 0 },
          cognitive: { generated: 2, attentionPassed: 1, selected: 1 },
        },
        inferenceCount: 1,
        toolCallCount: 1,
        totalProviderDurationMs: 7,
        criticalPathDurationMs: 20,
        fallbackActivated: true,
        distillationAttempts: 0,
      },
    ]);
    const jsonl = events.map((event) => JSON.stringify(event)).join('\n');
    expect(parseTelemetryJsonl(`\n${jsonl}\n`)).toEqual(events);
    expect(() =>
      extractEpochSummaries(
        events.map((event) =>
          event.event === 'epoch.completed'
            ? {
                ...event,
                data: { ...event.data, criticalPathDurationMs: 999 },
              }
            : event,
        ),
      ),
    ).toThrow('epoch metrics do not derive');
  });

  it('scores the local-events harmful-selection regression', () => {
    const { recorder, events } = recorderFixture();
    const epoch = recorder.beginEpoch();
    const ids = Array.from({ length: 9 }, (_, index) => `candidate-${index}`);
    ids.forEach((id) =>
      recordCandidate(recorder, epoch.epochId, id, `memory-${id}`, 'cognitive'),
    );
    ids.forEach((id, index) =>
      recordOutcome(
        recorder,
        epoch.epochId,
        id,
        `memory-${id}`,
        'cognitive',
        index === 0 || index === 8 ? 'passed' : 'rejected',
        index === 8 ? 'selected' : 'not-selected',
      ),
    );
    recorder.completeEpoch(epoch, {
      status: 'success',
      counts: { generated: 9, attentionPassed: 2, selected: 1 },
      waveCounts: {
        afferent: { generated: 0, attentionPassed: 0, selected: 0 },
        cognitive: { generated: 9, attentionPassed: 2, selected: 1 },
      },
    });

    expect(
      scoreGroundedSelection(events, epoch.epochId, {
        'candidate-0': 'search',
        'candidate-8': 'unsupported-answer',
      }),
    ).toEqual({
      success: false,
      harmfulSelection: true,
      selectedCandidateIds: ['candidate-8'],
      safeAttentionSurvivorIds: ['candidate-0'],
    });
    expect(
      scoreGroundedSelection(events, epoch.epochId, {
        'candidate-0': 'search',
        'candidate-8': 'clarification',
      }).success,
    ).toBe(true);
  });

  it('rejects malformed JSONL and inconsistent extraction input', () => {
    expect(parseTelemetryJsonl('')).toEqual([]);
    const runOnly = recorderFixture();
    runOnly.recorder.startRun();
    expect(extractEpochSummaries(runOnly.events)).toEqual([]);
    expect(() => parseTelemetryJsonl('{')).toThrow('not valid JSON');
    expect(() => parseTelemetryJsonl('{}')).toThrow('not a telemetry v1 event');
    expect(extractEpochSummaries([])).toEqual([]);

    const first = recorderFixture('run-1');
    const second = recorderFixture('run-2');
    first.recorder.startRun();
    second.recorder.startRun();
    expect(extractEpochSummaries([...first.events, ...second.events])).toEqual(
      [],
    );

    const duplicate = [first.events[0]!, { ...first.events[0]! }];
    expect(() => extractEpochSummaries(duplicate)).toThrow(
      'duplicate event sequence in run run-1',
    );
    const unsupported = {
      ...first.events[0]!,
      schemaVersion: 2,
    } as unknown as TelemetryEvent;
    expect(() => extractEpochSummaries([unsupported])).toThrow(
      'unsupported schema version',
    );

    const malformedRelevance = recorderFixture();
    const epoch = malformedRelevance.recorder.beginEpoch();
    malformedRelevance.recorder.record(
      'relevance.completed',
      {
        durationMs: 1,
        outcome: 'success',
        topN: 1,
        rankedCandidateIds: ['candidate-1'],
        survivorCandidateIds: ['candidate-1'],
      },
      epoch,
    );
    expect(
      parseTelemetryJsonl(
        malformedRelevance.events
          .map((event) => JSON.stringify(event))
          .join('\n'),
      ),
    ).toEqual(malformedRelevance.events);
    const corrupted = {
      ...malformedRelevance.events[1]!,
      data: {
        ...malformedRelevance.events[1]!.data,
        survivorCandidateIds: '[Circular]',
      },
    };
    expect(() => parseTelemetryJsonl(JSON.stringify(corrupted))).toThrow(
      'not a telemetry v1 event',
    );
  });

  it('parses every telemetry v1 payload and optional shape', () => {
    const records = validTelemetryRecords();

    expect(
      parseTelemetryJsonl(
        records.map((record) => JSON.stringify(record)).join('\n'),
      ),
    ).toHaveLength(records.length);
  });

  it('rejects invalid telemetry envelopes and correlation contexts', () => {
    const baseline = validTelemetryRecord('run.started', {});
    const invalidEnvelopes = [
      { ...baseline, schemaVersion: 2 },
      { ...baseline, sequence: '0' },
      { ...baseline, sequence: 0.5 },
      { ...baseline, sequence: -1 },
      { ...baseline, timestamp: 1 },
      { ...baseline, timestamp: 'not-a-date' },
      { ...baseline, monotonicMs: '0' },
      { ...baseline, monotonicMs: Number.POSITIVE_INFINITY },
      { ...baseline, monotonicMs: -1 },
      { ...baseline, runId: 1 },
      { ...baseline, event: 'unknown' },
      { ...baseline, data: [] },
      { ...baseline, spanId: 1 },
      { ...baseline, parentSpanId: 1 },
      { ...baseline, wave: 'cognitive' },
    ];
    invalidEnvelopes.forEach(expectInvalidTelemetryRecord);

    expect(
      parseTelemetryJsonl(
        JSON.stringify({
          ...baseline,
          spanId: 'span-1',
          parentSpanId: 'span-0',
        }),
      ),
    ).toHaveLength(1);

    const candidate = telemetryRecordOfType(
      validTelemetryRecords(),
      'candidate.generated',
    );
    expectInvalidTelemetryRecord(withoutKeys(candidate, ['epochId']));
    const epoch = telemetryRecordOfType(
      validTelemetryRecords(),
      'epoch.started',
    );
    expectInvalidTelemetryRecord(withoutKeys(epoch, ['epochId']));
    const split = telemetryRecordOfType(
      validTelemetryRecords(),
      'node.split-completed',
    );
    expectInvalidTelemetryRecord(withoutKeys(split, ['nodeId']));

    expectInvalidTelemetryRecord({ ...candidate, candidateId: 'different' });
    expectInvalidTelemetryRecord({ ...candidate, nodeId: 'different' });
    expectInvalidTelemetryRecord({ ...candidate, wave: 'afferent' });
    expectInvalidTelemetryRecord({ ...split, nodeId: 'different' });
  });

  it('rejects malformed fields in every telemetry v1 payload', () => {
    const records = validTelemetryRecords();
    records.forEach((record) => {
      const data = record['data'];
      if (isTestRecord(data)) {
        Object.keys(data).forEach((key) => {
          expectInvalidTelemetryRecord({
            ...record,
            data: { ...data, [key]: null },
          });
        });
      }
    });

    const runStarted = telemetryRecordOfType(records, 'run.started');
    expectInvalidTelemetryRecord({ ...runStarted, data: { unexpected: true } });
    const runCompleted = telemetryRecordOfType(records, 'run.completed');
    expectInvalidTelemetryRecord({
      ...runCompleted,
      data: { status: 'not-complete' },
    });

    const inference = telemetryRecordOfType(records, 'inference.completed');
    const inferenceData = inference['data'];
    if (!isTestRecord(inferenceData)) {
      throw new Error('invalid test fixture');
    }
    expectInvalidTelemetryRecord({
      ...inference,
      data: { ...inferenceData, stage: 'unknown-stage' },
    });
    expectInvalidTelemetryRecord({
      ...inference,
      data: {
        ...inferenceData,
        outcome: 'failure',
        errorCategory: undefined,
      },
    });
    expectInvalidTelemetryRecord({
      ...inference,
      data: {
        ...inferenceData,
        outcome: 'success',
        errorCategory: 'unexpected',
      },
    });

    const epochCompleted = telemetryRecordOfType(records, 'epoch.completed');
    const epochData = epochCompleted['data'];
    if (!isTestRecord(epochData)) {
      throw new Error('invalid test fixture');
    }
    const counts = epochData['counts'];
    const waveCounts = epochData['waveCounts'];
    if (!isTestRecord(counts) || !isTestRecord(waveCounts)) {
      throw new Error('invalid test fixture');
    }
    Object.keys(counts).forEach((key) =>
      expectInvalidTelemetryRecord({
        ...epochCompleted,
        data: { ...epochData, counts: { ...counts, [key]: null } },
      }),
    );
    for (const wave of ['afferent', 'cognitive'] as const) {
      const waveValue = waveCounts[wave];
      if (!isTestRecord(waveValue)) {
        throw new Error('invalid test fixture');
      }
      Object.keys(waveValue).forEach((key) =>
        expectInvalidTelemetryRecord({
          ...epochCompleted,
          data: {
            ...epochData,
            waveCounts: {
              ...waveCounts,
              [wave]: { ...waveValue, [key]: null },
            },
          },
        }),
      );
    }

    const candidate = telemetryRecordOfType(records, 'candidate.generated');
    const candidateData = candidate['data'];
    if (!isTestRecord(candidateData)) {
      throw new Error('invalid test fixture');
    }
    const evidenceCases: unknown[] = [
      {},
      [null],
      [{ id: null, contentHash: 'hash' }],
      [{ id: 'evidence-1', contentHash: null }],
      [{ id: 'evidence-1', contentHash: 'hash', sourceUrls: [1] }],
      [{ id: 'evidence-1', contentHash: 'hash', artifactReferences: [1] }],
    ];
    evidenceCases.forEach((evidence) =>
      expectInvalidTelemetryRecord({
        ...candidate,
        data: { ...candidateData, evidence },
      }),
    );

    const distillation = telemetryRecordOfType(
      records,
      'distillation.attempt-completed',
    );
    const distillationData = distillation['data'];
    if (!isTestRecord(distillationData)) {
      throw new Error('invalid test fixture');
    }
    const telemetryEvidenceCases: unknown[] = [
      {},
      [null],
      [{ id: 'evidence-1', contentHash: 'hash', source: 'other', index: 0 }],
      [
        {
          id: 'evidence-1',
          contentHash: 'hash',
          source: 'candidate',
          index: -1,
        },
      ],
    ];
    telemetryEvidenceCases.forEach((evidence) =>
      expectInvalidTelemetryRecord({
        ...distillation,
        data: { ...distillationData, evidence },
      }),
    );

    const split = telemetryRecordOfType(records, 'node.split-completed');
    const splitData = split['data'];
    if (!isTestRecord(splitData)) {
      throw new Error('invalid test fixture');
    }
    for (const childNodeIds of [{}, ['child-1'], [1, 2]]) {
      expectInvalidTelemetryRecord({
        ...split,
        data: { ...splitData, childNodeIds },
      });
    }
    expect(
      parseTelemetryJsonl(
        JSON.stringify({
          ...split,
          data: { ...splitData, childNodeIds: [] },
        }),
      ),
    ).toHaveLength(1);

    for (const invalidArray of [[1]]) {
      for (const [event, field] of [
        ['epoch.started', 'inputIds'],
        ['candidate.generated', 'inputIds'],
        ['relevance.completed', 'rankedCandidateIds'],
        ['relevance.completed', 'survivorCandidateIds'],
        ['distillation.attempt-completed', 'candidateIds'],
        ['distillation.attempt-completed', 'selectedCandidateIds'],
        ['tool.elaboration-completed', 'callIds'],
      ] as const) {
        const record = telemetryRecordOfType(records, event);
        const data = record['data'];
        if (!isTestRecord(data)) {
          throw new Error('invalid test fixture');
        }
        expectInvalidTelemetryRecord({
          ...record,
          data: { ...data, [field]: invalidArray },
        });
      }
    }
  });

  it('extracts independently sequenced runs from one appended log', () => {
    const first = recorderFixture('run-1');
    const second = recorderFixture('run-2');
    const firstEpoch = first.recorder.beginEpoch();
    const secondEpoch = second.recorder.beginEpoch();
    const zero = { generated: 0, attentionPassed: 0, selected: 0 };
    first.recorder.completeEpoch(firstEpoch, {
      status: 'success',
      counts: zero,
      waveCounts: { afferent: zero, cognitive: zero },
    });
    second.recorder.completeEpoch(secondEpoch, {
      status: 'failure',
      counts: zero,
      waveCounts: { afferent: zero, cognitive: zero },
    });

    expect(
      extractEpochSummaries([...first.events, ...second.events]).map(
        ({ runId, status }) => ({ runId, status }),
      ),
    ).toEqual([
      { runId: 'run-1', status: 'success' },
      { runId: 'run-2', status: 'failure' },
    ]);
  });

  it('rejects incomplete and non-derivable epoch summaries', () => {
    const incomplete = recorderFixture();
    incomplete.recorder.beginEpoch();
    expect(() => extractEpochSummaries(incomplete.events)).toThrow(
      'expected one epoch.completed',
    );

    const inconsistent = recorderFixture();
    const epoch = inconsistent.recorder.beginEpoch();
    inconsistent.recorder.completeEpoch(epoch, {
      status: 'success',
      counts: { generated: 1, attentionPassed: 0, selected: 0 },
      waveCounts: {
        afferent: { generated: 0, attentionPassed: 0, selected: 0 },
        cognitive: { generated: 1, attentionPassed: 0, selected: 0 },
      },
    });
    expect(() => extractEpochSummaries(inconsistent.events)).toThrow(
      'candidate counts do not derive',
    );

    const duplicateCompletion = [
      ...inconsistent.events,
      {
        ...inconsistent.events[1]!,
        sequence: 9,
      },
    ];
    expect(() => extractEpochSummaries(duplicateCompletion)).toThrow(
      'expected one epoch.completed',
    );
  });

  it('rejects broken candidate, relevance, and survivor correlations', () => {
    const fixture = completeCorrelatedEpoch();
    expect(extractEpochSummaries(fixture.events)).toHaveLength(1);

    const duplicateRelevance = [
      ...fixture.events,
      {
        ...fixture.events.find(
          (event) => event.event === 'relevance.completed',
        )!,
        sequence: 99,
      },
    ];
    expect(() => extractEpochSummaries(duplicateRelevance)).toThrow(
      'expected at most one relevance.completed',
    );

    expectCorruptEpochToThrow(
      fixture.events,
      'candidate.outcome',
      (event) => ({
        ...event,
        data: { ...event.data, candidateId: 'missing' },
      }),
      'candidate lifecycle correlation differs',
    );
    expectCorruptEpochToThrow(
      fixture.events,
      'candidate.outcome',
      (event) => ({
        ...event,
        data: { ...event.data, originatingNodeId: 'different-node' },
      }),
      'candidate lifecycle correlation differs',
    );
    expectCorruptEpochToThrow(
      fixture.events,
      'candidate.outcome',
      (event) => ({
        ...event,
        data: { ...event.data, wave: 'afferent' },
      }),
      'candidate lifecycle correlation differs',
    );

    expect(() =>
      extractEpochSummaries(
        fixture.events.filter((event) => event.event !== 'candidate.outcome'),
      ),
    ).toThrow('candidate lifecycles are incomplete');
    const duplicateGenerated = fixture.events.map((event) =>
      event.event === 'candidate.generated' &&
      event.data.candidateId === 'candidate-2'
        ? { ...event, data: { ...event.data, candidateId: 'candidate-1' } }
        : event,
    );
    expect(() => extractEpochSummaries(duplicateGenerated)).toThrow(
      'candidate lifecycles are incomplete',
    );

    expectCorruptEpochToThrow(
      fixture.events,
      'relevance.completed',
      (event) => ({
        ...event,
        data: {
          ...event.data,
          rankedCandidateIds: ['candidate-1', 'candidate-1'],
        },
      }),
      'ranked candidate IDs do not derive',
    );
    expectCorruptEpochToThrow(
      fixture.events,
      'relevance.completed',
      (event) => ({
        ...event,
        data: { ...event.data, rankedCandidateIds: ['candidate-1'] },
      }),
      'ranked candidate IDs do not derive',
    );
    expectCorruptEpochToThrow(
      fixture.events,
      'relevance.completed',
      (event) => ({
        ...event,
        data: {
          ...event.data,
          rankedCandidateIds: ['candidate-1', 'different-candidate'],
        },
      }),
      'ranked candidate IDs do not derive',
    );
    expectCorruptEpochToThrow(
      fixture.events,
      'relevance.completed',
      (event) => ({
        ...event,
        data: { ...event.data, survivorCandidateIds: [] },
      }),
      'attention survivor IDs do not derive',
    );

    const failedRelevance = fixture.events.map((event) =>
      event.event === 'relevance.completed'
        ? {
            ...event,
            data: {
              ...event.data,
              outcome: 'failure' as const,
              rankedCandidateIds: [],
            },
          }
        : event,
    );
    expect(extractEpochSummaries(failedRelevance)).toHaveLength(1);
  });

  it('allows only machine-precision drift in derived durations', () => {
    const floating = recorderFixture();
    const epoch = floating.recorder.beginEpoch();
    floating.advance(5_000);
    const zero = { generated: 0, attentionPassed: 0, selected: 0 };
    floating.recorder.completeEpoch(epoch, {
      status: 'success',
      counts: zero,
      waveCounts: { afferent: zero, cognitive: zero },
    });
    const withDrift = floating.events.map((event) =>
      event.event === 'epoch.completed'
        ? {
            ...event,
            data: {
              ...event.data,
              criticalPathDurationMs: event.data.criticalPathDurationMs + 1e-11,
            },
          }
        : event,
    );
    expect(extractEpochSummaries(withDrift)).toHaveLength(1);
    expect(() =>
      extractEpochSummaries(
        withDrift.map((event) =>
          event.event === 'epoch.completed'
            ? {
                ...event,
                data: { ...event.data, criticalPathDurationMs: 5_001 },
              }
            : event,
        ),
      ),
    ).toThrow('epoch metrics do not derive');
  });
});

const validTelemetryRecord = (
  event: TelemetryEventType,
  data: Readonly<Record<string, unknown>>,
  context: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  schemaVersion: 1,
  sequence: 0,
  timestamp: '2026-08-02T00:00:00.000Z',
  monotonicMs: 0,
  runId: 'run-1',
  event,
  data,
  ...context,
});

const validTelemetryRecords = (): Record<string, unknown>[] => {
  const epoch = { epochId: 'epoch-1' };
  const candidate = {
    ...epoch,
    wave: 'cognitive',
    candidateId: 'candidate-1',
    nodeId: 'memory-1',
  };
  const completion = {
    durationMs: 1,
    outcome: 'failure',
    errorCategory: 'expected-failure',
  };
  const counts = { generated: 1, attentionPassed: 1, selected: 1 };
  const evidence = {
    id: 'evidence-1',
    contentHash: 'evidence-hash',
    sourceUrls: ['https://example.com'],
    artifactReferences: ['artifact-1'],
  };
  return [
    validTelemetryRecord('run.started', {}),
    validTelemetryRecord('run.completed', { status: 'success' }),
    validTelemetryRecord('epoch.started', { inputIds: ['input-1'] }, epoch),
    validTelemetryRecord(
      'epoch.completed',
      {
        status: 'success',
        counts,
        waveCounts: {
          afferent: { generated: 0, attentionPassed: 0, selected: 0 },
          cognitive: counts,
        },
        inferenceCount: 1,
        toolCallCount: 1,
        totalProviderDurationMs: 1,
        criticalPathDurationMs: 2,
      },
      epoch,
    ),
    validTelemetryRecord(
      'candidate.generated',
      {
        candidateId: 'candidate-1',
        originatingNodeId: 'memory-1',
        wave: 'cognitive',
        contentHash: 'candidate-hash',
        evidence: [evidence],
        inputIds: ['input-1'],
      },
      candidate,
    ),
    validTelemetryRecord(
      'candidate.outcome',
      {
        candidateId: 'candidate-1',
        originatingNodeId: 'memory-1',
        wave: 'cognitive',
        attentionOutcome: 'passed',
        selectionOutcome: 'selected',
      },
      candidate,
    ),
    validTelemetryRecord(
      'inference.completed',
      {
        inferenceId: 'inference-1',
        stage: 'node-generation',
        ...completion,
      },
      { spanId: 'inference-1', parentSpanId: 'candidate-1' },
    ),
    validTelemetryRecord('inference.completed', {
      inferenceId: 'inference-2',
      stage: 'attention-ranking',
      durationMs: 1,
      outcome: 'success',
    }),
    validTelemetryRecord(
      'relevance.completed',
      {
        ...completion,
        topN: 'all',
        rankedCandidateIds: ['candidate-1'],
        survivorCandidateIds: ['candidate-1'],
      },
      epoch,
    ),
    validTelemetryRecord(
      'distillation.attempt-completed',
      {
        attemptId: 'attempt-1',
        attempt: 'primary',
        strategy: 'synthesize',
        ...completion,
        candidateIds: ['candidate-1'],
        selectedCandidateIds: [],
        evidence: [{ ...evidence, source: 'candidate', index: 0 }],
        actionDisposition: 'none',
      },
      epoch,
    ),
    validTelemetryRecord(
      'distillation.fallback-activated',
      { failedAttemptId: 'attempt-1', errorCategory: 'synthesis-failure' },
      epoch,
    ),
    validTelemetryRecord(
      'tool.elaboration-completed',
      { requestId: 'request-1', ...completion, callIds: ['call-1'] },
      candidate,
    ),
    validTelemetryRecord(
      'tool.invocation-completed',
      {
        requestId: 'request-1',
        callId: 'call-1',
        toolName: 'search',
        ...completion,
        evidence: { id: 'tool-evidence-1', contentHash: 'tool-hash' },
      },
      candidate,
    ),
    validTelemetryRecord(
      'tool.invocation-completed',
      {
        requestId: 'request-2',
        callId: 'call-2',
        toolName: 'search',
        durationMs: 1,
        outcome: 'success',
      },
      candidate,
    ),
    validTelemetryRecord(
      'node.split-completed',
      {
        parentNodeId: 'memory-1',
        childNodeIds: ['memory-2', 'memory-3'],
        ...completion,
      },
      { ...epoch, nodeId: 'memory-1' },
    ),
    validTelemetryRecord('persistence.completed', {
      operation: 'write',
      target: 'session',
      ...completion,
    }),
    validTelemetryRecord('user-input.received', {
      inputId: 'input-1',
      contentHash: 'input-hash',
    }),
    validTelemetryRecord(
      'user-input.consumed',
      { inputId: 'input-1', latencyMs: 1 },
      epoch,
    ),
    validTelemetryRecord(
      'user-input.broadcast-selected',
      { inputId: 'input-1', latencyMs: 2, broadcastHash: 'broadcast-hash' },
      epoch,
    ),
    validTelemetryRecord('error.reported', {
      source: 'test',
      message: 'expected',
      errorCategory: 'expected-failure',
    }),
    validTelemetryRecord('system.notice', {
      message: 'notice',
      metadata: { key: 'value' },
    }),
    validTelemetryRecord('system.notice', { message: 'notice' }),
  ];
};

const telemetryRecordOfType = (
  records: readonly Record<string, unknown>[],
  event: TelemetryEventType,
): Record<string, unknown> => {
  const record = records.find((candidate) => candidate['event'] === event);
  if (record === undefined) {
    throw new Error(`missing ${event} test fixture`);
  }
  return record;
};

const expectInvalidTelemetryRecord = (
  record: Readonly<Record<string, unknown>>,
): void => {
  expect(() => parseTelemetryJsonl(JSON.stringify(record))).toThrow(
    'not a telemetry v1 event',
  );
};

const withoutKeys = (
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(source).filter(([key]) => !keys.includes(key)),
  );

const isTestRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const completeCorrelatedEpoch = () => {
  const fixture = recorderFixture();
  const epoch = fixture.recorder.beginEpoch();
  recordCandidate(
    fixture.recorder,
    epoch.epochId,
    'candidate-1',
    'memory-1',
    'cognitive',
  );
  recordCandidate(
    fixture.recorder,
    epoch.epochId,
    'candidate-2',
    'memory-2',
    'cognitive',
  );
  recordOutcome(
    fixture.recorder,
    epoch.epochId,
    'candidate-1',
    'memory-1',
    'cognitive',
    'passed',
    'selected',
  );
  recordOutcome(
    fixture.recorder,
    epoch.epochId,
    'candidate-2',
    'memory-2',
    'cognitive',
    'rejected',
    'not-selected',
  );
  fixture.recorder.record(
    'relevance.completed',
    {
      durationMs: 1,
      outcome: 'success',
      topN: 1,
      rankedCandidateIds: ['candidate-1', 'candidate-2'],
      survivorCandidateIds: ['candidate-1'],
    },
    epoch,
  );
  fixture.recorder.completeEpoch(epoch, {
    status: 'success',
    counts: { generated: 2, attentionPassed: 1, selected: 1 },
    waveCounts: {
      afferent: { generated: 0, attentionPassed: 0, selected: 0 },
      cognitive: { generated: 2, attentionPassed: 1, selected: 1 },
    },
  });
  return fixture;
};

const expectCorruptEpochToThrow = <Type extends TelemetryEventType>(
  events: readonly TelemetryEvent[],
  eventType: Type,
  corrupt: (event: TelemetryEvent<Type>) => TelemetryEvent<Type>,
  message: string,
): void => {
  let corrupted = false;
  const result = events.map((event) => {
    if (!corrupted && event.event === eventType) {
      corrupted = true;
      return corrupt(
        event as unknown as TelemetryEvent<Type>,
      ) as unknown as TelemetryEvent;
    }
    return event;
  });
  expect(() => extractEpochSummaries(result)).toThrow(message);
};

const recordCandidate = (
  recorder: TelemetryRecorder,
  epochId: string,
  candidateId: string,
  nodeId: string,
  wave: 'afferent' | 'cognitive',
): void => {
  recorder.record(
    'candidate.generated',
    {
      candidateId,
      originatingNodeId: nodeId,
      wave,
      contentHash: `hash-${candidateId}`,
      evidence: [],
      inputIds: [],
    },
    { epochId, candidateId, nodeId, wave },
  );
};

const recordOutcome = (
  recorder: TelemetryRecorder,
  epochId: string,
  candidateId: string,
  nodeId: string,
  wave: 'afferent' | 'cognitive',
  attentionOutcome: 'bypassed' | 'passed' | 'rejected',
  selectionOutcome: 'selected' | 'supporting-evidence' | 'not-selected',
): void => {
  recorder.record(
    'candidate.outcome',
    {
      candidateId,
      originatingNodeId: nodeId,
      wave,
      attentionOutcome,
      selectionOutcome,
    },
    { epochId, candidateId, nodeId, wave },
  );
};
