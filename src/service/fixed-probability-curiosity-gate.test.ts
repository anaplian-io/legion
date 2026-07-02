import { describe, expect, it, vi } from 'vitest';
import { FixedProbabilityCuriosityGate } from './fixed-probability-curiosity-gate.js';
import { BroadcastMessage } from '../types/node.js';

const curiosityProps = (epochsAlive: number) => ({
  broadcastMessage: {
    workingMemory: { messages: [] },
    broadcast: { content: 'Need a sourced forecast.' },
  } satisfies BroadcastMessage,
  nodeId: 'tool-node',
  epochsAlive,
});

describe('FixedProbabilityCuriosityGate', () => {
  it('uses a fixed probability regardless of node age', async () => {
    const randomFn = vi
      .fn<() => number>()
      .mockReturnValueOnce(0.14)
      .mockReturnValueOnce(0.14);
    const gate = new FixedProbabilityCuriosityGate(
      { probability: 0.15 },
      randomFn,
    );

    await expect(gate.isCurious(curiosityProps(0))).resolves.toBe(true);
    await expect(gate.isCurious(curiosityProps(100))).resolves.toBe(true);
  });

  it('returns false when the random value is outside the fixed probability', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.15);
    const gate = new FixedProbabilityCuriosityGate(
      { probability: 0.15 },
      randomFn,
    );

    await expect(gate.isCurious(curiosityProps(0))).resolves.toBe(false);
  });

  it('allows custom fixed probabilities', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.2);
    const gate = new FixedProbabilityCuriosityGate(
      {
        probability: 0.25,
      },
      randomFn,
    );

    await expect(gate.isCurious(curiosityProps(20))).resolves.toBe(true);
  });
});
