import { describe, it, expect } from 'vitest';
import { StaticAttentionGate } from './static-attention-gate.js';
import { AttentionGate } from '../types/attention-gate.js';

describe('StaticAttentionGate', () => {
  it('should create a gate with the given props', () => {
    const gate = new StaticAttentionGate({ n: 5 });

    expect(typeof gate.getTopN).toBe('function');
  });

  it('should return the configured static value', async () => {
    const gate: AttentionGate = new StaticAttentionGate({ n: 7 });

    const result = await gate.getTopN({ workingMemory: { messages: [] } });

    expect(result).toBe(7);
  });

  it('should handle different values', async () => {
    const gate1: AttentionGate = new StaticAttentionGate({ n: 1 });
    const gate2: AttentionGate = new StaticAttentionGate({ n: 100 });
    const gate3: AttentionGate = new StaticAttentionGate({ n: 0 });

    expect(await gate1.getTopN({ workingMemory: { messages: [] } })).toBe(1);
    expect(await gate2.getTopN({ workingMemory: { messages: [] } })).toBe(100);
    expect(await gate3.getTopN({ workingMemory: { messages: [] } })).toBe(0);
  });
});
