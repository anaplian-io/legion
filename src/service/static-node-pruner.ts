import { NodePruner } from '../types/node-pruner.js';
import { NodeStats } from '../types/node-stats.js';
import { MemoryNode } from '../node/memory-node.js';

export interface StaticNodePrunerProps {
  /**
   * Minimum epochs a node must exist before it is eligible for pruning. Acts
   * as a grace period so freshly spawned/split nodes are not removed before
   * they have had a chance to contribute (which would cause spawn/prune
   * thrashing).
   */
  readonly minEpochsAlive: number;
  /**
   * Minimum number of epochs an eligible node must have spoken in. Nodes that
   * speak less than this are pruned as inert.
   */
  readonly minBroadcasts: number;
  /**
   * Maximum tolerated fraction of a node's spoken epochs that were filtered
   * out. Eligible nodes above this rate are pruned as low-signal. In [0, 1].
   */
  readonly maxFilterRate: number;
  /**
   * Floor on the memory-node population. Pruning never reduces the eligible
   * population below this many nodes; the worst performers are dropped first.
   */
  readonly minMemoryNodes: number;
}

export class StaticNodePruner implements NodePruner {
  constructor(private readonly props: StaticNodePrunerProps) {}

  public readonly selectForPruning = (
    nodes: MemoryNode[],
    stats: Map<string, NodeStats>,
  ): MemoryNode[] => {
    const { minEpochsAlive, minMemoryNodes } = this.props;

    // Pair each node with its stats, keeping only nodes that have a recorded
    // stat past the grace period. Carrying the stat avoids re-fetching (and the
    // attendant undefined checks) downstream.
    const eligible = nodes
      .map((node) => ({ node, stat: stats.get(node.id) }))
      .filter(
        (entry): entry is { node: MemoryNode; stat: NodeStats } =>
          entry.stat !== undefined && entry.stat.epochsAlive >= minEpochsAlive,
      );

    const underperforming = eligible.filter((entry) =>
      this.isUnderperforming(entry.stat),
    );

    // Enforce the population floor. Pruning must not drop the total memory-node
    // count below the floor, so cap how many we remove and drop the worst
    // performers first.
    const maxRemovable = Math.max(0, nodes.length - minMemoryNodes);
    const selected =
      underperforming.length <= maxRemovable
        ? underperforming
        : [...underperforming]
            .sort((a, b) => this.filterRate(b.stat) - this.filterRate(a.stat))
            .slice(0, maxRemovable);

    return selected.map((entry) => entry.node);
  };

  private readonly isUnderperforming = (stat: NodeStats): boolean => {
    if (stat.epochsSpoken < this.props.minBroadcasts) {
      return true;
    }
    return this.filterRate(stat) > this.props.maxFilterRate;
  };

  /** Fraction of spoken epochs that were filtered out; 0 if never spoke. */
  private readonly filterRate = (stat: NodeStats): number => {
    if (stat.epochsSpoken === 0) {
      return 0;
    }
    return stat.epochsFiltered / stat.epochsSpoken;
  };
}
