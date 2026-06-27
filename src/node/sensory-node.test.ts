import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SensoryNode } from './sensory-node.js';
import type { Provider } from '../types/provider.js';
import type { BroadcastMessage } from '../types/node.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';

describe('SensoryNode', () => {
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

  it('should create a sensory node with the given props', () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Test sensation'),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    expect(node.id).toBe('sensory-1');
    expect(node.kind).toBe('sensory');
    expect(node.context).toBe('');
    expect(node.status).toBe('idle');
  });

  it('should call sensor.sense and return response when sendMessage is called', async () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Test sensation'),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'New broadcast' },
    };

    const result = await node.sendMessage(broadcastMessage);

    expect(sensor.sense).toHaveBeenCalledWith(broadcastMessage);
    expect(result).toEqual({
      originatingNodeId: 'sensory-1',
      content: 'Test sensation',
    });
  });

  it('should publish status change events during sendMessage', async () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Test sensation'),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    const statusEvents: Array<{ nodeId: string; status: string }> = [];
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: (data) => {
        statusEvents.push(data);
      },
    });

    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test' },
    });

    expect(statusEvents).toHaveLength(2);
    expect(statusEvents[0]).toEqual({
      nodeId: 'sensory-1',
      status: 'generating',
    });
    expect(statusEvents[1]).toEqual({
      nodeId: 'sensory-1',
      status: 'idle',
    });
  });

  it('should handle async sensor.sense', async () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Async sensation'),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test' },
    });

    expect(result).toEqual({
      originatingNodeId: 'sensory-1',
      content: 'Async sensation',
    });
  });

  it('should preserve id and kind across multiple calls', async () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Sensation'),
    };

    const node = new SensoryNode({
      id: 'test-id',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test1' },
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test2' },
    });

    expect(node.id).toBe('test-id');
    expect(node.kind).toBe('sensory');
  });

  it('should use the same sensor instance across multiple calls', async () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Sensation'),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test1' },
    });
    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test2' },
    });

    expect(sensor.sense).toHaveBeenCalledTimes(2);
  });

  it('should return undefined when sensor throws an error', async () => {
    const sensor = {
      sense: vi.fn().mockRejectedValue(new Error('Sensor failed')),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    const result = await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test' },
    });

    expect(result).toBeUndefined();
  });

  it('should handle provider that is not used (sensory nodes do not use LLM for relevance)', async () => {
    const sensor = {
      sense: vi.fn().mockResolvedValue('Sensation'),
    };

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream,
      sensor,
    });

    await node.sendMessage({
      workingMemory: { messages: [] },
      broadcast: { content: 'test' },
    });

    // Provider methods should not be called for sensory nodes
    expect(mockProvider.askYesNoQuestion).not.toHaveBeenCalled();
    expect(mockProvider.generate).not.toHaveBeenCalled();
    expect(mockProvider.rankByRelevance).not.toHaveBeenCalled();
    expect(mockProvider.splitString).not.toHaveBeenCalled();
  });

  it('should not throw if event publish throws during status change', async () => {
    const sensor = { sense: vi.fn().mockResolvedValue('Sensation') };
    const throwingEventStream = {
      publish: () => {
        throw new Error('Publish failed');
      },
      subscribe: () => {},
    } as unknown as ConcreteEventStream;

    const node = new SensoryNode({
      id: 'sensory-1',
      provider: mockProvider,
      eventStream: throwingEventStream,
      sensor,
    });

    await expect(
      node.sendMessage({
        workingMemory: { messages: [] },
        broadcast: { content: 'test' },
      }),
    ).resolves.toEqual({
      originatingNodeId: 'sensory-1',
      content: 'Sensation',
    });
  });
});
