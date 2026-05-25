import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteMemoryNodeFactory } from './concrete-memory-node-factory.js';
import type { Provider } from '../types/provider.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';

describe('ConcreteMemoryNodeFactory', () => {
  let mockProvider: Provider;
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    eventStream = new ConcreteEventStream();
  });

  it('should create a factory with the given provider', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
    });

    expect(typeof factory.create).toBe('function');
  });

  it('should create a memory node with the given context', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
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
    });

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    const node = factory.create({
      initialContext: 'Test context',
      eventStream,
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'Broadcast' },
    });

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalled();
    expect(mockProvider.generate).toHaveBeenCalled();
  });

  it('should generate unique IDs for each created node', () => {
    const factory = new ConcreteMemoryNodeFactory({
      provider: mockProvider,
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
});
