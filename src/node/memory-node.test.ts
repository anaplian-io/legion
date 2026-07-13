import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryNode } from './memory-node.js';
import type { Provider } from '../types/provider.js';
import type { BroadcastMessage } from '../types/node.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import type { RelevanceGate } from '../types/relevance-gate.js';

describe('MemoryNode', () => {
  let mockProvider: Provider;
  let eventStream: ConcreteEventStream;
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
    eventStream = new ConcreteEventStream();
    mockRelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(true),
    };
  });

  it('should create a memory node with the given props', () => {
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    expect(node.id).toBe('memory-1');
    expect(node.kind).toBe('memory');
    expect(node.context).toBe('Initial context');
    expect(node.status).toBe('idle');
  });

  it('should return undefined if memory is not relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [
          { role: 'working-memory' as const, content: 'Previous message' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });
    expect(mockProvider.generate).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(node.status).toBe('idle');
  });

  it('should generate response when memory is relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [
          { role: 'working-memory', content: 'Previous message 1' },
          { role: 'working-memory', content: 'Previous message 2' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockProvider.generate).mockResolvedValue('Generated response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining('Initial context'),
      messages: [
        { role: 'working-memory', content: 'Previous message 1' },
        { role: 'working-memory', content: 'Previous message 2' },
        { role: 'broadcast', content: 'New broadcast' },
      ],
    });

    expect(result).toEqual({
      role: 'node-response',
      originatingNodeId: 'memory-1',
      content: 'Generated response',
    });
    expect(node.status).toBe('idle');
  });

  it('should generate response when relevance gate returns true', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(true);
    vi.mocked(mockProvider.generate).mockResolvedValue('Curious response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });
    expect(mockProvider.askYesNoQuestion).not.toHaveBeenCalled();
    expect(result).toEqual({
      role: 'node-response',
      originatingNodeId: 'memory-1',
      content: 'Curious response',
    });
  });

  it('should pass preamble to relevance gate', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Specialized in test scenarios',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    const relevanceCall = vi.mocked(mockRelevanceGate.isRelevant).mock
      .calls[0]?.[0];
    expect(relevanceCall).toBeDefined();
    expect(relevanceCall?.nodeContext).toContain(
      'You are one specialist node in a collective reasoning system',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'mind your own business, stay curious about the environment',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'role user-input, treat it as an interruption worth acknowledging',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'Specialized in test scenarios',
    );
  });

  it('should pass broadcast message to relevance gate', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [
          { role: 'working-memory', content: 'First WM' },
          { role: 'working-memory', content: 'Second WM' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });
  });

  it('should frame afferent capabilities as available system capabilities', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [
          {
            role: 'working-memory',
            content:
              'what will the weather be in Brooklyn, NY for the next few days? what should I wear? any interesting events I should know about nearby?',
          },
          {
            role: 'working-memory',
            content:
              'Need specific date range from user to provide tailored weather/event advice for Brooklyn, NY.',
          },
        ],
      },
      afferentContext: [
        {
          role: 'afferent-capability',
          content:
            'Available afferent capabilities:\n- ddg-search: can search the web for current/local information, forecasts, events, and linked sources.',
        },
      ],
      broadcast: {
        role: 'broadcast',
        content:
          'Need specific date range from user to provide tailored weather/event advice for Brooklyn, NY.',
      },
    };

    vi.mocked(mockProvider.generate).mockResolvedValue(
      'Search the web for Brooklyn NY weather next few days and nearby events.',
    );

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    const relevanceCall = vi.mocked(mockRelevanceGate.isRelevant).mock
      .calls[0]?.[0];
    expect(relevanceCall?.nodeContext).toContain(
      'available afferent capabilities',
    );
    expect(relevanceCall?.nodeContext).toContain('concrete next actions');
    expect(relevanceCall?.nodeContext).toContain(
      'Leave exact tool selection and execution details to afferent nodes',
    );
    expect(relevanceCall?.broadcastMessage).toEqual(broadcastMessage);

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining('available afferent capabilities'),
      messages: expect.arrayContaining([
        {
          role: 'afferent-capability',
          content:
            'Available afferent capabilities:\n- ddg-search: can search the web for current/local information, forecasts, events, and linked sources.',
        },
      ]),
    });
  });

  it('should handle empty working memory', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    expect(mockProvider.generate).toHaveBeenCalledWith({
      messages: [{ role: 'broadcast', content: 'New broadcast' }],
      systemPrompt: expect.any(String),
    });
  });

  it('should preserve id and kind after creation', () => {
    const node = new MemoryNode({
      id: 'test-id',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    expect(node.id).toBe('test-id');
    expect(node.kind).toBe('memory');
    expect(node.status).toBe('idle');
  });

  it('should return undefined when relevant check returns false', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [{ role: 'working-memory' as const, content: 'test' }],
      },
      broadcast: { role: 'broadcast' as const, content: 'new' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);
    vi.mocked(mockProvider.generate).mockResolvedValue('Should not be called');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(result).toBeUndefined();
    expect(mockProvider.generate).not.toHaveBeenCalled();
    expect(node.status).toBe('idle');
  });

  it('should publish status change events on status change', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    const statusEvents: Array<{ nodeId: string; status: string }> = [];
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: (data) => {
        statusEvents.push(data);
      },
    });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    expect(statusEvents).toHaveLength(4);
    expect(statusEvents[0]).toEqual({
      nodeId: 'memory-1',
      status: 'evaluating-relevance',
    });
    expect(statusEvents[1]).toEqual({ nodeId: 'memory-1', status: 'idle' });
    expect(statusEvents[2]).toEqual({
      nodeId: 'memory-1',
      status: 'generating',
    });
    expect(statusEvents[3]).toEqual({ nodeId: 'memory-1', status: 'idle' });
  });

  it('should handle async status event subscriber', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const asyncSubscriber = vi.fn().mockResolvedValue(undefined);
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: asyncSubscriber,
    });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    expect(asyncSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'evaluating-relevance',
    });
    expect(asyncSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'idle',
    });
  });

  it('should not throw if status event subscriber throws', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const errorSubscriber = vi.fn().mockImplementation(() => {
      throw new Error('Subscriber failed');
    });
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: errorSubscriber,
    });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
    expect(errorSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'evaluating-relevance',
    });
    expect(errorSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'idle',
    });
  });

  it('should handle publish throwing error gracefully', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);
    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    // Replace eventStream with one that throws on publish
    const throwingEventStream = {
      publish: () => {
        throw new Error('Publish failed');
      },
      subscribe: () => {},
    } as unknown as ConcreteEventStream;

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream: throwingEventStream,
      relevanceGate: mockRelevanceGate,
    });

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
  });

  it('should update context with broadcast and response when relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockProvider.generate).mockResolvedValue('Node response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage);

    expect(node.context).toBe(
      'Initial context\n\n[BROADCAST MESSAGE]:New broadcast[NODE RESPONSE]:Node response',
    );
    expect(node.status).toBe('idle');
  });

  it('should accumulate context across multiple sendMessage calls', async () => {
    const broadcastMessage1: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'First broadcast' },
    };

    const broadcastMessage2: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Second broadcast' },
    };

    vi.mocked(mockProvider.generate)
      .mockResolvedValueOnce('First response')
      .mockResolvedValueOnce('Second response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
    });

    await node.sendMessage(broadcastMessage1);
    await node.sendMessage(broadcastMessage2);

    expect(node.context).toBe(
      'Initial context\n\n[BROADCAST MESSAGE]:First broadcast[NODE RESPONSE]:First response\n\n[BROADCAST MESSAGE]:Second broadcast[NODE RESPONSE]:Second response',
    );
    expect(node.status).toBe('idle');
  });
});
