import { Node } from './node.js';
import { NodeStats } from './node-stats.js';

export interface NodePruner {
  /**
   * Selects underperforming nodes to remove from the collective.
   *
   * Returns the subset of `nodes` that should be pruned (nodes in, nodes out,
   * mirroring RelevanceFilter and NodeSplitter). The orchestrator maps the
   * result to ids when removing them. Implementations are responsible for
   * enforcing any population floor, so they never return so many nodes that
   * the collective is emptied.
   *
   * The signature is node-kind-agnostic so the same pruner can later target
   * dead-weight afferent nodes (e.g. tools that rarely contribute), not only
   * memory nodes.
   *
   * @param nodes The candidate nodes eligible for pruning.
   * @param stats Per-node statistics keyed by node id.
   */
  readonly selectForPruning: <T extends string>(
    nodes: Node<T>[],
    stats: Map<string, NodeStats>,
  ) => Node<T>[];
}
