import { describe, expect, it, vi } from 'vitest';
import { GeometricScheduleCuriosityGate } from './geometric-schedule-curiosity-gate.js';
import { BroadcastMessage } from '../types/node.js';

const broadcastMessage = (content: string): BroadcastMessage => ({
  workingMemory: { messages: [] },
  broadcast: { content },
});

const curiosityProps = (content: string) => ({
  broadcastMessage: broadcastMessage(content),
});

describe('GeometricScheduleCuriosityGate', () => {
  it('uses the initial curiosity for the first observed epoch', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.49);
    const gate = new GeometricScheduleCuriosityGate(randomFn);

    await expect(gate.isCurious(curiosityProps('first'))).resolves.toBe(true);
    expect(randomFn).toHaveBeenCalledTimes(1);
    expect(gate.lastEpochHash).toBeDefined();
  });

  it('does not decay curiosity for repeated checks in the same epoch', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.49);
    const gate = new GeometricScheduleCuriosityGate(randomFn);
    const message = curiosityProps('same epoch');

    await expect(gate.isCurious(message)).resolves.toBe(true);
    await expect(gate.isCurious(message)).resolves.toBe(true);
  });

  it('decays curiosity geometrically when the epoch changes', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.49);
    const gate = new GeometricScheduleCuriosityGate(randomFn);

    await expect(gate.isCurious(curiosityProps('first'))).resolves.toBe(true);
    await expect(gate.isCurious(curiosityProps('second'))).resolves.toBe(false);
  });

  it('returns false when the random value is above current curiosity', async () => {
    const randomFn = vi.fn<() => number>().mockReturnValue(0.5);
    const gate = new GeometricScheduleCuriosityGate(randomFn);

    await expect(gate.isCurious(curiosityProps('first'))).resolves.toBe(false);
  });
});
