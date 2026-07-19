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
import { UserInputSensor } from '../sensor/user-input-sensor.js';

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
  readonly initialNodeStats?: Map<string, NodeStats> | undefined;
  readonly userInputSensor?: UserInputSensor | undefined;
}

interface CandidateMessage extends Message {
  readonly originatingNodeId: string;
}

interface EpochCandidates {
  // Ids of every node polled this epoch.
  readonly aliveNodeIds: string[];
  readonly candidates: CandidateMessage[];
}

interface CognitiveWave extends EpochCandidates {
  readonly fallbackSpawned: boolean;
}

export class EpochOrchestrator {
  private readonly _registry: NodeRegistry;
  private readonly _workingMemory: WorkingMemoryBuffer;
  private readonly _userInputSensor: UserInputSensor;

  constructor(private readonly props: EpochOrchestratorProps) {
    this._registry = new NodeRegistry(
      props.eventStream,
      props.initialNodeStats,
    );
    this._workingMemory = new WorkingMemoryBuffer({
      maxMessages: props.maxWorkingMemoryMessages,
      eventStream: props.eventStream,
      initial: props.initialWorkingMemory,
      initialBroadcast: props.initialBroadcast,
    });
    this._userInputSensor = props.userInputSensor ?? new UserInputSensor();
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
    return this._workingMemory.currentBroadcast;
  }

  public readonly receiveUserInput = (content: string): void => {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return;
    }
    this._userInputSensor.enqueue(trimmed);
    this.props.eventStream.publish({
      topicName: 'orchestrator/user-input-received',
      data: {
        content: trimmed,
      },
    });
  };

  public readonly runEpoch = async (): Promise<void> => {
    // Afferent wave: tools and sensors perceive first. Their output is context
    // for the cognitive wave, never a broadcast candidate, so it bypasses the
    // relevance filter entirely (no upstream bottleneck on perception).
    const afferent = await this.pollNodes(this._registry.afferentNodes());
    this.publishConsumedUserInput();
    const afferentContext = [
      ...this.afferentCapabilityContext(),
      ...afferent.candidates.map((c) => ({
        role: c.role === 'user-input' ? c.role : ('afferent' as const),
        content: c.content,
        originatingNodeId: c.originatingNodeId,
      })),
    ];

    // Cognitive wave: memory nodes reason with the afferent context in hand.
    const cognitive = await this.pollCognitiveNodes(afferentContext);
    const survivors = await this.props.relevanceFilter.filter(
      this.workingMemory,
      cognitive.candidates,
    );

    this.recordEpochStats(afferent, cognitive, survivors);

    if (survivors.length === 0) {
      if (!cognitive.fallbackSpawned) {
        this.spawnNewNode();
      }
      return;
    }

    await this.distill(survivors, afferentContext);
    await this.splitOverflowingNodes();
    this.pruneNodes();
  };

  private readonly pollNodes = async (
    nodes: Node<string>[],
    afferentContext?: readonly Message[],
  ): Promise<EpochCandidates> => {
    const nodeStats = this._registry.stats();
    const responses = await Promise.all(
      nodes.map(async (node) => {
        try {
          return {
            node,
            response: await node.sendMessage({
              workingMemory: this.workingMemory,
              broadcast: this.currentBroadcast,
              recipientNodeStats: nodeStats.get(node.id)!,
              afferentContext,
            }),
          };
        } catch (e) {
          this.props.eventStream.reportError?.({
            source: 'EpochOrchestrator',
            message: `Node ${node.id} threw while processing an epoch.`,
            error: e,
            metadata: { nodeId: node.id },
          });
          return { node, response: undefined };
        }
      }),
    );
    return {
      aliveNodeIds: responses.map(({ node }) => node.id),
      candidates: responses
        .map(({ node, response }) =>
          response
            ? {
                role: response.role,
                content: response.content,
                originatingNodeId: response.originatingNodeId ?? node.id,
              }
            : undefined,
        )
        .filter(isDefined),
    };
  };

  private readonly pollCognitiveNodes = async (
    afferentContext: readonly Message[],
  ): Promise<CognitiveWave> => {
    const cognitive = await this.pollNodes(
      this._registry.memoryNodes(),
      afferentContext,
    );

    if (cognitive.candidates.length > 0) {
      return { ...cognitive, fallbackSpawned: false };
    }

    const fallbackNode = this.spawnNewNode();
    const fallback = await this.pollNodes([fallbackNode], afferentContext);

    return {
      aliveNodeIds: [...cognitive.aliveNodeIds, ...fallback.aliveNodeIds],
      candidates: fallback.candidates,
      fallbackSpawned: true,
    };
  };

  private readonly afferentCapabilityContext = (): readonly Message[] => {
    const capabilities = this._registry
      .afferentNodes()
      .filter((node) => node.capabilityDescription !== undefined)
      .map((node) => `- ${node.id}: ${node.capabilityDescription}`);

    if (capabilities.length === 0) {
      return [];
    }

    return [
      {
        role: 'afferent-capability',
        content: `Available afferent capabilities:\n${capabilities.join('\n')}`,
      },
    ];
  };

  private readonly recordEpochStats = (
    afferent: EpochCandidates,
    cognitive: EpochCandidates,
    survivors: Message[],
  ): void => {
    const survivingNodeIds = new Set(
      survivors.map((s) => s.originatingNodeId).filter(isDefined),
    );
    // Afferent output never passes through the relevance filter, so a spoken
    // afferent node is counted as surviving (its filter rate stays 0).
    afferent.candidates.forEach((c) =>
      survivingNodeIds.add(c.originatingNodeId),
    );

    this._registry.recordEpoch({
      aliveNodeIds: [...afferent.aliveNodeIds, ...cognitive.aliveNodeIds],
      spokenNodeIds: new Set(
        [...afferent.candidates, ...cognitive.candidates].map(
          (c) => c.originatingNodeId,
        ),
      ),
      survivingNodeIds,
    });
  };

  private readonly distill = async (
    survivors: Message[],
    afferentContext: readonly Message[],
  ): Promise<void> => {
    const content = await this.props.distiller.distill({
      workingMemory: this.workingMemory,
      broadcasts: survivors.map((message) => message.content),
      afferentContext,
    });
    this._workingMemory.append({ role: 'broadcast', content });
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

  private readonly publishConsumedUserInput = (): void => {
    this._userInputSensor.consumeLastSensedInputs().forEach((content) => {
      this.props.eventStream.publish({
        topicName: 'orchestrator/user-input-consumed',
        data: { content },
      });
    });
  };

  private readonly spawnNewNode = (): Node<'memory'> => {
    const node = this.props.memoryNodeFactory.create({
      initialContext: [...this.workingMemory.messages, this.currentBroadcast]
        .map((message) => message.content)
        .join('\n'),
      eventStream: this.props.eventStream,
    });
    this.addNode(node);
    return node;
  };
}
