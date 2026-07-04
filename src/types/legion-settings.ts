import { Provider } from './provider.js';
import { Sensor } from './sensor.js';

export interface McpServerStdIo {
  readonly command: string;
  readonly capabilityDescription?: string;
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
  readonly maxWorkingMemoryMessages?: number;
  readonly contextLengthThreshold?: number;
  /** Fixed per-epoch curiosity probability used by tool nodes. */
  readonly toolCuriosityProbability?: number;
  /** Epochs a node must survive before it becomes eligible for pruning. */
  readonly pruneMinEpochsAlive?: number;
  /** Minimum epochs an eligible node must have spoken in to be retained. */
  readonly pruneMinBroadcasts?: number;
  /** Maximum tolerated fraction of a node's spoken epochs that were filtered. */
  readonly pruneMaxFilterRate?: number;
  /** Floor on the memory-node population; pruning never drops below this. */
  readonly pruneMinMemoryNodes?: number;
}
