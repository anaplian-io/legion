import { describe, expect, it, vi } from 'vitest';
import { GeometricScheduleCuriosityGate } from './geometric-schedule-curiosity-gate.js';
import { BroadcastMessage } from '../types/node.js';

const broadcastMessage = (content: string): BroadcastMessage => ({
  workingMemory: { messages: [] },
  broadcast: { content },
});

const curiosityProps = (content: string, epochsAlive: number) => ({
  broadcastMessage: broadcastMessage(content),
  nodeId: 'node-1',
  epochsAlive,
});

describe('GeometricScheduleCuriosityGate', () => {
  it('starts at full curiosity for a new node', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.99);
    const gate = new GeometricScheduleCuriosityGate(randomFn);

    await expect(gate.isRelevant(curiosityProps('first', 0))).resolves.toBe(
      true,
    );
    expect(randomFn).toHaveBeenCalledTimes(1);
  });

  it('applies the default geometric decay by node age', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.7);
    const gate = new GeometricScheduleCuriosityGate(randomFn);

    await expect(gate.isRelevant(curiosityProps('first', 1))).resolves.toBe(
      true,
    );
    await expect(gate.isRelevant(curiosityProps('second', 2))).resolves.toBe(
      false,
    );
  });

  it('is stateless for repeated checks with the same props', async () => {
    const randomFn = vi
      .fn<() => number>()
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0.7);
    const gate = new GeometricScheduleCuriosityGate(randomFn);
    const props = curiosityProps('same epoch', 1);

    await expect(gate.isRelevant(props)).resolves.toBe(true);
    await expect(gate.isRelevant(props)).resolves.toBe(true);
  });

  it('allows custom schedule parameters', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.3);
    const gate = new GeometricScheduleCuriosityGate(randomFn, {
      initialCuriosity: 0.5,
      decayFactor: 0.5,
    });

    await expect(gate.isRelevant(curiosityProps('first', 0))).resolves.toBe(
      true,
    );
    await expect(gate.isRelevant(curiosityProps('second', 1))).resolves.toBe(
      false,
    );
  });

  it('uses node-specific age with a shared stateless gate instance', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.8);
    const gate = new GeometricScheduleCuriosityGate(randomFn);

    await expect(gate.isRelevant(curiosityProps('first', 0))).resolves.toBe(
      true,
    );
    await expect(gate.isRelevant(curiosityProps('second', 1))).resolves.toBe(
      false,
    );
  });
});
