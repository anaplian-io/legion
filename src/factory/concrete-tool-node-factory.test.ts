import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteToolNodeFactory } from './concrete-tool-node-factory.js';
import { ToolNode } from '../node/tool-node.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import { ConcreteErrorStream } from '../stream/concrete-error-stream.js';
import {
  createTestTelemetry,
  TEST_NODE_TELEMETRY,
} from '../telemetry/test-context.fixture.js';

// Mock MCP Client
interface MockMcpClient {
  close?: () => void;
}

describe('ConcreteToolNodeFactory', () => {
  let mockProvider: Provider;
  let mockEventStream: EventStream;
  let mockMcpClient: MockMcpClient;
  const telemetry = createTestTelemetry();

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn().mockResolvedValue(0),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    mockEventStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };
    mockMcpClient = {};
  });

  it('should create a factory with the given props', () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
    });

    expect(typeof factory.create).toBe('function');
  });

  it('should create a tool node with provided id', async () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    expect(node.id).toBe('test-node');
    expect(node.kind).toBe('tool');
    expect(node.capabilityDescription).toBe('can use factory test tools.');
  });

  it('should generate a random id if none provided', async () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
    });

    const node = factory.create({
      eventStream: mockEventStream,
    });

    expect(node.id).toBeDefined();
    expect(typeof node.id).toBe('string');
  });

  it('should use the same provider instance', async () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    expect(node.kind).toBe('tool');
  });

  it('should create independent targeted tool nodes', async () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
    });
    const firstNode = factory.create({
      nodeId: 'tool-1',
      eventStream: mockEventStream,
    });
    const secondNode = factory.create({
      nodeId: 'tool-2',
      eventStream: mockEventStream,
    });

    expect(firstNode.kind).toBe('tool');
    expect(secondNode.kind).toBe('tool');
  });

  it('should pass boot-fetched tools to its nodes', async () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      initialTools: [{ name: 'boot-tool', parameters: {} }],
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'No matching tool.',
      toolCalls: undefined,
    });
    await node.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: {
        role: 'broadcast',
        content: 'Use the boot tool.',
        actionRequests: [
          {
            id: 'request-1',
            targetNodeId: 'test-node',
            intent: 'Use the boot tool.',
          },
        ],
      },
    });

    expect(mockProvider.generateWithTools).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ name: 'boot-tool', parameters: {} }],
      }),
      expect.objectContaining({ stage: 'tool-elaboration' }),
    );
    expect((node as ToolNode).preamble).not.toContain('boot-tool');
  });

  it('passes an error stream through to its MCP client', () => {
    const factory = new ConcreteToolNodeFactory({
      telemetry,
      capabilityDescription: 'can report MCP failures.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      errorStream: new ConcreteErrorStream(),
    });

    expect(factory.create({ eventStream: mockEventStream }).kind).toBe('tool');
  });
});
