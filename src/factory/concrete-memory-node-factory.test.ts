import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteMemoryNodeFactory } from './concrete-memory-node-factory.js';
import type { Provider } from '../types/provider.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import type { RelevanceGate } from '../types/relevance-gate.js';

describe('ConcreteMemoryNodeFactory', () => {
  let mockProvider: Provider;
  let eventStream: ConcreteEventStream;
  let mockRelevanceGate: RelevanceGate;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    eventStream = new ConcreteEventStream();
    mockRelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(true),
    };
  });

  it('should create a factory with the given provider', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
    });

    expect(typeof factory.create).toBe('function');
  });

  it('should create a memory node with the given context', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
    });

    const node = factory.create({
      initialContext: 'Test context',
      eventStream,
    });

    expect(node.id).toBeDefined();
    expect(node.kind).toBe('memory');
    expect(node.context).toBe('Test context');
    expect(node.status).toBe('idle');
  });

  it('should use the provided provider for created nodes', async () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
    });

    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    const node = factory.create({
      initialContext: 'Test context',
      eventStream,
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    });

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalled();
    expect(mockProvider.generate).toHaveBeenCalled();
  });

  it('should generate unique IDs for each created node', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
    });

    const node1 = factory.create({
      initialContext: 'Context 1',
      eventStream,
    });
    const node2 = factory.create({
      initialContext: 'Context 2',
      eventStream,
    });

    expect(node1.id).not.toBe(node2.id);
  });

  it('should share the stateless relevance gate between nodes', async () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
    });
    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);
    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    const firstNode = factory.create({
      initialContext: 'Context 1',
      eventStream,
      nodeId: 'node-1',
    });
    const secondNode = factory.create({
      initialContext: 'Context 2',
      eventStream,
      nodeId: 'node-2',
    });

    await firstNode.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    });
    await secondNode.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    });

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledTimes(2);
  });
});
