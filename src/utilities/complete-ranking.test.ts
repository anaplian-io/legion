import { describe, expect, it } from 'vitest';
import { requireCompleteRanking } from './complete-ranking.js';

describe('requireCompleteRanking', () => {
  it('returns a complete permutation', () => {
    expect(requireCompleteRanking([2, 0, 1], 3, 'test')).toEqual([2, 0, 1]);
  });

  it('rejects missing, invalid, and duplicate indices', () => {
    expect(() => requireCompleteRanking([0], 2, 'test')).toThrow(
      'expected 2 ranked indices',
    );
    expect(() => requireCompleteRanking([0, 1.5], 2, 'test')).toThrow(
      'invalid index 1.5',
    );
    expect(() => requireCompleteRanking([0, 2], 2, 'test')).toThrow(
      'invalid index 2',
    );
    expect(() => requireCompleteRanking([0, 0], 2, 'test')).toThrow(
      'duplicate index 0',
    );
  });
});
