import { describe, expect, it, vi } from 'vitest';
import { SequencedCompositeRelevanceGate } from './sequenced-composite-relevance-gate.js';
import type { RelevanceGate } from '../types/relevance-gate.js';

describe('SequencedCompositeRelevanceGate', () => {
  const relevanceProps = {
    broadcastMessage: {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    },
    nodeId: 'node-1',
    epochsAlive: 0,
    nodeContext: 'Node context',
  };

  const gateReturning = (value: boolean): RelevanceGate => ({
    isRelevant: vi.fn().mockResolvedValue(value),
  });

  it('returns true on the first relevant gate and short-circuits', async () => {
    const first = gateReturning(true);
    const second = gateReturning(true);
    const composite = new SequencedCompositeRelevanceGate({
      gates: [first, second],
    });

    await expect(composite.isRelevant(relevanceProps)).resolves.toBe(true);

    expect(first.isRelevant).toHaveBeenCalledWith(relevanceProps);
    expect(second.isRelevant).not.toHaveBeenCalled();
  });

  it('returns false when every gate returns false', async () => {
    const first = gateReturning(false);
    const second = gateReturning(false);
    const composite = new SequencedCompositeRelevanceGate({
      gates: [first, second],
    });

    await expect(composite.isRelevant(relevanceProps)).resolves.toBe(false);

    expect(first.isRelevant).toHaveBeenCalledWith(relevanceProps);
    expect(second.isRelevant).toHaveBeenCalledWith(relevanceProps);
  });
});
