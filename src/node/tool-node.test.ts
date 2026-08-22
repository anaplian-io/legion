import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolNode, ToolNodeOutcome } from './tool-node.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import type { ToolCall, ToolDefinition } from '../types/tool.js';
import type { ActionRequest, Message } from '../types/message.js';
import type { MCPClient, ToolResult } from '../adapter/mcp-client.js';
import {
  createTestTelemetry,
  TEST_NODE_TELEMETRY,
} from '../telemetry/test-context.fixture.js';
import type { TelemetryEvent } from '../types/telemetry.js';

interface MockMcpClient {
  readonly getAvailableTools: () => Promise<ToolDefinition[]>;
  readonly invokeTool: (
    callId: string,
    name: string,
    argumentsStr: string,
  ) => Promise<ToolResult>;
}

const tools: ToolDefinition[] = [
  {
    name: 'list_directory',
    description: 'List a directory.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

const webTools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Search the web and return result listings.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description: 'Retrieve the main content of a known webpage URL.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

const request = (
  id: string,
  overrides: Partial<ActionRequest> = {},
): ActionRequest => ({
  id,
  targetNodeId: 'tool-files',
  intent: 'List the current directory.',
  ...overrides,
});

const call = (
  id: string,
  name = 'list_directory',
  argumentsStr = '{"path":"."}',
): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: argumentsStr },
});

const message = (
  actionRequests?: readonly ActionRequest[],
  broadcastOverrides: Partial<Message> = {},
) => ({
  telemetry: TEST_NODE_TELEMETRY,
  workingMemory: {
    messages: [{ role: 'working-memory' as const, content: 'Prior context.' }],
  },
  broadcast: {
    role: 'broadcast' as const,
    content: 'Inspect the workspace.',
    ...(actionRequests === undefined ? {} : { actionRequests }),
    ...broadcastOverrides,
  },
});

const outcomes = (response: Awaited<ReturnType<ToolNode['sendMessage']>>) => {
  expect(response).toBeDefined();
  return JSON.parse(response?.content ?? '[]') as ToolNodeOutcome[];
};

describe('ToolNode', () => {
  let provider: Provider;
  let eventStream: EventStream;
  let mcpClient: MockMcpClient;
  let telemetry: ReturnType<typeof createTestTelemetry>;
  let telemetryEvents: TelemetryEvent[];

  const createNode = (initialTools?: readonly ToolDefinition[]): ToolNode =>
    new ToolNode({
      id: 'tool-files',
      capabilityDescription: 'can inspect workspace files.',
      provider,
      eventStream,
      mcpClient: mcpClient as unknown as MCPClient,
      telemetry,
      ...(initialTools === undefined ? {} : { initialTools }),
    });

  beforeEach(() => {
    telemetry = createTestTelemetry();
    telemetryEvents = [];
    telemetry.subscribe((event) => telemetryEvents.push(event));
    provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn().mockResolvedValue(0),
      splitString: vi.fn(),
      generateWithTools: vi.fn().mockResolvedValue({
        content: 'No matching tool.',
        toolCalls: undefined,
      }),
    };
    eventStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      reportError: vi.fn(),
    };
    mcpClient = {
      getAvailableTools: vi.fn().mockResolvedValue(tools),
      invokeTool: vi.fn(),
    };
  });

  it('exposes stable identity and a cache-friendly static prompt', () => {
    const node = createNode(tools);

    expect(node.id).toBe('tool-files');
    expect(node.kind).toBe('tool');
    expect(node.context).toBe('');
    expect(node.status).toBe('idle');
    expect(node.capabilityDescription).toBe('can inspect workspace files.');
    expect(node.preamble).toContain(
      'structured intent already routed to your exact node ID',
    );
    expect(node.preamble).toContain('must make at least one tool call');
    expect(node.preamble).toContain(
      'operation and arguments are non-authoritative hints',
    );
    expect(node.preamble).toContain('operation resolver');
    expect(node.preamble).not.toContain('"additionalProperties"');
  });

  it('refreshes tools explicitly and loads them lazily for a targeted request', async () => {
    const node = createNode();
    await node.initialize();
    expect(mcpClient.getAvailableTools).toHaveBeenCalledOnce();

    vi.mocked(mcpClient.getAvailableTools).mockClear();
    await node.sendMessage(message([request('request-1')]));
    expect(mcpClient.getAvailableTools).not.toHaveBeenCalled();
  });

  it('uses boot-loaded tools, including an intentionally empty catalog', async () => {
    const withTools = createNode(tools);
    await withTools.sendMessage(message([request('request-tools')]));
    expect(mcpClient.getAvailableTools).not.toHaveBeenCalled();

    const withoutTools = createNode([]);
    const response = await withoutTools.sendMessage(
      message([request('request-empty')]),
    );
    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-empty',
        intent: 'List the current directory.',
        stage: 'elaboration',
        success: false,
        error: 'ToolNode tool-files has no available MCP tools.',
      },
    ]);
    expect(provider.generateWithTools).toHaveBeenCalledOnce();
  });

  it.each([
    { description: 'there are no action requests', actionRequests: undefined },
    {
      description: 'only another node is targeted',
      actionRequests: [
        request('request-other', { targetNodeId: 'other-tool' }),
      ],
    },
  ])('does nothing when $description', async ({ actionRequests }) => {
    const node = createNode();

    await expect(
      node.sendMessage(message(actionRequests)),
    ).resolves.toBeUndefined();
    expect(mcpClient.getAvailableTools).not.toHaveBeenCalled();
    expect(provider.selectBest).not.toHaveBeenCalled();
    expect(provider.generateWithTools).not.toHaveBeenCalled();
  });

  it('returns correlated afferent failures when tool loading fails', async () => {
    vi.mocked(mcpClient.getAvailableTools).mockRejectedValue('offline');
    const node = createNode();

    const response = await node.sendMessage(
      message([request('request-a'), request('request-b')]),
    );

    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-a',
        intent: 'List the current directory.',
        stage: 'elaboration',
        success: false,
        error: 'ToolNode tool-files could not load its MCP tools: offline',
      },
      {
        requestId: 'request-b',
        intent: 'List the current directory.',
        stage: 'elaboration',
        success: false,
        error: 'ToolNode tool-files could not load its MCP tools: offline',
      },
    ]);
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to load tools before elaborating targeted intents.',
      }),
    );
  });

  it('repairs stale request hints before invoking MCP and preserves correlation', async () => {
    const staleRequest = request('request-list', {
      operation: 'list_directory',
      arguments: { path: '.', recursive: false },
    });
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [call('call-list')],
    });
    vi.mocked(mcpClient.invokeTool).mockResolvedValue({
      callId: 'call-list',
      name: 'list_directory',
      success: true,
      result: { entries: ['README.md'] },
    });
    const node = createNode(tools);

    const response = await node.sendMessage(message([staleRequest]));

    expect(provider.generateWithTools).toHaveBeenCalledWith(
      {
        systemPrompt: node.preamble,
        messages: [
          {
            role: 'tool-intent',
            content: '',
            actionRequests: [staleRequest],
          },
        ],
        tools,
        toolChoice: 'required',
      },
      expect.objectContaining({ stage: 'tool-elaboration' }),
    );
    expect(mcpClient.invokeTool).toHaveBeenCalledWith(
      'call-list',
      'list_directory',
      '{"path":"."}',
    );
    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-list',
        stage: 'mcp',
        callId: 'call-list',
        name: 'list_directory',
        success: true,
        result: { entries: ['README.md'] },
      },
    ]);
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/elaboration-completed',
      data: {
        nodeId: 'tool-files',
        requestId: 'request-list',
        success: true,
        toolCalls: [{ callId: 'call-list', toolName: 'list_directory' }],
        output: '',
      },
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: 'tool-files',
        requestId: 'request-list',
        callId: 'call-list',
        toolName: 'list_directory',
        arguments: '{"path":"."}',
      },
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-completed',
      data: {
        nodeId: 'tool-files',
        requestId: 'request-list',
        callId: 'call-list',
        toolName: 'list_directory',
        success: true,
        output: '{"entries":["README.md"]}',
      },
    });
  });

  it('elaborates requests independently with an identical cacheable prefix', async () => {
    const first = request('request-first', { intent: 'List directory one.' });
    const second = request('request-second', { intent: 'List directory two.' });
    vi.mocked(provider.generateWithTools)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [call('call-first-a'), call('call-first-b')],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [call('call-second')],
      });
    vi.mocked(mcpClient.invokeTool).mockImplementation(
      async (callId, name) => ({
        callId,
        name,
        success: true,
        result: callId,
      }),
    );
    const node = createNode(tools);

    const response = await node.sendMessage(message([first, second]));

    const generationCalls = vi.mocked(provider.generateWithTools).mock.calls;
    expect(generationCalls).toHaveLength(2);
    expect(generationCalls[0]?.[0].systemPrompt).toBe(
      generationCalls[1]?.[0].systemPrompt,
    );
    expect(generationCalls[0]?.[0].tools).toEqual(tools);
    expect(generationCalls[1]?.[0].tools).toEqual(tools);
    expect(generationCalls[0]?.[0].messages.at(-1)?.actionRequests).toEqual([
      first,
    ]);
    expect(generationCalls[1]?.[0].messages.at(-1)?.actionRequests).toEqual([
      second,
    ]);
    expect(
      outcomes(response).map(({ requestId, callId }) => ({
        requestId,
        callId,
      })),
    ).toEqual([
      { requestId: 'request-first', callId: 'call-first-a' },
      { requestId: 'request-first', callId: 'call-first-b' },
      { requestId: 'request-second', callId: 'call-second' },
    ]);
  });

  it('returns provider exceptions as elaboration failures', async () => {
    vi.mocked(provider.generateWithTools).mockRejectedValue(
      new Error('model unavailable'),
    );
    const node = createNode(tools);

    const response = await node.sendMessage(message([request('request-1')]));

    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-1',
        intent: 'List the current directory.',
        stage: 'elaboration',
        success: false,
        error:
          'ToolNode tool-files could not elaborate the intent: model unavailable',
      },
    ]);
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { requestId: 'request-1' } }),
    );
    expect(node.status).toBe('idle');
  });

  it('fails closed when comparative operation resolution is unavailable', async () => {
    vi.mocked(provider.selectBest).mockRejectedValue('resolver unavailable');
    const node = createNode(tools);

    const response = await node.sendMessage(message([request('request-1')]));

    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-1',
        intent: 'List the current directory.',
        stage: 'elaboration',
        success: false,
        error:
          'ToolNode tool-files could not resolve an operation for the intent: resolver unavailable',
      },
    ]);
    expect(provider.generateWithTools).not.toHaveBeenCalled();
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve an operation for action request request-1.',
        metadata: { requestId: 'request-1' },
      }),
    );
    expect(telemetryEvents).toContainEqual(
      expect.objectContaining({
        event: 'tool.elaboration-completed',
        data: expect.objectContaining({
          errorCategory: 'semantic-resolution-failure',
        }),
      }),
    );
  });

  it.each([
    {
      description: 'an explanation',
      content: 'The available tools cannot delete files.',
      toolCalls: undefined,
      error:
        'ToolNode tool-files could not fulfill the intent: The available tools cannot delete files.',
    },
    {
      description: 'an empty tool-call array',
      content: '',
      toolCalls: [] as ToolCall[],
      error:
        'ToolNode tool-files returned neither a tool call nor an explanation for the intent.',
    },
  ])(
    'returns an afferent elaboration failure when the provider returns $description',
    async ({ content, toolCalls, error }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content,
        toolCalls,
      });
      const node = createNode(tools);

      const response = await node.sendMessage(message([request('request-1')]));

      expect(outcomes(response)).toEqual([
        {
          requestId: 'request-1',
          intent: 'List the current directory.',
          stage: 'elaboration',
          success: false,
          error,
        },
      ]);
      expect(eventStream.publish).toHaveBeenCalledWith({
        topicName: 'tool/elaboration-completed',
        data: {
          nodeId: 'tool-files',
          requestId: 'request-1',
          success: false,
          toolCalls: [],
          output: error,
        },
      });
      expect(mcpClient.invokeTool).not.toHaveBeenCalled();
    },
  );

  it('returns malformed provider calls as elaboration failures without invocation events', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [{ id: '', type: 'function' }] as unknown as ToolCall[],
    });
    const node = createNode(tools);

    const response = await node.sendMessage(message([request('request-1')]));

    expect(outcomes(response)[0]).toEqual(
      expect.objectContaining({
        requestId: 'request-1',
        stage: 'elaboration',
        success: false,
        error: expect.stringContaining('malformed tool call'),
      }),
    );
    expect(mcpClient.invokeTool).not.toHaveBeenCalled();
    expect(eventStream.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ topicName: 'tool/invocation-started' }),
    );
  });

  it.each([
    {
      description: 'an unadvertised tool',
      generatedCall: call('call-unknown', 'delete_everything', '{}'),
      expectedError: 'Tool delete_everything was not advertised',
    },
    {
      description: 'schema-invalid arguments',
      generatedCall: call(
        'call-schema',
        'list_directory',
        '{"path":".","recursive":false}',
      ),
      expectedError: 'arguments do not match its advertised schema',
    },
    {
      description: 'malformed JSON arguments',
      generatedCall: call('call-json', 'list_directory', '{bad'),
      expectedError: 'arguments are not valid JSON',
    },
  ])(
    'rejects $description before invoking MCP',
    async ({ generatedCall, expectedError }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls: [generatedCall],
      });
      const node = createNode(tools);

      const response = await node.sendMessage(message([request('request-1')]));

      expect(mcpClient.invokeTool).not.toHaveBeenCalled();
      expect(outcomes(response)[0]).toEqual(
        expect.objectContaining({
          requestId: 'request-1',
          intent: 'List the current directory.',
          selectedOperations: [generatedCall.function.name],
          stage: 'elaboration',
          success: false,
          error: expect.stringContaining(expectedError),
        }),
      );
      expect(telemetryEvents).toContainEqual(
        expect.objectContaining({
          event: 'tool.elaboration-completed',
          data: expect.objectContaining({
            errorCategory: 'structural-validation-failure',
          }),
        }),
      );
    },
  );

  it('returns an MCP failure after valid elaboration', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [call('call-failed')],
    });
    vi.mocked(mcpClient.invokeTool).mockResolvedValue({
      callId: 'call-failed',
      name: 'list_directory',
      success: false,
      error: 'permission denied',
    });
    const node = createNode(tools);

    const response = await node.sendMessage(message([request('request-1')]));

    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-1',
        stage: 'mcp',
        callId: 'call-failed',
        name: 'list_directory',
        success: false,
        error: 'permission denied',
      },
    ]);
  });

  it('resolves a direct-page intent to fetch despite a conflicting search hint', async () => {
    const url = 'https://example.com/cafes';
    const fetchRequest = request('request-fetch', {
      intent: `Fetch the content of ${url} and extract the cafe list.`,
      operation: 'search',
      arguments: { query: url },
    });
    vi.mocked(provider.selectBest).mockResolvedValue(1);
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [call('call-fetch', 'fetch', JSON.stringify({ url }))],
    });
    vi.mocked(mcpClient.invokeTool).mockResolvedValue({
      callId: 'call-fetch',
      name: 'fetch',
      success: true,
      result: { content: 'Cafe One' },
    });
    const node = createNode(webTools);

    const response = await node.sendMessage(message([fetchRequest]));

    expect(provider.selectBest).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'tool-intent',
            content: '',
            actionRequests: [fetchRequest],
          },
        ],
        candidates: expect.arrayContaining([
          expect.stringContaining('"operation":"search"'),
          expect.stringContaining('"operation":"fetch"'),
          expect.stringContaining('legion_no_applicable_tool'),
        ]),
      }),
      expect.objectContaining({ parentSpanId: 'request-fetch' }),
    );
    expect(provider.generateWithTools).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [webTools[1]] }),
      expect.objectContaining({ parentSpanId: 'request-fetch' }),
    );
    expect(mcpClient.invokeTool).toHaveBeenCalledWith(
      'call-fetch',
      'fetch',
      JSON.stringify({ url }),
    );
    expect(outcomes(response)[0]).toEqual(
      expect.objectContaining({ success: true, name: 'fetch' }),
    );
    expect(telemetryEvents).toContainEqual(
      expect.objectContaining({
        event: 'tool.elaboration-completed',
        data: expect.objectContaining({
          resolvedCandidateIndex: 1,
          resolvedOperation: 'fetch',
        }),
      }),
    );
    expect(provider.askYesNoQuestion).not.toHaveBeenCalled();
  });

  it('invokes search when search results are the authoritative outcome', async () => {
    const searchRequest = request('request-search', {
      intent: "Search the web for today's weather forecast in Brooklyn.",
      operation: 'ddg_search',
      arguments: { query: 'weather forecast Brooklyn' },
    });
    vi.mocked(provider.selectBest).mockResolvedValue(0);
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        call(
          'call-search',
          'search',
          JSON.stringify({ query: 'weather forecast Brooklyn' }),
        ),
      ],
    });
    vi.mocked(mcpClient.invokeTool).mockResolvedValue({
      callId: 'call-search',
      name: 'search',
      success: true,
      result: { results: ['Forecast'] },
    });
    const node = createNode(webTools);

    const response = await node.sendMessage(message([searchRequest]));

    expect(provider.generateWithTools).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [webTools[0]] }),
      expect.objectContaining({ parentSpanId: 'request-search' }),
    );
    expect(mcpClient.invokeTool).toHaveBeenCalledOnce();
    expect(outcomes(response)[0]).toEqual(
      expect.objectContaining({ success: true, name: 'search' }),
    );
  });

  it('rejects a structurally valid operation that contradicts resolution', async () => {
    const url = 'https://example.com/cafes';
    const fetchRequest = request('request-mismatch', {
      intent: `Fetch the content of ${url}.`,
    });
    vi.mocked(provider.selectBest).mockResolvedValue(1);
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        call('call-search', 'search', JSON.stringify({ query: url })),
      ],
    });
    const node = createNode(webTools);

    const response = await node.sendMessage(message([fetchRequest]));

    expect(mcpClient.invokeTool).not.toHaveBeenCalled();
    expect(outcomes(response)[0]).toEqual(
      expect.objectContaining({
        requestId: 'request-mismatch',
        intent: fetchRequest.intent,
        selectedOperations: ['search'],
        stage: 'elaboration',
        success: false,
        error: expect.stringContaining('Resolved operation fetch'),
      }),
    );
    expect(telemetryEvents).toContainEqual(
      expect.objectContaining({
        event: 'tool.elaboration-completed',
        data: expect.objectContaining({
          outcome: 'failure',
          callIds: ['call-search'],
          errorCategory: 'semantic-operation-mismatch',
        }),
      }),
    );
  });

  it.each([
    'Delete the remote account permanently.',
    'Do the thing with that page.',
  ])(
    'fails without generation when no operation can fulfill %s',
    async (intent) => {
      vi.mocked(provider.selectBest).mockResolvedValue(webTools.length);
      const node = createNode(webTools);

      const response = await node.sendMessage(
        message([request('request-none', { intent })]),
      );

      expect(provider.generateWithTools).not.toHaveBeenCalled();
      expect(mcpClient.invokeTool).not.toHaveBeenCalled();
      expect(outcomes(response)[0]).toEqual(
        expect.objectContaining({
          requestId: 'request-none',
          intent,
          success: false,
          error: expect.stringContaining('no advertised MCP operation'),
        }),
      );
      expect(telemetryEvents).toContainEqual(
        expect.objectContaining({
          event: 'tool.elaboration-completed',
          data: expect.objectContaining({
            errorCategory: 'no-applicable-tool',
            resolvedCandidateIndex: webTools.length,
            resolvedOperation: 'legion_no_applicable_tool',
          }),
        }),
      );
    },
  );

  it('normalizes an unexpected MCP adapter exception and continues', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [call('call-1')],
    });
    vi.mocked(mcpClient.invokeTool).mockRejectedValue('transport closed');
    const node = createNode(tools);

    const response = await node.sendMessage(message([request('request-1')]));

    expect(outcomes(response)).toEqual([
      {
        requestId: 'request-1',
        stage: 'mcp',
        callId: 'call-1',
        name: 'list_directory',
        success: false,
        error: 'transport closed',
      },
    ]);
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestId: 'request-1',
          callId: 'call-1',
          toolName: 'list_directory',
        },
      }),
    );
  });

  it('keeps processing when status and invocation event publication fail', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [call('call-1')],
    });
    vi.mocked(mcpClient.invokeTool).mockResolvedValue({
      callId: 'call-1',
      name: 'list_directory',
      success: true,
      result: 'ok',
    });
    vi.mocked(eventStream.publish).mockImplementation(() => {
      throw new Error('subscriber failed');
    });
    const node = createNode(tools);

    const response = await node.sendMessage(message([request('request-1')]));

    expect(outcomes(response)[0]).toEqual(
      expect.objectContaining({ success: true, result: 'ok' }),
    );
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to publish a node status change.',
      }),
    );
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to publish a tool elaboration completion event.',
      }),
    );
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to publish a tool invocation start event.',
      }),
    );
    expect(eventStream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to publish a tool invocation completion event.',
      }),
    );
    expect(node.status).toBe('idle');
  });

  it('publishes observable generation status without a relevance pass', async () => {
    const node = createNode(tools);
    vi.mocked(provider.generateWithTools).mockImplementation(async () => {
      expect(node.status).toBe('generating');
      return { content: 'No tool can fulfill this.', toolCalls: undefined };
    });

    await node.sendMessage(message([request('request-1')]));

    expect(eventStream.publish).not.toHaveBeenCalledWith({
      topicName: 'node/status-change',
      data: { nodeId: 'tool-files', status: 'evaluating-relevance' },
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'node/status-change',
      data: { nodeId: 'tool-files', status: 'generating' },
    });
    expect(node.status).toBe('idle');
  });
});
