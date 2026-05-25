import { Node } from '../types/node.js';
import { RelevanceFilter } from '../types/relevance-filter.js';
import { WorkingMemory } from '../types/working-memory.js';
import { Provider } from '../types/provider.js';
import { Distiller } from '../types/distiller.js';
import { Message } from '../types/message.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { NodeSplitter } from '../types/node-splitter.js';
import { EventStream } from '../types/event-stream.js';
import { MemoryNode } from '../node/memory-node.js';
import { isDefined } from '../utilities/is-defined.js';

export interface EpochOrchestratorProps {
  readonly provider: Provider;
  readonly relevanceFilter: RelevanceFilter;
  readonly distiller: Distiller;
  readonly maxWorkingMemoryMessages: number;
  readonly contextLengthThreshold: number;
  readonly memoryNodeSplitter: NodeSplitter<'memory'>;
  readonly initialWorkingMemory?: WorkingMemory;
  readonly initialBroadcast: Message;
  readonly memoryNodeFactory: MemoryNodeFactory;
  readonly eventStream: EventStream;
  readonly initialNodes?: Node<string>[];
}

export class EpochOrchestrator {
  private _currentBroadcast: Message;
  private readonly _nodes = new Map<string, Node<string>>();
  private readonly _workingMemory: WorkingMemory;

  constructor(private readonly props: EpochOrchestratorProps) {
    this._workingMemory = props.initialWorkingMemory ?? { messages: [] };
    this._currentBroadcast = props.initialBroadcast;
    props.initialNodes?.forEach((node) => this.addNode(node));
  }

  public get nodes(): Node<string>[] {
    return Array.from(this._nodes.values());
  }

  public addNode(node: Node<string>): void {
    this._nodes.set(node.id, node);
    this.props.eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: this.nodes },
    });
    this.props.eventStream.publish({
      topicName: 'orchestrator/node-added',
      data: {
        addedNodes: [node],
      },
    });
  }

  public removeNode(nodeId: string): void {
    this._nodes.delete(nodeId);
    this.props.eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: this.nodes },
    });

    this.props.eventStream.publish({
      topicName: 'orchestrator/node-removed',
      data: {
        removedNodeIds: [nodeId],
      },
    });
  }

  public get workingMemory(): WorkingMemory {
    return this._workingMemory;
  }

  public get currentBroadcast(): Message {
    return this._currentBroadcast;
  }

  public readonly runEpoch = async (): Promise<void> => {
    const nodeBroadcasts = Array.from(this._nodes.values()).map(
      async (node) => {
        try {
          return {
            node,
            response: await node.sendMessage({
              workingMemory: this._workingMemory,
              broadcast: this._currentBroadcast,
            }),
          };
        } catch (e) {
          console.warn(
            `[EpochOrchestrator] Node ${node.id} threw an error: ${e}`,
          );
          return {
            node,
            response: undefined,
          };
        }
      },
    );
    const nodeResponses = await Promise.all(nodeBroadcasts);
    const candidateMessages = nodeResponses
      .map(({ node, response }) =>
        response
          ? { content: response.content, originatingNodeId: node.id }
          : undefined,
      )
      .filter(
        (message): message is { content: string; originatingNodeId: string } =>
          message !== undefined,
      );
    const filteredMessages = await this.props.relevanceFilter.filter(
      this._workingMemory,
      candidateMessages,
    );
    const sourceMemoryNodes = filteredMessages
      .map((message) => message.originatingNodeId)
      .filter(isDefined)
      .map((id) => this._nodes.get(id))
      .filter(isDefined)
      .filter((node): node is MemoryNode => node.kind === 'memory');
    if (sourceMemoryNodes.length === 0) {
      this.spawnNewNode();
      return;
    }
    const nextBroadcastContent = await this.props.distiller.distill({
      workingMemory: this._workingMemory,
      broadcasts: filteredMessages.map((message) => message.content),
    });
    this._workingMemory.messages.push({
      content: this._currentBroadcast.content,
    });
    this._currentBroadcast = {
      content: nextBroadcastContent,
    };
    this.pruneWorkingMemory();
    await this.checkAndSplitMemoryNodes();
  };

  private readonly checkAndSplitMemoryNodes = async (): Promise<void> => {
    await Promise.all(
      Array.from(this._nodes.values())
        .filter((node): node is MemoryNode => node.kind === 'memory')
        .filter(
          (node) => node.context.length > this.props.contextLengthThreshold,
        )
        .map(async (node) => {
          const [left, right] = await this.props.memoryNodeSplitter.split(node);
          this.removeNode(node.id);
          this.addNode(left);
          this.addNode(right);
        }),
    );
  };

  private readonly spawnNewNode = (): void => {
    const initialContext =
      this._workingMemory.messages.length > 0
        ? this._workingMemory.messages.map((m) => m.content).join('\n')
        : this._currentBroadcast.content;
    const newNode = this.props.memoryNodeFactory.create({
      initialContext,
      eventStream: this.props.eventStream,
    });
    this.addNode(newNode);
  };

  private readonly pruneWorkingMemory = (): void => {
    while (
      this._workingMemory.messages.length > this.props.maxWorkingMemoryMessages
    ) {
      this._workingMemory.messages.shift();
    }
    this.props.eventStream.publish({
      topicName: 'orchestrator/working-memory-updated',
      data: {
        workingMemory: this.workingMemory,
        broadcast: this.currentBroadcast,
      },
    });
  };
}
