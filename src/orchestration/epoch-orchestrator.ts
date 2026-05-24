import { Node } from '../types/node.js';
import { RelevanceFilter } from '../types/relevance-filter.js';
import { WorkingMemory } from '../types/working-memory.js';
import { Provider } from '../types/provider.js';
import { Distiller } from '../types/distiller.js';
import { Message } from '../types/message.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { NodeSplitter } from '../types/node-splitter.js';
import { MemoryNode } from '../node/memory-node.js';

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
}

export class EpochOrchestrator {
  private _currentBroadcast: Message;
  private readonly _nodes = new Map<string, Node<string>>();
  private readonly _workingMemory: WorkingMemory;

  constructor(private readonly props: EpochOrchestratorProps) {
    this._workingMemory = props.initialWorkingMemory ?? { messages: [] };
    this._currentBroadcast = props.initialBroadcast;
  }

  public getNodes(): readonly Node<string>[] {
    return Array.from(this._nodes.values());
  }

  public addNode(node: Node<string>): void {
    this._nodes.set(node.id, node);
  }

  public removeNode(nodeId: string): void {
    this._nodes.delete(nodeId);
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
        return {
          node,
          response: await node.sendMessage({
            workingMemory: this._workingMemory,
            broadcast: this._currentBroadcast,
          }),
        };
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
    if (filteredMessages.length === 0) {
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
    const newNode = this.props.memoryNodeFactory.create(initialContext);
    this._nodes.set(newNode.id, newNode);
  };

  private readonly pruneWorkingMemory = (): void => {
    while (
      this._workingMemory.messages.length > this.props.maxWorkingMemoryMessages
    ) {
      this._workingMemory.messages.shift();
    }
  };
}
