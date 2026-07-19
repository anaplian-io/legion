import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteToolNodeFactory } from './concrete-tool-node-factory.js';
import { ToolNode } from '../node/tool-node.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import type { RelevanceGate } from '../types/relevance-gate.js';
import { ConcreteErrorStream } from '../service/concrete-error-stream.js';

// Mock MCP Client
interface MockMcpClient {
  close?: () => void;
}

describe('ConcreteToolNodeFactory', () => {
  let mockProvider: Provider;
  let mockEventStream: EventStream;
  let mockMcpClient: MockMcpClient;
  let mockRelevanceGate: RelevanceGate;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
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
    mockMcpClient = {};
    mockRelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(false),
    };
  });

  it('should create a factory with the given props', () => {
    const factory = new ConcreteToolNodeFactory({
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
    });

    expect(typeof factory.create).toBe('function');
  });

  it('should create a tool node with provided id', async () => {
    const factory = new ConcreteToolNodeFactory({
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
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
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
    });

    const node = factory.create({
      eventStream: mockEventStream,
    });

    expect(node.id).toBeDefined();
    expect(typeof node.id).toBe('string');
  });

  it('should use the same provider instance', async () => {
    const factory = new ConcreteToolNodeFactory({
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    expect(node.kind).toBe('tool');
  });

  it('should create nodes with the shared stateless relevance gate', async () => {
    const factory = new ConcreteToolNodeFactory({
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
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

  it('should pass boot-fetched tools to its nodes', () => {
    const factory = new ConcreteToolNodeFactory({
      capabilityDescription: 'can use factory test tools.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
      initialTools: [{ name: 'boot-tool', parameters: {} }],
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    expect((node as ToolNode).preamble).toContain('boot-tool');
  });

  it('passes an error stream through to its MCP client', () => {
    const factory = new ConcreteToolNodeFactory({
      capabilityDescription: 'can report MCP failures.',
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      relevanceGate: mockRelevanceGate,
      errorStream: new ConcreteErrorStream(),
    });

    expect(factory.create({ eventStream: mockEventStream }).kind).toBe('tool');
  });
});
