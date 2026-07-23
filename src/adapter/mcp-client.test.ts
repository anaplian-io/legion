import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPClient } from './mcp-client.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ErrorStream } from '../types/error-stream.js';

// Mock the MCP SDK Client
interface MockSdkClient {
  listTools: () => Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }>;
  }>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{
    content?: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
    >;
    structuredContent?: unknown;
    isError?: boolean;
    toolResult?: unknown;
  }>;
  close?: () => void;
}

// Type assertion helper to avoid 'as any'
const asMockClient = (client: MockSdkClient): Client =>
  client as unknown as Client;

describe('MCPClient', () => {
  let mockSdkClient: MockSdkClient;

  beforeEach(() => {
    mockSdkClient = {
      listTools: vi.fn(),
      callTool: vi.fn(),
    };
  });

  it('should create an MCP client with the given SDK client', async () => {
    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    expect(mcpClient).toBeDefined();
  });

  it('should fetch tools from MCP server', async () => {
    vi.mocked(mockSdkClient.listTools).mockResolvedValue({
      tools: [
        { name: 'tool1', description: 'Tool one', inputSchema: {} },
        { name: 'tool2', description: 'Tool two', inputSchema: {} },
      ],
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const tools = await mcpClient.getAvailableTools();

    expect(tools).toEqual([
      { name: 'tool1', description: 'Tool one', parameters: {} },
      { name: 'tool2', description: 'Tool two', parameters: {} },
    ]);
  });

  it('should ignore tools with a non-object inputSchema', async () => {
    const errorStream: ErrorStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };
    vi.mocked(mockSdkClient.listTools).mockResolvedValue({
      tools: [
        // A misbehaving server returning a non-object schema.
        {
          name: 'bad_tool',
          description: 'Bad schema',
          inputSchema: null as unknown as Record<string, unknown>,
        },
      ],
    });

    const mcpClient = new MCPClient({
      client: asMockClient(mockSdkClient),
      errorStream,
    });
    const tools = await mcpClient.getAvailableTools();

    expect(tools).toEqual([]);
    expect(errorStream.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MCPClient',
        message: 'Ignored tool bad_tool because its input schema is invalid.',
      }),
    );
  });

  it('should handle missing description in tools', async () => {
    vi.mocked(mockSdkClient.listTools).mockResolvedValue({
      tools: [{ name: 'tool1', inputSchema: {} }],
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const tools = await mcpClient.getAvailableTools();

    expect(tools[0]?.description).toBe('');
  });

  it('should invoke a tool successfully', async () => {
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      content: [{ type: 'text' as const, text: 'Tool result' }],
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result).toEqual({
      callId: 'call_1',
      name: 'test_tool',
      success: true,
      result: { content: [{ type: 'text' as const, text: 'Tool result' }] },
    });

    expect(mockSdkClient.callTool).toHaveBeenCalledWith({
      name: 'test_tool',
      arguments: {},
    });
  });

  it('should parse JSON arguments correctly', async () => {
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      content: [{ type: 'text' as const, text: 'Success' }],
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool(
      'call_1',
      'test_tool',
      JSON.stringify({ key: 'value', number: 42 }),
    );

    expect(result.success).toBe(true);
    expect(mockSdkClient.callTool).toHaveBeenCalledWith({
      name: 'test_tool',
      arguments: { key: 'value', number: 42 },
    });
  });

  it('should pass a parsed object (not a string) to callTool for single-encoded args', async () => {
    // Regression guard for the provider double-encoding bug: a double-encoded
    // arguments string is still valid JSON, so it passes JSON.parse — but it
    // parses to a string rather than the arguments object, producing a
    // malformed callTool. This pins the contract that invokeTool receives a
    // single-encoded JSON object string and forwards a real object.
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    await mcpClient.invokeTool('call_1', 'test_tool', '{"location":"NYC"}');

    const forwardedArgs = vi.mocked(mockSdkClient.callTool).mock.calls[0]?.[0]
      ?.arguments;
    expect(typeof forwardedArgs).toBe('object');
    expect(forwardedArgs).toEqual({ location: 'NYC' });
  });

  it('should return error for invalid JSON arguments', async () => {
    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool(
      'call_1',
      'test_tool',
      'invalid json',
    );

    expect(result).toEqual({
      callId: 'call_1',
      name: 'test_tool',
      success: false,
      error: 'Invalid arguments JSON: invalid json',
    });

    expect(mockSdkClient.callTool).not.toHaveBeenCalled();
  });

  it('should reject non-object JSON arguments before calling MCP', async () => {
    const errorStream: ErrorStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };
    const mcpClient = new MCPClient({
      client: asMockClient(mockSdkClient),
      errorStream,
    });

    const result = await mcpClient.invokeTool(
      'call_1',
      'test_tool',
      '"double-encoded"',
    );

    expect(result).toEqual({
      callId: 'call_1',
      name: 'test_tool',
      success: false,
      error: 'Tool arguments must be a JSON object.',
    });
    expect(mockSdkClient.callTool).not.toHaveBeenCalled();
    expect(errorStream.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MCPClient',
        message: 'Tool test_tool received non-object arguments.',
      }),
    );
  });

  it('should handle structuredContent in tool response', async () => {
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      structuredContent: { value: 42, status: 'ok' },
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result).toEqual({
      callId: 'call_1',
      name: 'test_tool',
      success: true,
      result: { structuredContent: { value: 42, status: 'ok' } },
    });
  });

  it('should handle toolResult in response', async () => {
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      toolResult: { data: 'result' },
    });

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result.result).toEqual({ toolResult: { data: 'result' } });
  });

  it('should return MCP isError responses as failures', async () => {
    const errorStream: ErrorStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      isError: true,
      content: [
        { type: 'text', text: 'Permission denied' },
        { type: 'image', data: 'base64', mimeType: 'image/png' },
        { type: 'text', text: 'Try a different account' },
      ],
    });
    const mcpClient = new MCPClient({
      client: asMockClient(mockSdkClient),
      errorStream,
    });

    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result).toEqual({
      callId: 'call_1',
      name: 'test_tool',
      success: false,
      error: 'Permission denied\nTry a different account',
    });
    expect(errorStream.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MCPClient',
        message: 'Tool test_tool returned an MCP error result.',
      }),
    );
  });

  it('should describe an MCP isError response without text content', async () => {
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      isError: true,
      structuredContent: { code: 'FAILED' },
    });
    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });

    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result.error).toBe(
      'MCP tool test_tool returned an error: {"code":"FAILED"}',
    );
  });

  it('should ignore non-text MCP error content when describing a failure', async () => {
    vi.mocked(mockSdkClient.callTool).mockResolvedValue({
      isError: true,
      content: [{ type: 'image', data: 'base64', mimeType: 'image/png' }],
    });
    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });

    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result.error).toBe('MCP tool test_tool returned isError: true.');
  });

  it('should handle error from MCP SDK callTool', async () => {
    vi.mocked(mockSdkClient.callTool).mockRejectedValue(
      new Error('Connection failed'),
    );

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result).toEqual({
      callId: 'call_1',
      name: 'test_tool',
      success: false,
      error: 'Connection failed',
    });
  });

  it('should handle non-Error exceptions from MCP SDK', async () => {
    vi.mocked(mockSdkClient.callTool).mockRejectedValue('Timeout');

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    const result = await mcpClient.invokeTool('call_1', 'test_tool', '{}');

    expect(result.error).toBe('Timeout');
  });

  it('should invoke shutdown method on SDK client if available', async () => {
    const mockClose = vi.fn();
    (mockSdkClient as MockSdkClient & { close: () => void }).close = mockClose;

    const mcpClient = new MCPClient({ client: asMockClient(mockSdkClient) });
    await mcpClient.shutdown();

    expect(mockClose).toHaveBeenCalled();
  });
});
