import { Node } from '../types/node.js';
import { MemoryNode } from '../node/memory-node.js';
import { NodeStats } from '../types/node-stats.js';
import { EventStream } from '../types/event-stream.js';

const ZERO_STATS: NodeStats = {
  epochsAlive: 0,
  epochsSpoken: 0,
  epochsFiltered: 0,
};

export interface EpochParticipation {
  readonly aliveNodeIds: string[];
  readonly spokenNodeIds: Set<string>;
  readonly survivingNodeIds: Set<string>;
}

/**
 * Owns the live set of nodes and their per-node statistics, keeping the two in
 * lockstep: registering a node seeds its stats with a fresh grace period, and
 * unregistering drops them. Lifecycle and stats events are emitted here so the
 * orchestrator never has to keep parallel maps in sync.
 */
export class NodeRegistry {
  private readonly nodesById = new Map<string, Node<string>>();
  private readonly statsById: Map<string, NodeStats>;

  constructor(
    private readonly eventStream: EventStream,
    initialStats?: Map<string, NodeStats>,
  ) {
    // Seed from restored stats so nodes loaded from a session keep their
    // accrued history (register() preserves any id already present).
    this.statsById = new Map(initialStats);
  }

  public register(node: Node<string>): void {
    this.nodesById.set(node.id, node);
    if (!this.statsById.has(node.id)) {
      this.statsById.set(node.id, ZERO_STATS);
    }
    this.eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: this.all() },
    });
    this.eventStream.publish({
      topicName: 'orchestrator/node-added',
      data: { addedNodes: [node] },
    });
  }

  public unregister(nodeId: string): void {
    this.nodesById.delete(nodeId);
    this.statsById.delete(nodeId);
    this.eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: this.all() },
    });
    this.eventStream.publish({
      topicName: 'orchestrator/node-removed',
      data: { removedNodeIds: [nodeId] },
    });
  }

  public all(): Node<string>[] {
    return Array.from(this.nodesById.values());
  }

  public memoryNodes(): MemoryNode[] {
    return this.all().filter(
      (node): node is MemoryNode => node.kind === 'memory',
    );
  }

  /** Non-memory nodes (tools, sensors) that feed context into the workspace. */
  public afferentNodes(): Node<string>[] {
    return this.all().filter((node) => node.kind !== 'memory');
  }

  public stats(): Map<string, NodeStats> {
    return new Map(this.statsById);
  }

  /**
   * Folds one epoch's participation into the running per-node stats and
   * publishes the updated snapshot.
   */
  public recordEpoch(participation: EpochParticipation): void {
    const { aliveNodeIds, spokenNodeIds, survivingNodeIds } = participation;
    for (const nodeId of aliveNodeIds) {
      const current = this.statsById.get(nodeId) ?? ZERO_STATS;
      const spoke = spokenNodeIds.has(nodeId);
      const filtered = spoke && !survivingNodeIds.has(nodeId);
      this.statsById.set(nodeId, {
        epochsAlive: current.epochsAlive + 1,
        epochsSpoken: current.epochsSpoken + (spoke ? 1 : 0),
        epochsFiltered: current.epochsFiltered + (filtered ? 1 : 0),
      });
    }
    this.eventStream.publish({
      topicName: 'orchestrator/node-stats-updated',
      data: {
        nodeStats: Array.from(this.statsById.entries()).map(
          ([nodeId, stats]) => ({ nodeId, stats }),
        ),
      },
    });
  }
}
