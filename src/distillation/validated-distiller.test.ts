import { describe, expect, it, vi } from 'vitest';
import { DistillationValidator } from './distillation-validator.js';
import { ValidatedDistiller } from './validated-distiller.js';
import type {
  DistillationProps,
  DistillationResult,
  Distiller,
} from '../types/distiller.js';
import {
  createTestTelemetry,
  TEST_DISTILLATION_TELEMETRY,
} from '../telemetry/test-context.fixture.js';

const input: DistillationProps = {
  workingMemory: { messages: [] },
  broadcasts: [
    {
      role: 'node-response',
      content: 'Candidate',
      originatingNodeId: 'memory-test',
      candidateId: 'candidate-test',
    },
  ],
};

const validResult: DistillationResult = {
  broadcast: { role: 'broadcast', content: 'Candidate' },
  supportingEvidence: [{ source: 'candidate', index: 0 }],
  goalDecision: { kind: 'unchanged', reason: 'No change.' },
};

const distiller = (implementation: Distiller['distill']): Distiller => ({
  distill: implementation,
});

const telemetry = createTestTelemetry();

describe('ValidatedDistiller', () => {
  it('returns a valid primary result without invoking fallback', async () => {
    const fallback = distiller(vi.fn());
    const wrapper = new ValidatedDistiller({
      primary: distiller(vi.fn().mockResolvedValue(validResult)),
      fallback,
      validator: new DistillationValidator(),
      telemetry,
    });

    await expect(
      wrapper.distill(input, TEST_DISTILLATION_TELEMETRY),
    ).resolves.toBe(validResult);
    expect(fallback.distill).not.toHaveBeenCalled();
  });

  it('preserves an undefined primary result', async () => {
    const fallback = distiller(vi.fn());
    const wrapper = new ValidatedDistiller({
      primary: distiller(vi.fn().mockResolvedValue(undefined)),
      fallback,
      validator: new DistillationValidator(),
      telemetry,
    });

    await expect(
      wrapper.distill(input, TEST_DISTILLATION_TELEMETRY),
    ).resolves.toBeUndefined();
    expect(fallback.distill).not.toHaveBeenCalled();
  });

  it('falls back when the primary throws or fails validation', async () => {
    for (const primary of [
      distiller(vi.fn().mockRejectedValue(new Error('synthesis failed'))),
      distiller(
        vi.fn().mockResolvedValue({
          ...validResult,
          supportingEvidence: [],
        }),
      ),
    ]) {
      const fallback = distiller(vi.fn().mockResolvedValue(validResult));
      const wrapper = new ValidatedDistiller({
        primary,
        fallback,
        validator: new DistillationValidator(),
        telemetry,
      });

      await expect(
        wrapper.distill(input, TEST_DISTILLATION_TELEMETRY),
      ).resolves.toBe(validResult);
      expect(fallback.distill).toHaveBeenCalledWith(
        input,
        expect.objectContaining({
          epochId: TEST_DISTILLATION_TELEMETRY.epochId,
          attempt: 'fallback',
          inferenceStage: 'fallback-selection',
          parentSpanId: expect.any(String),
        }),
      );
    }
  });

  it('returns undefined when fallback has no result', async () => {
    const wrapper = new ValidatedDistiller({
      primary: distiller(vi.fn().mockRejectedValue(new Error('bad'))),
      fallback: distiller(vi.fn().mockResolvedValue(undefined)),
      validator: new DistillationValidator(),
      telemetry,
    });

    await expect(
      wrapper.distill(input, TEST_DISTILLATION_TELEMETRY),
    ).resolves.toBeUndefined();
  });
});
