import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteToolNodeFactory } from './concrete-tool-node-factory.js';
import type { Provider } from '../types/provider.js';
import type { EventStream } from '../types/event-stream.js';
import type { CuriosityGate } from '../types/curiosity-gate.js';

// Mock MCP Client
interface MockMcpClient {
  close?: () => void;
}

describe('ConcreteToolNodeFactory', () => {
  let mockProvider: Provider;
  let mockEventStream: EventStream;
  let mockMcpClient: MockMcpClient;
  let mockCuriosityGate: CuriosityGate;

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
    mockMcpClient = {};
    mockCuriosityGate = {
      isCurious: vi.fn().mockResolvedValue(false),
    };
  });

  it('should create a factory with the given props', () => {
    const factory = new ConcreteToolNodeFactory({
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      curiosityGate: mockCuriosityGate,
    });

    expect(typeof factory.create).toBe('function');
  });

  it('should create a tool node with provided id', async () => {
    const factory = new ConcreteToolNodeFactory({
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      curiosityGate: mockCuriosityGate,
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    expect(node.id).toBe('test-node');
    expect(node.kind).toBe('tool');
  });

  it('should generate a random id if none provided', async () => {
    const factory = new ConcreteToolNodeFactory({
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      curiosityGate: mockCuriosityGate,
    });

    const node = factory.create({
      eventStream: mockEventStream,
    });

    expect(node.id).toBeDefined();
    expect(typeof node.id).toBe('string');
  });

  it('should use the same provider instance', async () => {
    const factory = new ConcreteToolNodeFactory({
      provider: mockProvider,
      mcpClient:
        mockMcpClient as unknown as import('@modelcontextprotocol/sdk/client/index.js').Client,
      curiosityGate: mockCuriosityGate,
    });

    const node = factory.create({
      nodeId: 'test-node',
      eventStream: mockEventStream,
    });

    expect(node.kind).toBe('tool');
  });
});
