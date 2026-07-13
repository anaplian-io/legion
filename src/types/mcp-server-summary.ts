export const MCP_SERVER_SUMMARIES_FILE_NAME = 'mcp-server-summaries.json';

export interface PersistedMcpServerSummary {
  readonly capabilityDescription: string;
  readonly toolSignature: string;
}

export type PersistedMcpServerSummaries = Record<
  string,
  PersistedMcpServerSummary
>;
