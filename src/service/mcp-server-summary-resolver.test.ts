import { describe, expect, it, vi } from 'vitest';
import {
  defaultMcpServerCapabilityDescription,
  mcpServerToolSignature,
  resolveMcpServerCapabilityDescription,
} from './mcp-server-summary-resolver.js';
import type { McpServerSummarySupplier } from '../types/legion-settings.js';
import type { Provider } from '../types/provider.js';
import type { ToolDefinition } from '../types/tool.js';

const tools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Search the web.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'fetch',
    description: 'Fetch a web page.',
    parameters: { type: 'object', properties: {} },
  },
];

const provider: Provider = {
  askYesNoQuestion: vi.fn(),
  generate: vi.fn(),
  generateWithTools: vi.fn(),
  rankByRelevance: vi.fn(),
  selectBest: vi.fn(),
  splitString: vi.fn(),
};

describe('MCP server summary resolver', () => {
  it('uses static capability descriptions without invoking a supplier', async () => {
    const result = await resolveMcpServerCapabilityDescription({
      name: 'search-server',
      configuredCapabilityDescription: 'can search trusted sources.',
      provider,
      tools,
      persistedSummaries: {},
    });

    expect(result).toEqual({
      capabilityDescription: 'can search trusted sources.',
    });
  });

  it('uses the legacy fallback when no capability description is configured', async () => {
    const result = await resolveMcpServerCapabilityDescription({
      name: 'search-server',
      configuredCapabilityDescription: undefined,
      provider,
      tools,
      persistedSummaries: {},
    });

    expect(result).toEqual({
      capabilityDescription:
        defaultMcpServerCapabilityDescription('search-server'),
    });
  });

  it('loads a generated summary when its tool signature matches', async () => {
    const supplier = vi.fn(async () => 'should not be generated');
    const signature = mcpServerToolSignature(tools);

    const result = await resolveMcpServerCapabilityDescription({
      name: 'search-server',
      configuredCapabilityDescription: supplier as McpServerSummarySupplier,
      provider,
      tools,
      persistedSummaries: {
        'search-server': {
          capabilityDescription: 'can search and fetch pages.',
          toolSignature: signature,
        },
      },
    });

    expect(result).toEqual({
      capabilityDescription: 'can search and fetch pages.',
    });
    expect(supplier).not.toHaveBeenCalled();
  });

  it('regenerates and returns a cache entry when no matching summary exists', async () => {
    const supplier = vi.fn(async () => 'can search and fetch pages.');

    const result = await resolveMcpServerCapabilityDescription({
      name: 'search-server',
      configuredCapabilityDescription: supplier as McpServerSummarySupplier,
      provider,
      tools,
      persistedSummaries: {
        'search-server': {
          capabilityDescription: 'stale summary',
          toolSignature: 'outdated-tool-signature',
        },
      },
    });

    expect(supplier).toHaveBeenCalledWith({ provider, tools });
    expect(result).toEqual({
      capabilityDescription: 'can search and fetch pages.',
      generatedSummary: {
        capabilityDescription: 'can search and fetch pages.',
        toolSignature: mcpServerToolSignature(tools),
      },
    });
  });

  it('creates the same signature when the MCP server changes tool order', () => {
    expect(mcpServerToolSignature([...tools].reverse())).toBe(
      mcpServerToolSignature(tools),
    );
  });
});
