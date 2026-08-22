import { describe, expect, it, vi } from 'vitest';
import type {
  DistillationProps,
  DistillationResult,
  Distiller,
} from '../types/distiller.js';
import type { TelemetryClock, TelemetryEvent } from '../types/telemetry.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import { DistillationValidator } from './distillation-validator.js';
import { InstrumentedDistiller } from './instrumented-distiller.js';
import { ValidatedDistiller } from './validated-distiller.js';
import { DistillationStrategyError } from '../types/distillation-failure.js';

const context = {
  epochId: 'epoch-1',
  attempt: 'configured' as const,
  attemptId: 'distillation-1',
  inferenceStage: 'configured-selection' as const,
};

const input: DistillationProps = {
  workingMemory: { messages: [] },
  broadcasts: [
    {
      role: 'node-response',
      content: 'Search first.',
      originatingNodeId: 'memory-1',
      candidateId: 'candidate-1',
      actionRequests: [
        { id: 'request-1', targetNodeId: 'tool-search', intent: 'Search.' },
      ],
    },
  ],
  afferentContext: [
    {
      role: 'afferent',
      content: 'Tool evidence.',
    },
  ],
};

const result: DistillationResult = {
  broadcast: {
    role: 'broadcast',
    content: 'Search first.',
    actionRequests: [
      { id: 'request-1', targetNodeId: 'tool-search', intent: 'Search.' },
    ],
  },
  supportingEvidence: [
    { source: 'candidate', index: 0 },
    { source: 'afferent', index: 0 },
  ],
  goalDecision: { kind: 'unchanged', reason: 'No persistent goal.' },
};

const fixture = () => {
  let monotonic = 0;
  let id = 0;
  const clock: TelemetryClock = {
    wallNow: () => new Date('2026-08-02T00:00:00.000Z'),
    monotonicNow: () => monotonic++,
  };
  const telemetry = new TelemetryRecorder({
    runId: 'run-1',
    clock,
    idFactory: { create: (kind) => `${kind}-${++id}` },
  });
  const events: TelemetryEvent[] = [];
  telemetry.subscribe((event) => events.push(event));
  return { telemetry, events };
};

describe('distillation telemetry', () => {
  it('records configured strategy results with stable evidence lineage', async () => {
    const { telemetry, events } = fixture();
    const delegate: Distiller = { distill: vi.fn().mockResolvedValue(result) };
    const distiller = new InstrumentedDistiller({
      delegate,
      validator: new DistillationValidator(),
      telemetry,
      strategy: 'select-best',
    });

    await expect(distiller.distill(input, context)).resolves.toEqual(result);

    expect(events[0]).toMatchObject({
      event: 'distillation.attempt-completed',
      epochId: 'epoch-1',
      data: {
        attempt: 'configured',
        strategy: 'select-best',
        outcome: 'success',
        candidateIds: ['candidate-1'],
        selectedCandidateIds: ['candidate-1'],
        actionDisposition: 'scheduled',
        evidence: [
          { source: 'candidate', index: 0, id: 'candidate-1' },
          {
            source: 'afferent',
            index: 0,
            id: expect.stringMatching(/^afferent:/u),
          },
        ],
      },
    });
    expect(delegate.distill).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ parentSpanId: context.attemptId }),
    );
  });

  it('records undefined and thrown configured attempts', async () => {
    const undefinedFixture = fixture();
    const undefinedDistiller = new InstrumentedDistiller({
      delegate: { distill: vi.fn().mockResolvedValue(undefined) },
      validator: new DistillationValidator(),
      telemetry: undefinedFixture.telemetry,
      strategy: 'synthesize',
    });
    await expect(
      undefinedDistiller.distill(input, context),
    ).resolves.toBeUndefined();
    expect(undefinedFixture.events[0]).toMatchObject({
      data: { outcome: 'failure', errorCategory: 'undefined-result' },
    });

    const thrownFixture = fixture();
    const thrownDistiller = new InstrumentedDistiller({
      delegate: { distill: vi.fn().mockRejectedValue(new TypeError('bad')) },
      validator: new DistillationValidator(),
      telemetry: thrownFixture.telemetry,
      strategy: 'synthesize',
    });
    await expect(thrownDistiller.distill(input, context)).rejects.toThrow(
      'bad',
    );
    expect(thrownFixture.events[0]).toMatchObject({
      data: {
        outcome: 'failure',
        errorCategory: 'synthesis-failure',
        failureReason: 'provider-failure',
      },
    });
  });

  it('makes primary failure and fallback activation observable', async () => {
    const { telemetry, events } = fixture();
    const primary: Distiller = {
      distill: vi
        .fn()
        .mockRejectedValue(
          new DistillationStrategyError(
            'invalid-action-selection',
            'invalid synthesis',
          ),
        ),
    };
    const fallback: Distiller = { distill: vi.fn().mockResolvedValue(result) };
    const distiller = new ValidatedDistiller({
      primary,
      fallback,
      validator: new DistillationValidator(),
      telemetry,
    });

    await expect(distiller.distill(input, context)).resolves.toEqual(result);

    expect(events.map(({ event }) => event)).toEqual([
      'distillation.attempt-completed',
      'distillation.fallback-activated',
      'distillation.attempt-completed',
    ]);
    expect(events[0]).toMatchObject({
      data: {
        attempt: 'primary',
        strategy: 'synthesize',
        outcome: 'failure',
        errorCategory: 'synthesis-failure',
        failureReason: 'invalid-action-selection',
      },
    });
    expect(events[1]).toMatchObject({
      data: {
        errorCategory: 'synthesis-failure',
        failureReason: 'invalid-action-selection',
      },
    });
    expect(events[2]).toMatchObject({
      data: {
        attempt: 'fallback',
        strategy: 'select-best',
        outcome: 'success',
      },
    });
  });

  it('records undefined primary and failing fallback attempts', async () => {
    const undefinedFixture = fixture();
    const undefinedPrimary = new ValidatedDistiller({
      primary: { distill: vi.fn().mockResolvedValue(undefined) },
      fallback: { distill: vi.fn().mockResolvedValue(result) },
      validator: new DistillationValidator(),
      telemetry: undefinedFixture.telemetry,
    });
    await expect(
      undefinedPrimary.distill(input, context),
    ).resolves.toBeUndefined();
    expect(undefinedFixture.events).toHaveLength(1);
    expect(undefinedFixture.events[0]).toMatchObject({
      data: { errorCategory: 'undefined-result' },
    });

    const failedFixture = fixture();
    const failedFallback = new ValidatedDistiller({
      primary: { distill: vi.fn().mockRejectedValue(new Error('primary')) },
      fallback: {
        distill: vi.fn().mockRejectedValue(new RangeError('fallback')),
      },
      validator: new DistillationValidator(),
      telemetry: failedFixture.telemetry,
    });
    await expect(failedFallback.distill(input, context)).rejects.toThrow(
      'fallback',
    );
    expect(failedFixture.events.at(-1)).toMatchObject({
      data: {
        attempt: 'fallback',
        errorCategory: 'selection-failure',
        failureReason: 'provider-failure',
      },
    });
  });

  it('distinguishes structurally invalid results from strategy failures', async () => {
    const invalidResult = {
      ...result,
      supportingEvidence: [],
    } satisfies DistillationResult;
    const configuredFixture = fixture();
    const configured = new InstrumentedDistiller({
      delegate: { distill: vi.fn().mockResolvedValue(invalidResult) },
      validator: new DistillationValidator(),
      telemetry: configuredFixture.telemetry,
      strategy: 'select-best',
    });

    await expect(configured.distill(input, context)).rejects.toThrow(
      'candidate evidence',
    );
    expect(configuredFixture.events[0]).toMatchObject({
      data: {
        outcome: 'failure',
        errorCategory: 'validation-failure',
        failureReason: 'post-distillation-validation',
      },
    });

    const fallbackFixture = fixture();
    const fallback = new ValidatedDistiller({
      primary: { distill: vi.fn().mockResolvedValue(invalidResult) },
      fallback: { distill: vi.fn().mockResolvedValue(result) },
      validator: new DistillationValidator(),
      telemetry: fallbackFixture.telemetry,
    });

    await expect(fallback.distill(input, context)).resolves.toEqual(result);
    expect(fallbackFixture.events.slice(0, 2)).toMatchObject([
      {
        data: {
          errorCategory: 'validation-failure',
          failureReason: 'post-distillation-validation',
        },
      },
      {
        data: {
          errorCategory: 'validation-failure',
          failureReason: 'post-distillation-validation',
        },
      },
    ]);
  });
});
