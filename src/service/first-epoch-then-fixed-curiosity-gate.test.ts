import { describe, expect, it, vi } from 'vitest';
import { FirstEpochThenFixedCuriosityGate } from './first-epoch-then-fixed-curiosity-gate.js';
import type { RelevanceGateProps } from '../types/relevance-gate.js';

const gateProps = (epochsAlive: number): RelevanceGateProps => ({
  broadcastMessage: {
    workingMemory: { messages: [] },
    broadcast: { role: 'broadcast', content: 'Explore.' },
  },
  nodeId: 'memory-1',
  epochsAlive,
});

describe('FirstEpochThenFixedCuriosityGate', () => {
  it('guarantees relevance during a node first epoch without drawing randomness', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.99);
    const gate = new FirstEpochThenFixedCuriosityGate(randomFn);

    await expect(gate.isRelevant(gateProps(0))).resolves.toBe(true);
    expect(randomFn).not.toHaveBeenCalled();
  });

  it('guarantees the first epoch independently for every node sharing the gate', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.99);
    const gate = new FirstEpochThenFixedCuriosityGate(randomFn);

    await expect(
      Promise.all([
        gate.isRelevant({ ...gateProps(0), nodeId: 'memory-a' }),
        gate.isRelevant({ ...gateProps(0), nodeId: 'memory-b' }),
      ]),
    ).resolves.toEqual([true, true]);
    expect(randomFn).not.toHaveBeenCalled();
  });

  it('uses the default fixed three-percent probability for every later epoch', async () => {
    const randomFn = vi
      .fn<() => number>()
      .mockReturnValueOnce(0.029)
      .mockReturnValueOnce(0.03);
    const gate = new FirstEpochThenFixedCuriosityGate(randomFn);

    await expect(gate.isRelevant(gateProps(1))).resolves.toBe(true);
    await expect(gate.isRelevant(gateProps(100))).resolves.toBe(false);
  });

  it('supports a custom fixed probability', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.4);
    const gate = new FirstEpochThenFixedCuriosityGate(randomFn, {
      probability: 0.5,
    });

    await expect(gate.isRelevant(gateProps(2))).resolves.toBe(true);
  });

  it('rejects probabilities outside the inclusive unit interval', () => {
    expect(
      () =>
        new FirstEpochThenFixedCuriosityGate(Math.random, {
          probability: -0.01,
        }),
    ).toThrow('probability must be between 0 and 1');
    expect(
      () =>
        new FirstEpochThenFixedCuriosityGate(Math.random, {
          probability: 1.01,
        }),
    ).toThrow('probability must be between 0 and 1');
  });
});
