import { describe, expect, it, vi } from 'vitest';
import { generateSummary } from './generate-mcp-server-summary.js';
import type { Provider } from '../types/provider.js';
import type { ToolDefinition } from '../types/tool.js';

describe('generateSummary', () => {
  it('generates a concise MCP capability description from the available tools', async () => {
    const provider: Provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn().mockResolvedValue('can search and fetch web pages.'),
      generateWithTools: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
    };
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web.',
        parameters: { type: 'object', properties: {} },
      },
    ];

    await expect(generateSummary()({ provider, tools })).resolves.toBe(
      'can search and fetch web pages.',
    );
    expect(provider.generate).toHaveBeenCalledWith({
      systemPrompt:
        'Write one concise capability description for this MCP server. Start with "can" and mention only actions or information the supplied tools support. Return only the description.',
      messages: [
        {
          role: 'user-input',
          content: `MCP tools:\n${JSON.stringify(tools)}`,
        },
      ],
    });
  });
});
