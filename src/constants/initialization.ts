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
import { GeometricScheduleCuriosityGate } from '../service/geometric-schedule-curiosity-gate.js';
import { FixedProbabilityCuriosityGate } from '../service/fixed-probability-curiosity-gate.js';
import { AskYesNoQuestionRelevanceGate } from '../service/ask-yes-no-question-relevance-gate.js';
import { SequencedCompositeRelevanceGate } from '../service/sequenced-composite-relevance-gate.js';
import { Provider } from '../types/provider.js';
import { UserInputSensor } from '../sensor/user-input-sensor.js';
import { ExplicitNodeMentionRelevanceGate } from '../service/explicit-node-mention-relevance-gate.js';
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

// Set up console logging subscribers for all event types
const setupLoggingSubscribers = (eventStream: EventStream): void => {
  eventStream.subscribe({
    topicName: 'node/status-change',
    receiver: (data) => {
      console.info(`[Node ${data.nodeId}] status changed to ${data.status}`);
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/nodes-changed',
    receiver: (data) => {
      console.info(
        `[Orchestrator] nodes changed - total: ${data.allNodes.length} nodes`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/node-added',
    receiver: (data) => {
      data.addedNodes.forEach((node) => {
        console.info(`[Orchestrator] node added: ${node.id} (${node.kind})`);
      });
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/node-removed',
    receiver: (data) => {
      data.removedNodeIds.forEach((id) => {
        console.info(`[Orchestrator] node removed: ${id}`);
      });
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/node-updated',
    receiver: (data) => {
      console.info(
        `[Orchestrator] node updated: ${data.node.id} (${data.node.kind})`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/working-memory-updated',
    receiver: (data) => {
      console.info(
        `[Orchestrator] working memory updated - ${data.workingMemory.messages.length} messages, current broadcast: "${data.broadcast.content.slice(0, 50)}..."`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/user-input-received',
    receiver: (data) => {
      console.info(
        `[Orchestrator] user input received: "${data.content.slice(0, 50)}..."`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/user-input-consumed',
    receiver: (data) => {
      console.info(
        `[Orchestrator] user input consumed: "${data.content.slice(0, 50)}..."`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'orchestrator/node-stats-updated',
    receiver: (data) => {
      data.nodeStats.forEach(({ nodeId, stats }) => {
        console.info(
          `[Orchestrator] node stats: ${nodeId} - alive: ${stats.epochsAlive}, spoke: ${stats.epochsSpoken}, filtered: ${stats.epochsFiltered}`,
        );
      });
    },
  });

  eventStream.subscribe({
    topicName: 'tool/invocation-started',
    receiver: (data) => {
      console.info(
        `[Tool ${data.nodeId}] invoking ${data.toolName}(${data.arguments})`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'tool/invocation-completed',
    receiver: (data) => {
      console.info(
        `[Tool ${data.nodeId}] ${data.toolName} ${data.success ? 'completed' : 'failed'}: ${data.output}`,
      );
    },
  });

  eventStream.subscribe({
    topicName: 'goal/updated',
    receiver: ({ activeGoal }) => {
      console.info(
        activeGoal === undefined
          ? '[Goals] active goal cleared'
          : `[Goals] active goal set: ${activeGoal.content}`,
      );
    },
  });
};

const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_TOOL_CURIOSITY_PROBABILITY = 0.15;
const MEMORY_RELEVANCE_QUESTION =
  'Given your experience above and the full message list below, can you add something the collective does not already have? If user input is present, answer yes when you can help acknowledge it, answer it, or preserve enough context to resume the prior inquiry. Otherwise answer yes only if your contribution would be specific and non-redundant.';
const TOOL_RELEVANCE_QUESTION =
  'Given your node ID, capability, tools, and the full message list below, will one or more tools make concrete progress on any unresolved need? Treat earlier messages as working memory and the final message as the current broadcast. If the final broadcast explicitly names your node ID or @nodeID with a concrete request, answer yes. Otherwise answer yes only if a tool call would make concrete progress.';

export interface InitOptions {
  /**
   * Attach the console.info logging subscribers. Defaults to true.
   * The TUI sets this to false so log output doesn't fight Ink for the screen.
   */
  readonly attachConsoleLogging?: boolean;
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
  const eventStream = new ConcreteEventStream();

  let initialActiveGoal: ActiveGoal | undefined;
  try {
    initialActiveGoal = SessionLoader.loadActiveGoal({
      directory: settings.saveLocation,
    });
  } catch (error) {
    console.warn(
      `[Init] Failed to load active goal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const goalStore = new GoalStore({
    eventStream,
    ...(initialActiveGoal === undefined ? {} : { initialActiveGoal }),
  });

  // Setup logging subscribers to see what's happening
  if (options?.attachConsoleLogging ?? true) {
    setupLoggingSubscribers(eventStream);
  }

  // Try to load a session if saveLocation is configured
  const memoryRelevanceGate = new SequencedCompositeRelevanceGate({
    gates: [
      new GeometricScheduleCuriosityGate(),
      new AskYesNoQuestionRelevanceGate({
        provider,
        question: MEMORY_RELEVANCE_QUESTION,
      }),
    ],
  });
  const toolRelevanceGate = new SequencedCompositeRelevanceGate({
    gates: [
      new ExplicitNodeMentionRelevanceGate(),
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
    console.info(
      `[Init] Attempting to load session from ${settings.saveLocation}`,
    );
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
      console.info(
        `[Init] Loaded session with ${loadedSession.nodes.length} nodes`,
      );
    }
  } catch (e) {
    console.warn(
      `[Init] Failed to load session: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let persistedMcpServerSummaries: PersistedMcpServerSummaries = {};
  try {
    persistedMcpServerSummaries = SessionLoader.loadMcpServerSummaries({
      directory: settings.saveLocation,
    });
  } catch (e) {
    console.warn(
      `[Init] Failed to load MCP server summaries: ${e instanceof Error ? e.message : String(e)}`,
    );
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
                console.info(
                  `[Init] Successfully connected MCP client ${name}`,
                );
                const tools = await new MCPClient({
                  client,
                }).getAvailableTools();
                const resolution = await resolveMcpServerCapabilityDescription({
                  name,
                  configuredCapabilityDescription:
                    definition.capabilityDescription,
                  provider,
                  tools,
                  persistedSummaries: persistedMcpServerSummaries,
                }).catch((e: unknown) => {
                  console.warn(
                    `[Init] Failed to generate MCP server summary for ${name}: ${e instanceof Error ? e.message : String(e)}`,
                  );
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
                console.warn(`[Init] Failed to load MCP client ${name}: ${e}`);
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
      console.warn(
        `[Init] Failed to save MCP server summaries: ${e instanceof Error ? e.message : String(e)}`,
      );
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
    n: settings.attentionGateN ?? 'all',
  });
  const relevanceFilter = new LlmRelevanceFilter({
    provider,
    attentionGate,
  });

  const distiller = new BestBroadcastDistiller({ provider });

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
    provider,
    eventStream,
    relevanceGate: new ExplicitNodeMentionRelevanceGate(),
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
