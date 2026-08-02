/** Enforces the Provider contract that a ranking is an exact index permutation. */
export const requireCompleteRanking = (
  rankedIndices: readonly number[],
  itemCount: number,
  source: string,
): number[] => {
  if (rankedIndices.length !== itemCount) {
    throw new Error(
      `[${source}] expected ${itemCount} ranked indices, received ${rankedIndices.length}`,
    );
  }
  const seen = new Set<number>();
  rankedIndices.forEach((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= itemCount) {
      throw new Error(`[${source}] ranking contains invalid index ${index}`);
    }
    if (seen.has(index)) {
      throw new Error(`[${source}] ranking contains duplicate index ${index}`);
    }
    seen.add(index);
  });
  return [...rankedIndices];
};
