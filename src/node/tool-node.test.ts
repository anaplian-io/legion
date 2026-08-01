import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolNode, ToolNodeOutcome } from './tool-node.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import type { ToolCall, ToolDefinition } from '../types/tool.js';
import type { ActionRequest, Message } from '../types/message.js';
import type { MCPClient, ToolResult } from '../adapter/mcp-client.js';

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

  const createNode = (initialTools?: readonly ToolDefinition[]): ToolNode =>
    new ToolNode({
      id: 'tool-files',
      capabilityDescription: 'can inspect workspace files.',
      provider,
      eventStream,
      mcpClient: mcpClient as unknown as MCPClient,
      ...(initialTools === undefined ? {} : { initialTools }),
    });

  beforeEach(() => {
    provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
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
        stage: 'elaboration',
        success: false,
        error: 'ToolNode tool-files could not load its MCP tools: offline',
      },
      {
        requestId: 'request-b',
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

    expect(provider.generateWithTools).toHaveBeenCalledWith({
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
    });
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
    expect(generationCalls[0]?.[0].tools).toBe(generationCalls[1]?.[0].tools);
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
      expectedError: 'Unknown MCP tool delete_everything.',
    },
    {
      description: 'schema-invalid arguments',
      generatedCall: call(
        'call-schema',
        'list_directory',
        '{"path":".","recursive":false}',
      ),
      expectedError: 'Input validation error: recursive is not allowed.',
    },
    {
      description: 'malformed JSON arguments',
      generatedCall: call('call-json', 'list_directory', '{bad'),
      expectedError: 'Invalid arguments JSON: {bad',
    },
  ])(
    'delegates $description to MCP and returns its failure',
    async ({ generatedCall, expectedError }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls: [generatedCall],
      });
      vi.mocked(mcpClient.invokeTool).mockResolvedValue({
        callId: generatedCall.id,
        name: generatedCall.function.name,
        success: false,
        error: expectedError,
      });
      const node = createNode(tools);

      const response = await node.sendMessage(message([request('request-1')]));

      expect(mcpClient.invokeTool).toHaveBeenCalledWith(
        generatedCall.id,
        generatedCall.function.name,
        generatedCall.function.arguments,
      );
      expect(outcomes(response)).toEqual([
        {
          requestId: 'request-1',
          stage: 'mcp',
          callId: generatedCall.id,
          name: generatedCall.function.name,
          success: false,
          error: expectedError,
        },
      ]);
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
