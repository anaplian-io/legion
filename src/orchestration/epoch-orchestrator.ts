import { Node } from '../types/node.js';
import { RelevanceFilter } from '../types/relevance-filter.js';
import { WorkingMemory } from '../types/working-memory.js';
import { Provider } from '../types/provider.js';
import { Distiller } from '../types/distiller.js';
import { CandidateMessage, Message } from '../types/message.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { NodeSplitter } from '../types/node-splitter.js';
import { EventStream } from '../types/event-stream.js';
import { NodePruner } from '../types/node-pruner.js';
import { NodeStats } from '../types/node-stats.js';
import { isDefined } from '../utilities/type-guards.js';
import { NodeRegistry } from '../node/support/node-registry.js';
import { WorkingMemoryBuffer } from '../node/support/working-memory-buffer.js';
import { UserInputSensor } from '../sensor/user-input-sensor.js';
import { formatMessagePayload } from '../utilities/action-request.js';
import type { GoalStore } from '../node/support/goal-store.js';
import type {
  EpochTelemetryContext,
  EpochCounts,
  TelemetryWave,
  WaveCounts,
} from '../types/telemetry.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import {
  contentHash,
  messageContentHash,
} from '../telemetry/content-evidence.js';
import type { DistillationResult } from '../types/distiller.js';

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
  readonly goalStore?: GoalStore | undefined;
  readonly telemetry: TelemetryRecorder;
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
  private readonly inputReceivedAt = new Map<string, number>();
  private readonly consumedInputIdsAwaitingSelection = new Set<string>();
  private activeEpoch: Promise<void> | undefined;

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
    const inputId = this.props.telemetry.createId('input');
    const receivedAtMs = this.props.telemetry.monotonicNow();
    this._userInputSensor.enqueue(trimmed, { id: inputId, receivedAtMs });
    this.inputReceivedAt.set(inputId, receivedAtMs);
    this.props.telemetry.record(
      'user-input.received',
      {
        inputId,
        contentHash: contentHash(trimmed),
      },
      {},
    );
    this.props.eventStream.publish({
      topicName: 'orchestrator/user-input-received',
      data: {
        content: trimmed,
      },
    });
  };

  public readonly runEpoch = async (): Promise<void> => {
    if (this.activeEpoch !== undefined) {
      throw new Error('[EpochOrchestrator] an epoch is already running');
    }
    const operation = this.executeEpoch();
    this.activeEpoch = operation;
    try {
      await operation;
    } finally {
      this.activeEpoch = undefined;
    }
  };

  /** Resolves only after any epoch that already started reaches a terminal event. */
  public readonly waitForIdle = async (): Promise<void> => {
    await this.activeEpoch;
  };

  private readonly executeEpoch = async (): Promise<void> => {
    const pendingInputIds = this._userInputSensor.nextInputIds();
    const telemetryContext = this.props.telemetry.beginEpoch(pendingInputIds);
    let afferent: EpochCandidates = { aliveNodeIds: [], candidates: [] };
    let cognitive: CognitiveWave = {
      aliveNodeIds: [],
      candidates: [],
      fallbackSpawned: false,
    };
    let afferentContext: readonly Message[] = [];
    let survivors: CandidateMessage[] = [];
    let result: DistillationResult | undefined;
    let outcomesRecorded = false;
    let candidatesResolved = false;
    let selectedCandidateCount = 0;
    try {
      // Afferent wave: tools and sensors perceive first. Their output is context
      // for the cognitive wave, never a broadcast candidate, so it bypasses the
      // relevance filter entirely (no upstream bottleneck on perception).
      afferent = await this.pollNodes(
        this._registry.afferentNodes(),
        'afferent',
        telemetryContext,
        pendingInputIds,
      );
      this.publishConsumedUserInput(telemetryContext);
      afferentContext = [
        ...this.afferentCapabilityContext(),
        ...afferent.candidates.map((c) => ({
          role: c.role === 'user-input' ? c.role : ('afferent' as const),
          content: c.content,
          originatingNodeId: c.originatingNodeId,
          candidateId: c.candidateId,
          ...(c.evidence === undefined ? {} : { evidence: c.evidence }),
          ...(c.inputIds === undefined ? {} : { inputIds: c.inputIds }),
        })),
      ];

      // Cognitive wave: memory nodes reason with the afferent context in hand.
      cognitive = await this.pollCognitiveNodes(
        afferentContext,
        telemetryContext,
        pendingInputIds,
      );
      survivors = await this.props.relevanceFilter.filter(
        this.workingMemory,
        cognitive.candidates,
        telemetryContext,
      );

      if (survivors.length === 0) {
        try {
          this.resolveCognitiveCandidates(cognitive, survivors, undefined);
        } finally {
          candidatesResolved = true;
        }
        this.recordCandidateOutcomes(
          afferent,
          cognitive,
          afferentContext,
          survivors,
          undefined,
          telemetryContext,
        );
        outcomesRecorded = true;
        this.recordEpochStats(afferent, cognitive, survivors, undefined);
        if (!cognitive.fallbackSpawned) {
          this.spawnNewNode();
        }
        this.completeTelemetryEpoch(
          telemetryContext,
          'success',
          afferent,
          cognitive,
          survivors,
          0,
        );
        return;
      }

      const distillationInput = {
        workingMemory: this.workingMemory,
        broadcasts: survivors,
        afferentContext,
        activeGoal: this.props.goalStore?.activeGoal,
      };
      result = await this.props.distiller.distill(distillationInput, {
        ...telemetryContext,
        attempt: 'configured',
        attemptId: this.props.telemetry.createId('distillation'),
        inferenceStage: 'configured-selection',
      });
      if (result === undefined) {
        throw new Error(
          '[EpochOrchestrator] distiller returned no selection for surviving candidates',
        );
      }
      const selectedBroadcast = {
        ...result.broadcast,
        role: 'broadcast' as const,
        ...(result.goalDecision.kind === 'unchanged'
          ? {}
          : { goalDecision: result.goalDecision }),
      };
      try {
        this.resolveCognitiveCandidates(cognitive, survivors, result);
      } finally {
        candidatesResolved = true;
      }
      selectedCandidateCount = this.recordCandidateOutcomes(
        afferent,
        cognitive,
        afferentContext,
        survivors,
        result,
        telemetryContext,
      );
      outcomesRecorded = true;
      this.recordEpochStats(afferent, cognitive, survivors, selectedBroadcast);
      this._workingMemory.append(selectedBroadcast);
      this.recordSelectedUserInputs(selectedBroadcast, telemetryContext);
      await this.splitOverflowingNodes(telemetryContext);
      this.pruneNodes();
      this.completeTelemetryEpoch(
        telemetryContext,
        'success',
        afferent,
        cognitive,
        survivors,
        selectedCandidateCount,
      );
    } catch (error) {
      if (!candidatesResolved) {
        try {
          this.resolveCognitiveCandidates(cognitive, survivors, undefined);
        } finally {
          candidatesResolved = true;
        }
      }
      if (!outcomesRecorded) {
        this.recordCandidateOutcomes(
          afferent,
          cognitive,
          afferentContext,
          survivors,
          result,
          telemetryContext,
        );
      }
      this.completeTelemetryEpoch(
        telemetryContext,
        'failure',
        afferent,
        cognitive,
        survivors,
        selectedCandidateCount,
      );
      throw error;
    }
  };

  private readonly pollNodes = async (
    nodes: Node<string>[],
    wave: TelemetryWave,
    telemetryContext: EpochTelemetryContext,
    inputIds: readonly string[] = [],
    afferentContext?: readonly Message[],
  ): Promise<EpochCandidates> => {
    const nodeStats = this._registry.stats();
    const responses = await Promise.all(
      nodes.map(async (node) => {
        const candidateId = this.props.telemetry.createId('candidate');
        try {
          return {
            node,
            candidateId,
            response: await node.sendMessage({
              workingMemory: this.workingMemory,
              broadcast: this.currentBroadcast,
              recipientNodeStats: nodeStats.get(node.id)!,
              afferentContext,
              telemetry: {
                ...telemetryContext,
                wave,
                candidateId,
                nodeId: node.id,
                inputIds,
              },
            }),
          };
        } catch (e) {
          this.props.eventStream.reportError?.({
            source: 'EpochOrchestrator',
            message: `Node ${node.id} threw while processing an epoch.`,
            error: e,
            metadata: { nodeId: node.id },
            telemetry: {
              ...telemetryContext,
              wave,
              candidateId,
              nodeId: node.id,
            },
          });
          return { node, candidateId, response: undefined };
        }
      }),
    );
    const result: EpochCandidates = {
      aliveNodeIds: responses.map(({ node }) => node.id),
      candidates: responses
        .map(({ node, response, candidateId }) =>
          response
            ? {
                role: response.role,
                content: response.content,
                originatingNodeId: response.originatingNodeId ?? node.id,
                candidateId,
                ...(response.actionRequests === undefined
                  ? {}
                  : { actionRequests: response.actionRequests }),
                ...(response.evidence === undefined
                  ? {}
                  : { evidence: response.evidence }),
                ...(response.role !== 'user-input' || inputIds.length === 0
                  ? response.inputIds === undefined
                    ? {}
                    : { inputIds: response.inputIds }
                  : { inputIds }),
              }
            : undefined,
        )
        .filter(isDefined),
    };
    result.candidates.forEach((candidate) => {
      this.props.telemetry.record(
        'candidate.generated',
        {
          candidateId: candidate.candidateId,
          originatingNodeId: candidate.originatingNodeId,
          wave,
          contentHash: messageContentHash(candidate),
          evidence: candidate.evidence ?? [],
          inputIds: candidate.inputIds ?? [],
        },
        {
          ...telemetryContext,
          wave,
          candidateId: candidate.candidateId,
          nodeId: candidate.originatingNodeId,
        },
      );
    });
    return result;
  };

  private readonly pollCognitiveNodes = async (
    afferentContext: readonly Message[],
    telemetryContext: EpochTelemetryContext,
    inputIds: readonly string[] = [],
  ): Promise<CognitiveWave> => {
    const cognitive = await this.pollNodes(
      this._registry.memoryNodes(),
      'cognitive',
      telemetryContext,
      inputIds,
      afferentContext,
    );

    if (cognitive.candidates.length > 0) {
      return { ...cognitive, fallbackSpawned: false };
    }

    const fallbackNode = this.spawnNewNode();
    const fallback = await this.pollNodes(
      [fallbackNode],
      'cognitive',
      telemetryContext,
      inputIds,
      afferentContext,
    );

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
    selected: Message | undefined,
  ): void => {
    const attentionPassingNodeIds = new Set(
      survivors.map((s) => s.originatingNodeId).filter(isDefined),
    );
    // Afferent output bypasses the relevance filter, so every generated
    // afferent candidate is counted as attention-passing.
    afferent.candidates.forEach((c) =>
      attentionPassingNodeIds.add(c.originatingNodeId),
    );

    this._registry.recordEpoch({
      aliveNodeIds: [...afferent.aliveNodeIds, ...cognitive.aliveNodeIds],
      generatedNodeIds: new Set(
        [...afferent.candidates, ...cognitive.candidates].map(
          (c) => c.originatingNodeId,
        ),
      ),
      attentionPassingNodeIds,
      selectedNodeIds: new Set(
        selected === undefined
          ? []
          : [
              ...(selected.contributingNodeIds ?? []),
              ...(selected.originatingNodeId === undefined
                ? []
                : [selected.originatingNodeId]),
            ],
      ),
    });
  };

  private readonly resolveCognitiveCandidates = (
    cognitive: CognitiveWave,
    survivors: readonly CandidateMessage[],
    result: DistillationResult | undefined,
  ): void => {
    const selectedCandidateIds = new Set<string>();
    result?.supportingEvidence.forEach((reference) => {
      if (reference.source !== 'candidate') {
        return;
      }
      const candidateId = survivors[reference.index]?.candidateId;
      if (candidateId !== undefined) {
        selectedCandidateIds.add(candidateId);
      }
    });
    const memoryNodesById = new Map(
      this._registry.memoryNodes().map((node) => [node.id, node]),
    );
    cognitive.candidates.forEach((candidate) => {
      const node = memoryNodesById.get(candidate.originatingNodeId);
      if (node?.resolveCandidate === undefined) {
        throw new Error(
          `[EpochOrchestrator] memory node ${candidate.originatingNodeId} cannot resolve candidate ${candidate.candidateId}`,
        );
      }
      node.resolveCandidate(
        candidate.candidateId,
        selectedCandidateIds.has(candidate.candidateId)
          ? 'selected'
          : 'rejected',
      );
    });
  };

  private readonly splitOverflowingNodes = async (
    telemetryContext: EpochTelemetryContext,
  ): Promise<void> => {
    await Promise.all(
      this._registry
        .memoryNodes()
        .filter(
          (node) => node.context.length > this.props.contextLengthThreshold,
        )
        .map(async (node) => {
          const [left, right] = await this.props.memoryNodeSplitter.split(
            node,
            telemetryContext,
          );
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

  private readonly publishConsumedUserInput = (
    telemetryContext: EpochTelemetryContext,
  ): void => {
    this._userInputSensor
      .consumeLastSensedInputRecords()
      .forEach(({ id, content, receivedAtMs }) => {
        this.consumedInputIdsAwaitingSelection.add(id);
        this.props.eventStream.publish({
          topicName: 'orchestrator/user-input-consumed',
          data: { content },
        });
        this.props.telemetry.record(
          'user-input.consumed',
          {
            inputId: id,
            latencyMs: this.props.telemetry.durationSince(receivedAtMs),
          },
          telemetryContext,
        );
      });
  };

  private readonly recordCandidateOutcomes = (
    afferent: EpochCandidates,
    cognitive: EpochCandidates,
    afferentContext: readonly Message[],
    survivors: readonly CandidateMessage[],
    result: DistillationResult | undefined,
    telemetryContext: EpochTelemetryContext,
  ): number => {
    const survivorIds = new Set(
      survivors.map(({ candidateId }) => candidateId),
    );
    const selectedIds = new Set<string>();
    result?.supportingEvidence.forEach((reference) => {
      const message =
        reference.source === 'candidate'
          ? survivors[reference.index]
          : afferentContext[reference.index];
      if (message?.candidateId !== undefined) {
        selectedIds.add(message.candidateId);
      }
    });
    const record = (candidate: CandidateMessage, wave: TelemetryWave): void => {
      this.props.telemetry.record(
        'candidate.outcome',
        {
          candidateId: candidate.candidateId,
          originatingNodeId: candidate.originatingNodeId,
          wave,
          attentionOutcome:
            wave === 'afferent'
              ? 'bypassed'
              : survivorIds.has(candidate.candidateId)
                ? 'passed'
                : 'rejected',
          selectionOutcome: selectedIds.has(candidate.candidateId)
            ? wave === 'afferent'
              ? 'supporting-evidence'
              : 'selected'
            : 'not-selected',
        },
        {
          ...telemetryContext,
          wave,
          candidateId: candidate.candidateId,
          nodeId: candidate.originatingNodeId,
        },
      );
    };
    afferent.candidates.forEach((candidate) => record(candidate, 'afferent'));
    cognitive.candidates.forEach((candidate) => record(candidate, 'cognitive'));
    return cognitive.candidates.filter(({ candidateId }) =>
      selectedIds.has(candidateId),
    ).length;
  };

  private readonly completeTelemetryEpoch = (
    context: EpochTelemetryContext,
    status: 'success' | 'failure',
    afferent: EpochCandidates,
    cognitive: EpochCandidates,
    survivors: readonly Message[],
    selected: number,
  ): void => {
    const afferentCounts: EpochCounts = {
      generated: afferent.candidates.length,
      attentionPassed: afferent.candidates.length,
      selected: 0,
    };
    const cognitiveCounts: EpochCounts = {
      generated: cognitive.candidates.length,
      attentionPassed: survivors.length,
      selected,
    };
    const waveCounts: WaveCounts = {
      afferent: afferentCounts,
      cognitive: cognitiveCounts,
    };
    this.props.telemetry.completeEpoch(context, {
      status,
      counts: {
        generated: afferentCounts.generated + cognitiveCounts.generated,
        attentionPassed:
          afferentCounts.attentionPassed + cognitiveCounts.attentionPassed,
        selected,
      },
      waveCounts,
    });
  };

  private readonly recordSelectedUserInputs = (
    broadcast: Message,
    context: EpochTelemetryContext,
  ): void => {
    const now = this.props.telemetry.monotonicNow();
    this.consumedInputIdsAwaitingSelection.forEach((inputId) => {
      const received = this.inputReceivedAt.get(inputId)!;
      this.props.telemetry.record(
        'user-input.broadcast-selected',
        {
          inputId,
          latencyMs: Math.max(0, now - received),
          broadcastHash: messageContentHash(broadcast),
        },
        context,
      );
      this.inputReceivedAt.delete(inputId);
      this.consumedInputIdsAwaitingSelection.delete(inputId);
    });
  };

  private readonly spawnNewNode = (): Node<'memory'> => {
    const node = this.props.memoryNodeFactory.create({
      initialContext: [...this.workingMemory.messages, this.currentBroadcast]
        .map(formatMessagePayload)
        .join('\n'),
      eventStream: this.props.eventStream,
    });
    this.addNode(node);
    return node;
  };
}
