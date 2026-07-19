import { describe, it, expect } from 'vitest';
import { StaticNodePruner } from './static-node-pruner.js';
import { NodeStats } from '../types/node-stats.js';
import { MemoryNode } from '../node/memory-node.js';

// A MemoryNode stand-in; the pruner only reads `id`.
const node = (id: string): MemoryNode => ({ id }) as unknown as MemoryNode;

const stat = (
  epochsAlive: number,
  epochsGenerated: number,
  epochsNotSelected: number,
): NodeStats => ({
  epochsAlive,
  epochsGenerated,
  epochsPassedAttention: epochsGenerated - epochsNotSelected,
  epochsSelected: epochsGenerated - epochsNotSelected,
});

const pruner = (
  overrides: Partial<ConstructorParameters<typeof StaticNodePruner>[0]> = {},
) =>
  new StaticNodePruner({
    minEpochsAlive: 3,
    minBroadcasts: 1,
    maxFilterRate: 0.5,
    minMemoryNodes: 1,
    ...overrides,
  });

describe('StaticNodePruner', () => {
  it('does not prune nodes still within the grace period', () => {
    const nodes = [node('a'), node('b')];
    const stats = new Map<string, NodeStats>([
      // Both under-spoke, but neither has reached minEpochsAlive yet.
      ['a', stat(2, 0, 0)],
      ['b', stat(1, 0, 0)],
    ]);

    expect(pruner().selectForPruning(nodes, stats)).toEqual([]);
  });

  it('prunes an eligible node that spoke fewer than minBroadcasts', () => {
    const nodes = [node('keep'), node('inert')];
    const stats = new Map<string, NodeStats>([
      ['keep', stat(5, 5, 0)],
      ['inert', stat(5, 0, 0)],
    ]);

    const result = pruner({ minBroadcasts: 1 }).selectForPruning(nodes, stats);

    expect(result.map((n) => n.id)).toEqual(['inert']);
  });

  it('prunes an eligible node whose selection miss rate exceeds maxFilterRate', () => {
    const nodes = [node('good'), node('noisy')];
    const stats = new Map<string, NodeStats>([
      ['good', stat(10, 10, 2)], // 0.2 missed selection
      ['noisy', stat(10, 10, 8)], // 0.8 missed selection
    ]);

    const result = pruner({ maxFilterRate: 0.5 }).selectForPruning(
      nodes,
      stats,
    );

    expect(result.map((n) => n.id)).toEqual(['noisy']);
  });

  it('keeps a node exactly at the selection miss boundary', () => {
    const nodes = [node('a'), node('b')];
    const stats = new Map<string, NodeStats>([
      ['a', stat(10, 10, 5)], // exactly 0.5
      ['b', stat(10, 10, 5)],
    ]);

    // Strictly greater-than triggers pruning, so 0.5 == maxFilterRate is kept.
    expect(
      pruner({ maxFilterRate: 0.5 }).selectForPruning(nodes, stats),
    ).toEqual([]);
  });

  it('enforces the population floor, dropping the worst performers first', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const stats = new Map<string, NodeStats>([
      ['a', stat(10, 10, 6)], // 0.6 missed selection
      ['b', stat(10, 10, 9)], // 0.9 missed selection (worst)
      ['c', stat(10, 10, 7)], // 0.7 missed selection
    ]);

    // All three are underperforming, but the floor of 2 permits removing only 1.
    const result = pruner({
      maxFilterRate: 0.5,
      minMemoryNodes: 2,
    }).selectForPruning(nodes, stats);

    expect(result.map((n) => n.id)).toEqual(['b']);
  });

  it('returns all underperformers when under the floor cap', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const stats = new Map<string, NodeStats>([
      ['a', stat(10, 10, 0)], // healthy
      ['b', stat(10, 0, 0)], // inert
      ['c', stat(10, 10, 9)], // noisy
    ]);

    const result = pruner({ minMemoryNodes: 1 }).selectForPruning(nodes, stats);

    expect(result.map((n) => n.id).sort()).toEqual(['b', 'c']);
  });

  it('never prunes when removal would breach the floor entirely', () => {
    const nodes = [node('a')];
    const stats = new Map<string, NodeStats>([['a', stat(10, 0, 0)]]);

    // Single underperforming node, but floor of 1 forbids removing it.
    expect(
      pruner({ minMemoryNodes: 1 }).selectForPruning(nodes, stats),
    ).toEqual([]);
  });

  it('ranks a never-spoke node as zero filter-rate when applying the floor', () => {
    const nodes = [node('inert'), node('noisy')];
    const stats = new Map<string, NodeStats>([
      // 'inert' never spoke (filterRate falls back to 0); 'noisy' is 0.9.
      ['inert', stat(10, 0, 0)],
      ['noisy', stat(10, 10, 9)],
    ]);

    // Both underperform but the floor of 1 permits removing only one; the
    // worst (noisy, 0.9 > inert's 0) is dropped, exercising the zero-rate path.
    const result = pruner({
      maxFilterRate: 0.5,
      minMemoryNodes: 1,
    }).selectForPruning(nodes, stats);

    expect(result.map((n) => n.id)).toEqual(['noisy']);
  });

  it('ignores nodes with no recorded stats', () => {
    const nodes = [node('tracked'), node('untracked')];
    const stats = new Map<string, NodeStats>([['tracked', stat(10, 10, 0)]]);

    // 'untracked' has no stats, so it is neither eligible nor pruned.
    expect(pruner().selectForPruning(nodes, stats)).toEqual([]);
  });
});
