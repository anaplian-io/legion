import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../../types/provider.js';
import type { ToolDefinition } from '../../types/tool.js';
import { TEST_NODE_TELEMETRY } from '../../telemetry/test-context.fixture.js';
import {
  NO_APPLICABLE_OPERATION,
  ToolOperationResolver,
} from './tool-operation-resolver.js';

const tools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Return web result listings.',
    parameters: { type: 'object' },
  },
  {
    name: 'fetch',
    description: 'Return the content of a webpage URL.',
    parameters: { type: 'object' },
  },
];

describe('ToolOperationResolver', () => {
  let provider: Provider;
  let resolver: ToolOperationResolver;

  beforeEach(() => {
    provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    resolver = new ToolOperationResolver({
      nodeId: 'tool-web',
      capabilityDescription: 'can search and fetch webpages.',
      provider,
    });
  });

  it('selects an advertised operation from comparative candidates', async () => {
    vi.mocked(provider.selectBest).mockResolvedValue(1);

    await expect(
      resolver.resolve(
        {
          id: 'request-1',
          targetNodeId: 'tool-web',
          intent: 'Fetch the content of https://example.com.',
          operation: 'search',
          arguments: { query: 'https://example.com' },
        },
        tools,
        TEST_NODE_TELEMETRY,
      ),
    ).resolves.toEqual({
      outcome: 'operation',
      tool: tools[1],
      selection: { candidateIndex: 1, operation: 'fetch' },
    });

    expect(provider.selectBest).toHaveBeenCalledWith(
      {
        systemPrompt: expect.stringContaining(
          'known webpage, prefer an advertised page-fetch',
        ),
        messages: [
          {
            role: 'tool-intent',
            content: '',
            actionRequests: [
              {
                id: 'request-1',
                targetNodeId: 'tool-web',
                intent: 'Fetch the content of https://example.com.',
                operation: 'search',
                arguments: { query: 'https://example.com' },
              },
            ],
          },
        ],
        candidates: [
          expect.stringContaining('"operation":"search"'),
          expect.stringContaining('"operation":"fetch"'),
          expect.stringContaining(NO_APPLICABLE_OPERATION),
        ],
      },
      expect.objectContaining({
        stage: 'tool-elaboration',
        nodeId: 'tool-web',
        parentSpanId: 'request-1',
      }),
    );
    expect(
      vi.mocked(provider.selectBest).mock.calls[0]?.[0].systemPrompt,
    ).toContain('operation and argument hints are advisory evidence');
  });

  it.each([
    {
      description: 'the advertised order',
      orderedTools: tools,
      selectedIndex: 1,
    },
    {
      description: 'the reversed order',
      orderedTools: [...tools].reverse(),
      selectedIndex: 0,
    },
  ])(
    'maps the selected fetch candidate in $description',
    async ({ orderedTools, selectedIndex }) => {
      vi.mocked(provider.selectBest).mockResolvedValue(selectedIndex);

      const resolution = await resolver.resolve(
        {
          id: 'request-order',
          targetNodeId: 'tool-web',
          intent: 'Fetch the content of https://example.com.',
        },
        orderedTools,
        TEST_NODE_TELEMETRY,
      );

      expect(resolution).toEqual({
        outcome: 'operation',
        tool: expect.objectContaining({ name: 'fetch' }),
        selection: { candidateIndex: selectedIndex, operation: 'fetch' },
      });
    },
  );

  it('returns no-applicable when the final candidate is selected', async () => {
    vi.mocked(provider.selectBest).mockResolvedValue(tools.length);

    await expect(
      resolver.resolve(
        {
          id: 'request-none',
          targetNodeId: 'tool-web',
          intent: 'Delete an account.',
        },
        tools,
        TEST_NODE_TELEMETRY,
      ),
    ).resolves.toEqual({
      outcome: 'no-applicable',
      selection: {
        candidateIndex: tools.length,
        operation: NO_APPLICABLE_OPERATION,
      },
    });
  });

  it('rejects an invalid provider candidate index', async () => {
    vi.mocked(provider.selectBest).mockResolvedValue(99);

    await expect(
      resolver.resolve(
        {
          id: 'request-bad-index',
          targetNodeId: 'tool-web',
          intent: 'Search the web.',
        },
        tools,
        TEST_NODE_TELEMETRY,
      ),
    ).rejects.toThrow('selected invalid candidate index 99');
  });
});
