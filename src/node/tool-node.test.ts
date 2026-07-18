import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolNode } from './tool-node.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import type { ToolDefinition } from '../types/tool.js';
import type { RelevanceGate } from '../types/relevance-gate.js';

// Mock MCPClient interface matching the actual implementation
interface MockMCPClient {
  getAvailableTools: () => Promise<ToolDefinition[]>;
  invokeTool: (
    callId: string,
    name: string,
    argumentsStr: string,
  ) => Promise<{
    callId: string;
    name: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
}

describe('ToolNode', () => {
  let mockProvider: Provider;
  let mockEventStream: EventStream;
  let mockMCPClient: MockMCPClient;
  let mockRelevanceGate: RelevanceGate;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn().mockResolvedValue(true),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    mockEventStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };
    mockMCPClient = {
      getAvailableTools: vi.fn().mockResolvedValue([]),
      invokeTool: vi.fn(),
    };
    mockRelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(true),
    };
  });

  it('should create a node with the given props', async () => {
    const tools: ToolDefinition[] = [
      { name: 'test_tool', description: 'A test tool', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();

    expect(node.id).toBe('test-node');
    expect(node.kind).toBe('tool');
    expect(node.capabilityDescription).toBe('can use test tools.');
    expect(typeof node.sendMessage).toBe('function');
  });

  it('should return empty context', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();

    expect(node.context).toBe('');
  });

  it('should return idle status initially', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();

    expect(node.status).toBe('idle');
  });

  it('should get tools automatically on first sendMessage if not initialized', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    // Don't call initialize - should auto-initialize on first sendMessage
    await node.sendMessage(broadcastMessage);

    expect(mockMCPClient.getAvailableTools).toHaveBeenCalled();
  });

  it('should use tools fetched during boot without fetching them again', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
      initialTools: tools,
    });

    await expect(
      node.sendMessage({
        workingMemory: { messages: [] },
        broadcast: { role: 'broadcast' as const, content: 'Test' },
      }),
    ).resolves.toBeUndefined();
    expect(mockMCPClient.getAvailableTools).not.toHaveBeenCalled();
  });

  it('should return undefined when tools are not relevant to broadcast', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    expect(result).toBeUndefined();
  });

  it('should return undefined when LLM returns no tool calls', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Some response',
      toolCalls: undefined,
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    expect(result).toBeUndefined();
  });

  it('should return undefined when LLM returns empty tool calls array', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    expect(result).toBeUndefined();
  });

  it('should invoke tools and return JSON string of results', async () => {
    const tools: ToolDefinition[] = [
      { name: 'get_weather', description: 'Get weather', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValue({
      callId: 'call_1',
      name: 'get_weather',
      success: true,
      result: { temperature: 72, condition: 'sunny' },
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        {
          id: 'call_1',
          type: 'function' as const,
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'NYC' }),
          },
        },
      ],
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: {
        role: 'broadcast' as const,
        content: 'What is the weather?',
      },
    });

    // Should return JSON string of tool results array
    expect(result).toEqual({
      role: 'afferent',
      originatingNodeId: 'test-node',
      content: JSON.stringify([
        {
          callId: 'call_1',
          name: 'get_weather',
          success: true,
          result: { temperature: 72, condition: 'sunny' },
        },
      ]),
    });

    expect(mockProvider.generateWithTools).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(mockProvider.generateWithTools).mock.calls[0]?.[0],
    ).toEqual(
      expect.objectContaining({
        tools,
      }),
    );
    expect(mockEventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: 'test-node',
        callId: 'call_1',
        toolName: 'get_weather',
        arguments: JSON.stringify({ location: 'NYC' }),
      },
    });
    expect(mockEventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-completed',
      data: {
        nodeId: 'test-node',
        callId: 'call_1',
        toolName: 'get_weather',
        success: true,
        output: JSON.stringify({ temperature: 72, condition: 'sunny' }),
      },
    });
  });

  it('should pass working memory and broadcast as discrete messages to generateWithTools', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const broadcastMessage = {
      workingMemory: {
        messages: [
          { role: 'working-memory' as const, content: 'Previous message 1' },
          { role: 'working-memory' as const, content: 'Previous message 2' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    // Working memory and broadcast travel as discrete messages; the system
    // prompt stays a stable, cacheable instruction free of volatile content.
    const callArgs = vi.mocked(mockProvider.generateWithTools).mock
      .calls[0]?.[0] as {
      systemPrompt: string;
      messages: { role: string; content: string }[];
    };
    expect(callArgs.messages).toEqual([
      { role: 'working-memory' as const, content: 'Previous message 1' },
      { role: 'working-memory' as const, content: 'Previous message 2' },
      { role: 'broadcast' as const, content: 'New broadcast' },
    ]);
    expect(callArgs.systemPrompt).not.toContain('Previous message 1');
  });

  it('should pass broadcast and tool preamble to relevance gate', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    const broadcastMessage = {
      workingMemory: {
        messages: [
          { role: 'working-memory' as const, content: 'First WM' },
          { role: 'working-memory' as const, content: 'Second WM' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };
    await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'test-node',
      epochsAlive: 0,
      nodeContext: expect.stringMatching(
        /Your node ID: test-node[\s\S]*Your capability: can use test tools\.[\s\S]*Your available tools:/,
      ),
    });
  });

  it('should pass full broadcast message to relevance gate', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web for current information',
        parameters: {},
      },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'search-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    const broadcastMessage = {
      workingMemory: {
        messages: [
          {
            role: 'working-memory' as const,
            content:
              'what will the weather be in Brooklyn, NY for the next few days? what should I wear? any interesting events I should know about nearby?',
          },
          {
            role: 'working-memory' as const,
            content:
              'Need user input/action on weather links for Brooklyn, NY.',
          },
          {
            role: 'working-memory' as const,
            content:
              'Need specific dates for weather/clothing advice; no event info found yet.',
          },
        ],
      },
      broadcast: {
        role: 'broadcast' as const,
        content:
          'Need specific date range from user to provide tailored weather/event advice for Brooklyn, NY.',
      },
    };
    await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'search-node',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Search the web'),
    });
  });

  it('should keep exact tool execution decisions inside the tool node', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web for current information',
        parameters: {},
      },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(true);
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'search-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    await node.sendMessage({
      workingMemory: {
        messages: [
          {
            role: 'working-memory' as const,
            content:
              'what will the weather be in Brooklyn, NY for the next few days? what should I wear? any interesting events I should know about nearby?',
          },
          {
            role: 'working-memory' as const,
            content:
              'Need specific dates for weather/clothing advice; no event info found yet.',
          },
        ],
      },
      broadcast: {
        role: 'broadcast' as const,
        content:
          'Need specific date range from user to provide tailored weather/event advice for Brooklyn, NY.',
      },
    });

    const generateCall = vi.mocked(mockProvider.generateWithTools).mock
      .calls[0]?.[0];
    expect(generateCall?.systemPrompt).toContain('tool invocation node');
    expect(generateCall?.systemPrompt).toContain('available tools');
    expect(generateCall?.systemPrompt).toContain('You MUST make a tool call');
  });

  it('should generate when relevance gate selects the tool node', async () => {
    const tools: ToolDefinition[] = [{ name: 'search', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(true);
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'search-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: {
        role: 'broadcast' as const,
        content: 'Search for a current forecast.',
      },
    });

    expect(mockProvider.askYesNoQuestion).not.toHaveBeenCalled();
    expect(mockProvider.generateWithTools).toHaveBeenCalledTimes(1);
  });

  it('should set status to evaluating-relevance during sendMessage', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    expect(mockEventStream.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'evaluating-relevance' }),
      }),
    );
  });

  it('should set status to generating after relevance check', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    expect(mockEventStream.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'generating' }),
      }),
    );
  });

  it('should set status back to idle after sendMessage completes', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    const publishCalls = vi.mocked(mockEventStream.publish).mock.calls;
    // Last call should be setting status to idle
    expect(publishCalls[publishCalls.length - 1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ status: 'idle' }),
        }),
      ]),
    );
  });

  it('should return JSON string with error when tool execution fails', async () => {
    const tools: ToolDefinition[] = [
      { name: 'calculator', description: 'Calculate math', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValue({
      callId: 'call_calc',
      name: 'calculator',
      success: false,
      error: 'Connection timeout',
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        {
          id: 'call_calc',
          type: 'function' as const,
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ expression: '2+2' }),
          },
        },
      ],
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'What is 2+2?' },
    });

    expect(result).toEqual({
      role: 'afferent',
      originatingNodeId: 'test-node',
      content: JSON.stringify([
        {
          callId: 'call_calc',
          name: 'calculator',
          success: false,
          error: 'Connection timeout',
        },
      ]),
    });
    expect(mockEventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-completed',
      data: {
        nodeId: 'test-node',
        callId: 'call_calc',
        toolName: 'calculator',
        success: false,
        output: 'Connection timeout',
      },
    });
  });

  it('should return JSON string with caught exception when tool throws', async () => {
    const tools: ToolDefinition[] = [
      { name: 'calculator', description: 'Calculate math', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockRejectedValue(
      new Error('Network error'),
    );

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        {
          id: 'call_calc',
          type: 'function' as const,
          function: {
            name: 'calculator',
            arguments: JSON.stringify({ expression: '2+2' }),
          },
        },
      ],
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'What is 2+2?' },
    });

    expect(result).toEqual({
      role: 'afferent',
      originatingNodeId: 'test-node',
      content: JSON.stringify([
        {
          callId: 'call_calc',
          name: 'calculator',
          success: false,
          error: 'Error: Network error',
        },
      ]),
    });
  });

  it('should handle multiple tool calls in parallel', async () => {
    const tools: ToolDefinition[] = [
      { name: 'tool_a', parameters: {} },
      { name: 'tool_b', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool)
      .mockResolvedValueOnce({
        callId: 'call_a',
        name: 'tool_a',
        success: true,
        result: 'result_a',
      })
      .mockResolvedValueOnce({
        callId: 'call_b',
        name: 'tool_b',
        success: true,
        result: 'result_b',
      });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        {
          id: 'call_a',
          type: 'function' as const,
          function: {
            name: 'tool_a',
            arguments: JSON.stringify({ param: 'a' }),
          },
        },
        {
          id: 'call_b',
          type: 'function' as const,
          function: {
            name: 'tool_b',
            arguments: JSON.stringify({ param: 'b' }),
          },
        },
      ],
    });

    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Use multiple tools' },
    });

    // Should have invoked both tools
    expect(mockMCPClient.invokeTool).toHaveBeenCalledTimes(2);
  });

  it('should publish status change events to event stream', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    // Should publish 3 events: evaluating-relevance, idle, generating, and idle
    expect(mockEventStream.publish).toHaveBeenCalledTimes(4);
  });

  it('should not throw if event publish throws during status change', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const throwingEventStream: EventStream = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('Publish failed');
      }),
      subscribe: vi.fn(),
    };

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: throwingEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();

    await expect(
      node.sendMessage({
        workingMemory: { messages: [] },
        broadcast: { role: 'broadcast' as const, content: 'Test' },
      }),
    ).resolves.toBeUndefined();
  });

  it('should proceed when relevance gate returns true', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(true);
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [],
    });

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    expect(mockProvider.generateWithTools).toHaveBeenCalled();
  });

  it('should return undefined when relevance gate returns false', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new ToolNode({
      capabilityDescription: 'can use test tools.',
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../adapter/mcp-client.js').MCPClient,
      relevanceGate: mockRelevanceGate,
    });

    await node.initialize();
    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Test' },
    });

    // Should return undefined because neither relevance nor curiosity triggered
    expect(result).toBeUndefined();
  });
});
