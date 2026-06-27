import { MemoryNode } from '../node/memory-node.js';
import { NodeStats } from './node-stats.js';

export interface NodePruner {
  /**
   * Selects underperforming memory nodes to remove from the collective.
   *
   * Returns the subset of `nodes` that should be pruned (nodes in, nodes out,
   * mirroring RelevanceFilter and NodeSplitter). The orchestrator maps the
   * result to ids when removing them. Implementations are responsible for
   * enforcing any population floor, so they never return so many nodes that
   * the collective is emptied.
   *
   * @param nodes The current memory nodes eligible for pruning.
   * @param stats Per-node statistics keyed by node id.
   */
  readonly selectForPruning: (
    nodes: MemoryNode[],
    stats: Map<string, NodeStats>,
  ) => MemoryNode[];
}
