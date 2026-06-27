import { Node } from '../types/node.js';
import { RelevanceFilter } from '../types/relevance-filter.js';
import { WorkingMemory } from '../types/working-memory.js';
import { Provider } from '../types/provider.js';
import { Distiller } from '../types/distiller.js';
import { Message } from '../types/message.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { NodeSplitter } from '../types/node-splitter.js';
import { EventStream } from '../types/event-stream.js';
import { NodePruner } from '../types/node-pruner.js';
import { NodeStats } from '../types/node-stats.js';
import { isDefined } from '../utilities/is-defined.js';
import { NodeRegistry } from '../service/node-registry.js';
import { WorkingMemoryBuffer } from '../service/working-memory-buffer.js';

export interface EpochOrchestratorProps {
  readonly provider: Provider;
  readonly relevanceFilter: RelevanceFilter;
  readonly distiller: Distiller;
  readonly maxWorkingMemoryMessages: number;
  readonly contextLengthThreshold: number;
  readonly memoryNodeSplitter: NodeSplitter<'memory'>;
  readonly nodePruner: NodePruner;
  readonly initialWorkingMemory?: WorkingMemory;
  readonly initialBroadcast: Message;
  readonly memoryNodeFactory: MemoryNodeFactory;
  readonly eventStream: EventStream;
  readonly initialNodes?: Node<string>[];
}

interface CandidateMessage {
  readonly content: string;
  readonly originatingNodeId: string;
}

interface EpochCandidates {
  // Ids of every node polled this epoch (split/spawned nodes added later begin
  // next epoch).
  readonly aliveNodeIds: string[];
  readonly candidates: CandidateMessage[];
}

export class EpochOrchestrator {
  private _currentBroadcast: Message;
  private readonly _registry: NodeRegistry;
  private readonly _workingMemory: WorkingMemoryBuffer;

  constructor(private readonly props: EpochOrchestratorProps) {
    this._registry = new NodeRegistry(props.eventStream);
    this._workingMemory = new WorkingMemoryBuffer({
      maxMessages: props.maxWorkingMemoryMessages,
      eventStream: props.eventStream,
      initial: props.initialWorkingMemory,
    });
    this._currentBroadcast = props.initialBroadcast;
    props.initialNodes?.forEach((node) => this.addNode(node));
  }

  public get nodes(): Node<string>[] {
    return this._registry.all();
  }

  public get nodeStats(): Map<string, NodeStats> {
    return this._registry.stats();
  }

  public addNode(node: Node<string>): void {
    this._registry.register(node);
  }

  public removeNode(nodeId: string): void {
    this._registry.unregister(nodeId);
  }

  public get workingMemory(): WorkingMemory {
    return this._workingMemory.workingMemory;
  }

  public get currentBroadcast(): Message {
    return this._currentBroadcast;
  }

  public readonly runEpoch = async (): Promise<void> => {
    const { aliveNodeIds, candidates } = await this.gatherCandidates();
    const survivors = await this.props.relevanceFilter.filter(
      this.workingMemory,
      candidates,
    );

    this._registry.recordEpoch({
      aliveNodeIds,
      spokenNodeIds: new Set(candidates.map((c) => c.originatingNodeId)),
      survivingNodeIds: new Set(
        survivors.map((s) => s.originatingNodeId).filter(isDefined),
      ),
    });

    if (this.survivingMemoryNodes(survivors).length === 0) {
      this.spawnNewNode();
      return;
    }

    this._currentBroadcast = await this.distill(survivors);
    await this.splitOverflowingNodes();
    this.pruneNodes();
  };

  private readonly gatherCandidates = async (): Promise<EpochCandidates> => {
    const responses = await Promise.all(
      this._registry.all().map(async (node) => {
        try {
          return {
            node,
            response: await node.sendMessage({
              workingMemory: this.workingMemory,
              broadcast: this._currentBroadcast,
            }),
          };
        } catch (e) {
          console.warn(
            `[EpochOrchestrator] Node ${node.id} threw an error: ${e}`,
          );
          return { node, response: undefined };
        }
      }),
    );
    return {
      aliveNodeIds: responses.map(({ node }) => node.id),
      candidates: responses
        .map(({ node, response }) =>
          response
            ? { content: response.content, originatingNodeId: node.id }
            : undefined,
        )
        .filter(isDefined),
    };
  };

  private readonly survivingMemoryNodes = (survivors: Message[]) =>
    survivors
      .map((message) => message.originatingNodeId)
      .filter(isDefined)
      .map((id) => this._registry.all().find((node) => node.id === id))
      .filter(isDefined)
      .filter((node) => node.kind === 'memory');

  private readonly distill = async (survivors: Message[]): Promise<Message> => {
    const content = await this.props.distiller.distill({
      workingMemory: this.workingMemory,
      broadcasts: survivors.map((message) => message.content),
    });
    this._workingMemory.append(
      { content: this._currentBroadcast.content },
      { content },
    );
    return { content };
  };

  private readonly splitOverflowingNodes = async (): Promise<void> => {
    await Promise.all(
      this._registry
        .memoryNodes()
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

  private readonly pruneNodes = (): void => {
    this.props.nodePruner
      .selectForPruning(this._registry.memoryNodes(), this._registry.stats())
      .forEach((node) => this.removeNode(node.id));
  };

  private readonly spawnNewNode = (): void => {
    const initialContext =
      this.workingMemory.messages.length > 0
        ? this.workingMemory.messages.map((m) => m.content).join('\n')
        : this._currentBroadcast.content;
    this.addNode(
      this.props.memoryNodeFactory.create({
        initialContext,
        eventStream: this.props.eventStream,
      }),
    );
  };
}
