/**
 * Per-node bookkeeping accumulated by the orchestrator across epochs. Used by
 * the NodePruner to decide which underperforming memory nodes to remove, and
 * published on the event stream for visibility.
 *
 * Stats are orchestrator-owned (not stored on the Node) to keep nodes pure and
 * to make pruning decisions deterministic rather than dependent on
 * fire-and-forget event delivery.
 */
export interface NodeStats {
  /** Epochs the node has existed for (its first epoch counts as 1). */
  readonly epochsAlive: number;
  /** Epochs in which the node produced a candidate message (spoke). */
  readonly epochsSpoken: number;
  /**
   * Epochs in which the node spoke but its message was filtered out (did not
   * survive the relevance filter). Always <= epochsSpoken.
   */
  readonly epochsFiltered: number;
}
