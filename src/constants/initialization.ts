import rawSettings from '../../settings.js';
import { OpenAI } from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDefined } from '../utilities/is-defined.js';
import { LegionSettings } from '../types/legion-settings.js';
import { OpenaiProvider } from '../provider/openai-provider.js';
import { WikipediaSensor } from '../sensor/wikipedia-sensor.js';
import { SensoryNode } from '../node/sensory-node.js';
import { ConcreteToolNodeFactory } from '../factory/concrete-tool-node-factory.js';
import { LlmRelevanceFilter } from '../service/llm-relevance-filter.js';
import { StaticAttentionGate } from '../service/static-attention-gate.js';
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
import { GeometricScheduleCuriosityGate } from '../service/geometric-schedule-curiosity-gate.js';
import { FixedProbabilityCuriosityGate } from '../service/fixed-probability-curiosity-gate.js';

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
    topicName: 'orchestrator/node-stats-updated',
    receiver: (data) => {
      data.nodeStats.forEach(({ nodeId, stats }) => {
        console.info(
          `[Orchestrator] node stats: ${nodeId} - alive: ${stats.epochsAlive}, spoke: ${stats.epochsSpoken}, filtered: ${stats.epochsFiltered}`,
        );
      });
    },
  });
};

const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_TOOL_CURIOSITY_PROBABILITY = 0.15;
const WIKIPEDIA_SENSOR_CAPABILITY =
  'can surface random Wikipedia article knowledge as external background context.';

export interface InitOptions {
  /**
   * Attach the console.info logging subscribers. Defaults to true.
   * The TUI sets this to false so log output doesn't fight Ink for the screen.
   */
  readonly attachConsoleLogging?: boolean;
}

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

  // Setup logging subscribers to see what's happening
  if (options?.attachConsoleLogging ?? true) {
    setupLoggingSubscribers(eventStream);
  }

  // Try to load a session if saveLocation is configured
  const curiosityGate = new GeometricScheduleCuriosityGate();
  const toolCuriosityGate = new FixedProbabilityCuriosityGate({
    probability:
      settings.toolCuriosityProbability ?? DEFAULT_TOOL_CURIOSITY_PROBABILITY,
  });
  let loadedSession: LoadedSession | undefined;
  try {
    console.info(
      `[Init] Attempting to load session from ${settings.saveLocation}`,
    );
    const memoryNodeFactory = new ConcreteMemoryNodeFactory({
      provider,
      curiosityGate,
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

  const mcpClients: Array<{
    readonly name: string;
    readonly client: Client;
    readonly capabilityDescription: string;
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
                await client.connect(new StdioClientTransport(definition));
                console.info(
                  `[Init] Successfully connected MCP client ${name}`,
                );
              } catch (e) {
                console.warn(`[Init] Failed to load MCP client ${name}: ${e}`);
                return undefined;
              }
              return {
                name,
                client,
                capabilityDescription:
                  definition.capabilityDescription ??
                  `can use the ${name} MCP server for external actions or information retrieval.`,
              };
            },
          ),
        )
      ).filter(isDefined)
    : [];

  // Create ToolNode factories for each MCP client
  const toolNodeFactories = mcpClients.map(
    ({ client, capabilityDescription }) =>
      new ConcreteToolNodeFactory({
        provider,
        curiosityGate: toolCuriosityGate,
        mcpClient: client,
        capabilityDescription,
      }),
  );

  // Create sensory node with Wikipedia sensor
  const wikipediaSensor = new WikipediaSensor(provider);
  const sensoryNode = new SensoryNode({
    id: `wiki-sensor-${crypto.randomUUID().slice(0, 8)}`,
    provider,
    eventStream,
    sensor: wikipediaSensor,
    capabilityDescription: WIKIPEDIA_SENSOR_CAPABILITY,
  });

  // Create supporting services for EpochOrchestrator
  const attentionGate = new StaticAttentionGate({
    n: settings.attentionGateN ?? 'all',
  });
  const relevanceFilter = new LlmRelevanceFilter({
    provider,
    attentionGate,
  });

  const distiller = new LlmDistiller({ provider });

  const memoryNodeFactory = new ConcreteMemoryNodeFactory({
    provider,
    curiosityGate,
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

  // Create initial nodes (tool nodes + sensory node, plus loaded nodes if any)
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

  // Add sensory node
  initialNodes.push(sensoryNode);

  // Use loaded working memory and broadcast if available, otherwise use defaults
  const initialWorkingMemory = loadedSession?.workingMemory ?? { messages: [] };
  const initialBroadcast =
    loadedSession?.broadcast ??
    ({
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
  });

  return {
    orchestrator,
    mcpClients: mcpClients.map(({ client }) => client),
    eventStream,
  };
};
