import { describe, expect, it } from 'vitest';
import { resolveDistillerStrategy } from './resolve-distiller-strategy.js';

describe('resolveDistillerStrategy', () => {
  it('defaults to selecting one candidate unchanged', () => {
    expect(resolveDistillerStrategy(undefined)).toBe('select-best');
  });

  it.each(['select-best', 'synthesize'] as const)(
    'preserves an explicit %s strategy',
    (strategy) => {
      expect(resolveDistillerStrategy(strategy)).toBe(strategy);
    },
  );
});
