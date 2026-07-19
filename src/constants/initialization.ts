import rawSettings from '../../settings.js';
import { OpenAI } from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDefined } from '../utilities/is-defined.js';
import {
  LegionSettings,
  SensorProviderDefinition,
} from '../types/legion-settings.js';
import { OpenaiProvider } from '../provider/openai-provider.js';
import { SensoryNode } from '../node/sensory-node.js';
import { ConcreteToolNodeFactory } from '../factory/concrete-tool-node-factory.js';
import { LlmRelevanceFilter } from '../service/llm-relevance-filter.js';
import { StaticAttentionGate } from '../service/static-attention-gate.js';
import { BestBroadcastDistiller } from '../service/best-broadcast-distiller.js';
import { LlmDistiller } from '../service/llm-distiller.js';
import { MemoryNodeSplitter } from '../service/memory-node-splitter.js';
import { StaticNodePruner } from '../service/static-node-pruner.js';
import { ConcreteMemoryNodeFactory } from '../factory/concrete-memory-node-factory.js';
import { EventStream } from '../types/event-stream.js';
import { Node } from '../types/node.js';
import { EpochOrchestrator } from '../orchestration/epoch-orchestrator.js';
import { LoadedSession, SessionLoader } from '../utilities/session-loader.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import { SessionSaver } from '../utilities/session-saver.js';
import { QueuingOpenAi } from '../adapter/queuing-open-ai.js';
import { FirstEpochThenFixedCuriosityGate } from '../service/first-epoch-then-fixed-curiosity-gate.js';
import { FixedProbabilityCuriosityGate } from '../service/fixed-probability-curiosity-gate.js';
import { AskYesNoQuestionRelevanceGate } from '../service/ask-yes-no-question-relevance-gate.js';
import { SequencedCompositeRelevanceGate } from '../service/sequenced-composite-relevance-gate.js';
import { Provider } from '../types/provider.js';
import { UserInputSensor } from '../sensor/user-input-sensor.js';
import { TargetedActionRequestRelevanceGate } from '../service/targeted-action-request-relevance-gate.js';
import { MCPClient } from '../adapter/mcp-client.js';
import { ToolDefinition } from '../types/tool.js';
import {
  PersistedMcpServerSummaries,
  PersistedMcpServerSummary,
} from '../types/mcp-server-summary.js';
import {
  defaultMcpServerCapabilityDescription,
  resolveMcpServerCapabilityDescription,
} from '../service/mcp-server-summary-resolver.js';
import { GoalStore } from '../service/goal-store.js';
import { GoalNode } from '../node/goal-node.js';
import { ActiveGoalSensor } from '../sensor/active-goal-sensor.js';
import type { ActiveGoal } from '../types/goal.js';
import path from 'node:path';
import { ConcreteErrorStream } from '../service/concrete-error-stream.js';
import { JsonlLogRouter } from '../service/jsonl-log-router.js';
import { LogRouter } from '../types/logging.js';
import { ErrorStream } from '../types/error-stream.js';

const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_TOOL_CURIOSITY_PROBABILITY = 0.02;
const DEFAULT_MEMORY_CURIOSITY_PROBABILITY = 0.03;
const DEFAULT_ATTENTION_GATE_N = 2;
const MEMORY_RELEVANCE_QUESTION =
  'Given your experience above and the full message list below, can you add something the collective does not already have? If user input is present, answer yes when you can help acknowledge it, answer it, or preserve enough context to resume the prior inquiry. Otherwise answer yes only if your contribution would be specific and non-redundant.';
const TOOL_RELEVANCE_QUESTION =
  'Given your node ID, capability, tools, and the full message list below, will one or more tools make concrete progress on any unresolved need? Treat earlier messages as working memory and the final message as the current broadcast. If the final broadcast explicitly names your node ID or @nodeID with a concrete request, answer yes. Otherwise answer yes only if a tool call would make concrete progress.';

export interface InitOptions {
  /** Reuse a process-level router; omitted callers get `saveLocation/logs`. */
  readonly logRouter?: LogRouter;
  /** Reuse the process-level error stream, including for initialization errors. */
  readonly errorStream?: ErrorStream;
}

const createSensoryNode = ({
  definition,
  provider,
  eventStream,
}: {
  readonly definition: SensorProviderDefinition;
  readonly provider: Provider;
  readonly eventStream: EventStream;
}): SensoryNode =>
  new SensoryNode({
    id: definition.id ?? `sensor-${crypto.randomUUID().slice(0, 8)}`,
    provider,
    eventStream,
    sensor: definition.sensor,
    capabilityDescription: definition.capabilityDescription,
    ...(definition.responseRole === undefined
      ? {}
      : { responseRole: definition.responseRole }),
  });

export const init = async (options?: InitOptions) => {
  const settings: LegionSettings = rawSettings;
  const openAiTimeout = settings.openAiTimeout ?? DEFAULT_OPENAI_TIMEOUT_MS;

  const logRouter =
    options?.logRouter ??
    new JsonlLogRouter({
      directory: path.join(settings.saveLocation, 'logs'),
    });
  const errorStream =
    options?.errorStream ?? new ConcreteErrorStream({ logRouter });

  // Create OpenAI client and provider
  const openAi = new OpenAI({
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    maxRetries: settings.openAiMaxRetries ?? 0,
    timeout: openAiTimeout,
  });

  const model = settings.model;
  const provider = new OpenaiProvider({
    model,
    client: new QueuingOpenAi({
      client: openAi,
      maxParallelism: settings.maxParallelism ?? 4,
      retryOptions: { retries: 3 },
      totalTimeout: openAiTimeout,
    }),
  });

  // Create event stream for node communication
  const eventStream = new ConcreteEventStream({ errorStream, logRouter });

  let initialActiveGoal: ActiveGoal | undefined;
  try {
    initialActiveGoal = SessionLoader.loadActiveGoal({
      directory: settings.saveLocation,
    });
  } catch (error) {
    eventStream.reportError?.({
      source: 'Init',
      message: 'Failed to load the active goal.',
      error,
    });
  }
  const goalStore = new GoalStore({
    eventStream,
    ...(initialActiveGoal === undefined ? {} : { initialActiveGoal }),
  });

  // Try to load a session if saveLocation is configured
  const memoryRelevanceGate = new SequencedCompositeRelevanceGate({
    gates: [
      new FirstEpochThenFixedCuriosityGate(Math.random, {
        probability:
          settings.memoryCuriosityProbability ??
          DEFAULT_MEMORY_CURIOSITY_PROBABILITY,
      }),
      new AskYesNoQuestionRelevanceGate({
        provider,
        question: MEMORY_RELEVANCE_QUESTION,
      }),
    ],
  });
  const toolRelevanceGate = new SequencedCompositeRelevanceGate({
    gates: [
      new TargetedActionRequestRelevanceGate(),
      new FixedProbabilityCuriosityGate({
        probability:
          settings.toolCuriosityProbability ??
          DEFAULT_TOOL_CURIOSITY_PROBABILITY,
      }),
      new AskYesNoQuestionRelevanceGate({
        provider,
        question: TOOL_RELEVANCE_QUESTION,
      }),
    ],
  });
  let loadedSession: LoadedSession | undefined;
  try {
    eventStream.publish({
      topicName: 'system/notice',
      data: {
        message: 'Attempting to load the saved session.',
        metadata: { directory: settings.saveLocation },
      },
    });
    const memoryNodeFactory = new ConcreteMemoryNodeFactory({
      provider,
      relevanceGate: memoryRelevanceGate,
    });
    loadedSession = SessionLoader.load({
      directory: settings.saveLocation,
      eventStream,
      memoryNodeFactory,
    });
    if (loadedSession) {
      eventStream.publish({
        topicName: 'system/notice',
        data: {
          message: 'Loaded a saved session.',
          metadata: { nodeCount: loadedSession.nodes.length },
        },
      });
    }
  } catch (e) {
    eventStream.reportError?.({
      source: 'Init',
      message: 'Failed to load the saved session.',
      error: e,
    });
  }

  let persistedMcpServerSummaries: PersistedMcpServerSummaries = {};
  try {
    persistedMcpServerSummaries = SessionLoader.loadMcpServerSummaries({
      directory: settings.saveLocation,
    });
  } catch (e) {
    eventStream.reportError?.({
      source: 'Init',
      message: 'Failed to load persisted MCP server summaries.',
      error: e,
    });
  }

  const mcpClients: Array<{
    readonly name: string;
    readonly client: Client;
    readonly tools: readonly ToolDefinition[];
    readonly capabilityDescription: string;
    readonly generatedSummary?: PersistedMcpServerSummary;
  }> = settings.mcpServers
    ? (
        await Promise.all(
          Object.entries(settings.mcpServers).map(
            async ([name, definition]) => {
              const client = new Client({
                name,
                version: '0.1.0',
              });
              try {
                await client.connect(
                  new StdioClientTransport({
                    command: definition.command,
                    ...(definition.args === undefined
                      ? {}
                      : { args: definition.args }),
                    ...(definition.env === undefined
                      ? {}
                      : { env: definition.env }),
                    ...(definition.cwd === undefined
                      ? {}
                      : { cwd: definition.cwd }),
                  }),
                );
                eventStream.publish({
                  topicName: 'system/notice',
                  data: {
                    message: 'Connected an MCP client.',
                    metadata: { name },
                  },
                });
                const tools = await new MCPClient({
                  client,
                  errorStream,
                }).getAvailableTools();
                const resolution = await resolveMcpServerCapabilityDescription({
                  name,
                  configuredCapabilityDescription:
                    definition.capabilityDescription,
                  provider,
                  tools,
                  persistedSummaries: persistedMcpServerSummaries,
                }).catch((e: unknown) => {
                  eventStream.reportError?.({
                    source: 'Init',
                    message: 'Failed to generate an MCP server summary.',
                    error: e,
                    metadata: { name },
                  });
                  return {
                    capabilityDescription:
                      defaultMcpServerCapabilityDescription(name),
                  };
                });
                return {
                  name,
                  client,
                  tools,
                  ...resolution,
                };
              } catch (e) {
                eventStream.reportError?.({
                  source: 'Init',
                  message: 'Failed to load an MCP client.',
                  error: e,
                  metadata: { name },
                });
                return undefined;
              }
            },
          ),
        )
      ).filter(isDefined)
    : [];

  const generatedMcpServerSummaries: PersistedMcpServerSummaries = {};
  mcpClients.forEach(({ name, generatedSummary }) => {
    if (generatedSummary !== undefined) {
      generatedMcpServerSummaries[name] = generatedSummary;
    }
  });
  if (Object.keys(generatedMcpServerSummaries).length > 0) {
    try {
      SessionSaver.saveMcpServerSummaries({
        directory: settings.saveLocation,
        summaries: {
          ...persistedMcpServerSummaries,
          ...generatedMcpServerSummaries,
        },
      });
    } catch (e) {
      eventStream.reportError?.({
        source: 'Init',
        message: 'Failed to save MCP server summaries.',
        error: e,
      });
    }
  }

  // Create ToolNode factories for each MCP client
  const toolNodeFactories = mcpClients.map(
    ({ client, capabilityDescription, tools }) =>
      new ConcreteToolNodeFactory({
        provider,
        relevanceGate: toolRelevanceGate,
        mcpClient: client,
        capabilityDescription,
        initialTools: tools,
        errorStream,
      }),
  );

  // Create sensory nodes from user-configured sensor providers
  const sensoryNodes = await Promise.all(
    (settings.sensorProviders ?? []).map(async (sensorProvider) =>
      createSensoryNode({
        definition: await sensorProvider({ provider }),
        provider,
        eventStream,
      }),
    ),
  );

  // Create supporting services for EpochOrchestrator
  const attentionGate = new StaticAttentionGate({
    n: settings.attentionGateN ?? DEFAULT_ATTENTION_GATE_N,
  });
  const relevanceFilter = new LlmRelevanceFilter({
    provider,
    attentionGate,
  });

  const distiller =
    settings.distillerStrategy === 'select-best'
      ? new BestBroadcastDistiller({ provider })
      : new LlmDistiller({ provider });

  const memoryNodeFactory = new ConcreteMemoryNodeFactory({
    provider,
    relevanceGate: memoryRelevanceGate,
  });

  const userInputSensor = new UserInputSensor();
  const userInputNode = createSensoryNode({
    definition: {
      id: 'sensor-user-input',
      sensor: userInputSensor,
      responseRole: 'user-input',
      capabilityDescription:
        'can provide queued external user input submitted through the interface.',
    },
    provider,
    eventStream,
  });
  const activeGoalNode = createSensoryNode({
    definition: {
      id: 'sensor-active-goal',
      sensor: new ActiveGoalSensor({ goalStore }),
      capabilityDescription:
        'can provide the current persistent collective goal when one is active.',
    },
    provider,
    eventStream,
  });
  const goalManagerNode = new GoalNode({
    id: 'goal-manager',
    eventStream,
    goalStore,
  });

  const nodeSplitter = new MemoryNodeSplitter({
    splittingProvider: provider,
    newNodeProvider: provider,
    memoryNodeFactory,
    eventStream,
  });

  const nodePruner = new StaticNodePruner({
    minEpochsAlive: settings.pruneMinEpochsAlive ?? 5,
    minBroadcasts: settings.pruneMinBroadcasts ?? 1,
    maxFilterRate: settings.pruneMaxFilterRate ?? 0.9,
    minMemoryNodes: settings.pruneMinMemoryNodes ?? 1,
  });

  // Create initial nodes (tool nodes + sensory nodes, plus loaded nodes if any)
  const initialNodes: Node<string>[] = [];

  // Add loaded nodes from session
  if (loadedSession?.nodes) {
    initialNodes.push(...loadedSession.nodes);
  }

  // Add tool nodes for each MCP client
  for (const factory of toolNodeFactories) {
    const toolNode = factory.create({
      nodeId: `tool-${crypto.randomUUID().slice(0, 8)}`,
      eventStream,
    });
    initialNodes.push(toolNode);
  }

  initialNodes.push(...sensoryNodes);
  initialNodes.push(userInputNode);
  initialNodes.push(activeGoalNode);
  initialNodes.push(goalManagerNode);

  // Use loaded working memory and broadcast if available, otherwise use defaults
  const initialWorkingMemory = loadedSession?.workingMemory ?? { messages: [] };
  const initialBroadcast =
    loadedSession?.broadcast ??
    ({
      role: 'broadcast',
      content: settings.initialBroadcastMessage,
    } as const);

  SessionSaver.watch({
    eventStream,
    directory: settings.saveLocation,
  });

  // Create orchestrator
  const orchestrator = new EpochOrchestrator({
    provider,
    relevanceFilter,
    distiller,
    maxWorkingMemoryMessages: settings.maxWorkingMemoryMessages ?? 10,
    contextLengthThreshold: settings.contextLengthThreshold ?? 5000,
    memoryNodeSplitter: nodeSplitter,
    nodePruner,
    initialWorkingMemory,
    initialBroadcast,
    memoryNodeFactory,
    eventStream,
    initialNodes,
    initialNodeStats: loadedSession?.nodeStats,
    userInputSensor,
  });

  return {
    orchestrator,
    mcpClients: mcpClients.map(({ client }) => client),
    eventStream,
  };
};
