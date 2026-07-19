import { Provider } from './provider.js';
import { Sensor } from './sensor.js';
import { MessageRole } from './message.js';
import { ToolDefinition } from './tool.js';

export interface McpServerSummarySupplierDependencies {
  readonly provider: Provider;
  readonly tools: readonly ToolDefinition[];
}

export type McpServerSummarySupplier = (
  dependencies: McpServerSummarySupplierDependencies,
) => Promise<string>;

export interface McpServerStdIo {
  readonly command: string;
  /**
   * A static capability description, or an async supplier that derives one
   * from the MCP server's tools during startup.
   */
  readonly capabilityDescription?: string | McpServerSummarySupplier;
  readonly allowedTools?: string[];
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

export interface SensorProviderDependencies {
  readonly provider: Provider;
}

export interface SensorProviderDefinition {
  readonly sensor: Sensor;
  readonly capabilityDescription: string;
  readonly id?: string;
  readonly responseRole?: MessageRole;
}

export type SensorProvider = (
  dependencies: SensorProviderDependencies,
) => SensorProviderDefinition | Promise<SensorProviderDefinition>;

export interface LegionSettings {
  readonly llmProvider: 'openai';
  readonly model: string;
  readonly saveLocation: string;
  readonly initialBroadcastMessage: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly mcpServers?: Record<string, McpServerStdIo>;
  readonly openAiTimeout?: number;
  readonly openAiMaxRetries?: number;
  readonly maxParallelism?: number;
  readonly sensorProviders?: SensorProvider[];
  readonly attentionGateN?: number | 'all';
  /** How attention survivors become the next global-workspace broadcast. */
  readonly distillerStrategy?: 'synthesize' | 'select-best';
  readonly maxWorkingMemoryMessages?: number;
  readonly contextLengthThreshold?: number;
  /** Fixed per-epoch curiosity probability used by tool nodes. */
  readonly toolCuriosityProbability?: number;
  /** Fixed memory curiosity probability after a guaranteed first epoch. */
  readonly memoryCuriosityProbability?: number;
  /** Epochs a node must survive before it becomes eligible for pruning. */
  readonly pruneMinEpochsAlive?: number;
  /** Minimum epochs in which an eligible node must generate a candidate. */
  readonly pruneMinBroadcasts?: number;
  /** Maximum tolerated fraction of generated candidates not selected. */
  readonly pruneMaxFilterRate?: number;
  /** Floor on the memory-node population; pruning never drops below this. */
  readonly pruneMinMemoryNodes?: number;
}
