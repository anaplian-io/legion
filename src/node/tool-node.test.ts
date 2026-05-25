import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolNode } from './tool-node.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import type { ToolDefinition } from '../types/tool.js';

// Mock MCPClient
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

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    mockEventStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };
    mockMCPClient = {
      getAvailableTools: vi.fn(),
      invokeTool: vi.fn(),
    };
  });

  it('should create a node with the given props', async () => {
    const tools: ToolDefinition[] = [
      { name: 'test_tool', description: 'A test tool', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();

    expect(node.id).toBe('test-node');
    expect(node.kind).toBe('tool');
    expect(typeof node.sendMessage).toBe('function');
  });

  it('should return empty context', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();

    expect(node.context).toBe('');
  });

  it('should return idle status initially', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();

    expect(node.status).toBe('idle');
  });

  it('should handle sendMessage with no tool calls', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: {
        messages: [],
      },
      broadcast: { content: 'Test broadcast' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Tool response',
      toolCalls: undefined,
    });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    const result = await node.sendMessage(broadcastMessage);

    expect(result).toEqual({
      originatingNodeId: 'test-node',
      content: 'Tool response',
    });
  });

  it('should get tool calls from LLM and invoke them via MCP', async () => {
    const tools: ToolDefinition[] = [
      { name: 'get_weather', description: 'Get weather', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValueOnce({
      callId: 'call_1',
      name: 'get_weather',
      success: true,
      result: { temperature: 72, condition: 'sunny' },
    });
    const broadcastMessage = {
      workingMemory: {
        messages: [],
      },
      broadcast: { content: 'What is the weather?' },
    };

    // First call returns tool calls
    vi.mocked(mockProvider.generateWithTools)
      .mockResolvedValueOnce({
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
      })
      // Second call returns the final response after tool results
      .mockResolvedValueOnce({
        content: 'The weather in NYC is sunny (72°F)',
        toolCalls: undefined,
      });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    const result = await node.sendMessage(broadcastMessage);

    expect(result).toEqual({
      originatingNodeId: 'test-node',
      content: 'The weather in NYC is sunny (72°F)',
    });

    // First call should have the initial request with tools
    expect(mockProvider.generateWithTools).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(mockProvider.generateWithTools).mock.calls[0]?.[0],
    ).toEqual(
      expect.objectContaining({
        tools,
      }),
    );
  });

  it('should include working memory in system prompt', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: {
        messages: [
          { content: 'Previous message 1' },
          { content: 'Previous message 2' },
        ],
      },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Response',
      toolCalls: undefined,
    });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    const callArgs = vi.mocked(mockProvider.generateWithTools).mock
      .calls[0]?.[0] as { systemPrompt: string };
    expect(callArgs.systemPrompt).toContain('Previous message 1');
    expect(callArgs.systemPrompt).toContain('Previous message 2');
    expect(callArgs.systemPrompt).toContain('New broadcast');
  });

  it('should set status to generating during sendMessage', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Test' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Response',
      toolCalls: undefined,
    });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    expect(mockEventStream.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'generating' }),
      }),
    );
  });

  it('should set status back to idle after sendMessage', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Test' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Response',
      toolCalls: undefined,
    });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

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

  it('should return undefined on error getting tool calls', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Test' },
    };

    vi.mocked(mockProvider.generateWithTools).mockRejectedValue(
      new Error('API error'),
    );

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    const result = await node.sendMessage(broadcastMessage);

    expect(result).toBeUndefined();
  });

  it('should publish status change events to event stream', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Test' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Response',
      toolCalls: undefined,
    });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    // Should publish 2 events: generating and idle
    expect(mockEventStream.publish).toHaveBeenCalledTimes(2);
  });

  it('should handle empty toolCalls array', async () => {
    const tools: ToolDefinition[] = [{ name: 'test', parameters: {} }];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Test' },
    };

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Response',
      toolCalls: [],
    });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    const result = await node.sendMessage(broadcastMessage);

    expect(result).toEqual({
      originatingNodeId: 'test-node',
      content: 'Response',
    });
  });

  it('should include tool results in messages to LLM after execution', async () => {
    const tools: ToolDefinition[] = [
      { name: 'calculator', description: 'Calculate math', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValueOnce({
      callId: 'call_calc',
      name: 'calculator',
      success: true,
      result: 4,
    });
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'What is 2+2?' },
    };

    vi.mocked(mockProvider.generateWithTools)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        content: 'The result is 4',
        toolCalls: undefined,
      });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    // Second call should include the tool result message
    const secondCallArgs = vi.mocked(mockProvider.generateWithTools).mock
      .calls[1]?.[0] as { messages: Array<{ content: string }> };
    expect(secondCallArgs?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originatingNodeId: 'test-node',
        }),
      ]),
    );
  });

  it('should return error message when tool is not found', async () => {
    const tools: ToolDefinition[] = [
      { name: 'known_tool', description: 'Known tool', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValueOnce({
      callId: 'call_unknown',
      name: 'unknown_tool',
      success: false,
      error: 'Tool "unknown_tool" not found',
    });
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Call unknown tool' },
    };

    vi.mocked(mockProvider.generateWithTools)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call_unknown',
            type: 'function' as const,
            function: {
              name: 'unknown_tool',
              arguments: JSON.stringify({ param: 'value' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: undefined,
      });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    // The error should be included in the messages sent back to LLM
    const secondCallArgs = vi.mocked(mockProvider.generateWithTools).mock
      .calls[1]?.[0] as { messages: Array<{ content: string }> };
    expect(secondCallArgs?.messages[1]?.content).toContain('not found');
  });

  it('should handle error during tool execution and return to LLM', async () => {
    const tools: ToolDefinition[] = [
      { name: 'calculator', description: 'Calculate math', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValueOnce({
      callId: 'call_calc',
      name: 'calculator',
      success: false,
      error: 'Connection timeout',
    });
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'What is 2+2?' },
    };

    vi.mocked(mockProvider.generateWithTools)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        content: 'Processing complete with error handling',
        toolCalls: undefined,
      });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    const result = await node.sendMessage(broadcastMessage);

    expect(result).toEqual({
      originatingNodeId: 'test-node',
      content: 'Processing complete with error handling',
    });
  });

  it('should handle multiple tool calls', async () => {
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
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Use multiple tools' },
    };

    vi.mocked(mockProvider.generateWithTools)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        content: 'Both tools completed',
        toolCalls: undefined,
      });

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    await node.sendMessage(broadcastMessage);

    // Should have called generateWithTools twice
    expect(mockProvider.generateWithTools).toHaveBeenCalledTimes(2);
  });

  it('should return undefined when final LLM call after tool execution fails', async () => {
    const tools: ToolDefinition[] = [
      { name: 'calculator', description: 'Calculate math', parameters: {} },
    ];
    vi.mocked(mockMCPClient.getAvailableTools).mockResolvedValue(tools);
    vi.mocked(mockMCPClient.invokeTool).mockResolvedValueOnce({
      callId: 'call_calc',
      name: 'calculator',
      success: true,
      result: 4,
    });
    const broadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'What is 2+2?' },
    };

    // First call succeeds with tool calls
    vi.mocked(mockProvider.generateWithTools).mockResolvedValueOnce({
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
    // Second call (after tool execution) fails
    vi.mocked(mockProvider.generateWithTools).mockRejectedValue(
      new Error('Final synthesis failed'),
    );

    const node = new ToolNode({
      id: 'test-node',
      provider: mockProvider,
      eventStream: mockEventStream,
      mcpClient:
        mockMCPClient as unknown as import('../mcp/mcp-client.js').MCPClient,
    });

    await node.initialize();
    const result = await node.sendMessage(broadcastMessage);

    expect(result).toBeUndefined();
  });
});
