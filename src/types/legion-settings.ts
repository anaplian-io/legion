export interface McpServerStdIo {
  readonly command: string;
  readonly allowedTools?: string[];
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

export interface LegionSettings {
  readonly llmProvider: 'openai';
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly mcpServers?: Record<string, McpServerStdIo>;
}
