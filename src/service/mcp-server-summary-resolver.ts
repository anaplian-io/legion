import { createHash } from 'node:crypto';
import { McpServerSummarySupplier } from '../types/legion-settings.js';
import {
  PersistedMcpServerSummaries,
  PersistedMcpServerSummary,
} from '../types/mcp-server-summary.js';
import { Provider } from '../types/provider.js';
import { ToolDefinition } from '../types/tool.js';

export const defaultMcpServerCapabilityDescription = (name: string): string =>
  `can use the ${name} MCP server for external actions or information retrieval.`;

export const mcpServerToolSignature = (
  tools: readonly ToolDefinition[],
): string => {
  const canonicalTools = [...tools].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return createHash('sha256')
    .update(JSON.stringify(canonicalTools))
    .digest('hex');
};

export interface ResolveMcpServerCapabilityDescriptionProps {
  readonly name: string;
  readonly configuredCapabilityDescription:
    string | McpServerSummarySupplier | undefined;
  readonly provider: Provider;
  readonly tools: readonly ToolDefinition[];
  readonly persistedSummaries: PersistedMcpServerSummaries;
}

export interface ResolvedMcpServerCapabilityDescription {
  readonly capabilityDescription: string;
  readonly generatedSummary?: PersistedMcpServerSummary;
}

export const resolveMcpServerCapabilityDescription = async ({
  name,
  configuredCapabilityDescription,
  provider,
  tools,
  persistedSummaries,
}: ResolveMcpServerCapabilityDescriptionProps): Promise<ResolvedMcpServerCapabilityDescription> => {
  if (typeof configuredCapabilityDescription === 'string') {
    return { capabilityDescription: configuredCapabilityDescription };
  }
  if (configuredCapabilityDescription === undefined) {
    return {
      capabilityDescription: defaultMcpServerCapabilityDescription(name),
    };
  }

  const toolSignature = mcpServerToolSignature(tools);
  const persistedSummary = persistedSummaries[name];
  if (persistedSummary?.toolSignature === toolSignature) {
    return { capabilityDescription: persistedSummary.capabilityDescription };
  }

  const capabilityDescription = await configuredCapabilityDescription({
    provider,
    tools,
  });
  return {
    capabilityDescription,
    generatedSummary: {
      capabilityDescription,
      toolSignature,
    },
  };
};
