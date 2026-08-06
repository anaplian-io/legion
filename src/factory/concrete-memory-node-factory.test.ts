import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteMemoryNodeFactory } from './concrete-memory-node-factory.js';
import type { Provider } from '../types/provider.js';
import { TEST_NODE_TELEMETRY } from '../telemetry/test-context.fixture.js';
import { ConcreteEventStream } from '../stream/concrete-event-stream.js';
import type { RelevanceGate } from '../types/relevance-gate.js';
import { AppendOnlyMemoryContextBuilder } from '../node/support/append-only-memory-context-builder.js';
import { DeduplicatingMemoryPromptBuilder } from '../node/support/deduplicating-memory-prompt-builder.js';

describe('ConcreteMemoryNodeFactory', () => {
  let mockProvider: Provider;
  let eventStream: ConcreteEventStream;
  let mockRelevanceGate: RelevanceGate;
  let contextBuilder: AppendOnlyMemoryContextBuilder;
  let promptBuilder: DeduplicatingMemoryPromptBuilder;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    eventStream = new ConcreteEventStream();
    mockRelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(true),
    };
    contextBuilder = new AppendOnlyMemoryContextBuilder();
    promptBuilder = new DeduplicatingMemoryPromptBuilder();
  });

  it('should create a factory with the given provider', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    expect(typeof factory.create).toBe('function');
  });

  it('should create a memory node with the given context', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
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
      contextBuilder,
      promptBuilder,
    });

    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: 'Response',
      toolCalls: undefined,
    });

    const node = factory.create({
      initialContext: 'Test context',
      eventStream,
    });
    await node.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    });

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalled();
    expect(mockProvider.generateWithTools).toHaveBeenCalled();
  });

  it('should generate unique IDs for each created node', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
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
      contextBuilder,
      promptBuilder,
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
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    });
    await secondNode.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
    });

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledTimes(2);
  });
});
