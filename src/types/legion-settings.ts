export interface McpServerStdIo {
  readonly command: string;
  readonly allowedTools?: string[];
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

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
  readonly attentionGateN?: number | 'all';
  readonly maxWorkingMemoryMessages?: number;
  readonly contextLengthThreshold?: number;
}
