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
  /** Epochs in which the node generated a candidate message. */
  readonly epochsGenerated: number;
  /** Generated candidates admitted through the attention gate. */
  readonly epochsPassedAttention: number;
  /** Candidates chosen as the epoch's single workspace broadcast. */
  readonly epochsSelected: number;
}
