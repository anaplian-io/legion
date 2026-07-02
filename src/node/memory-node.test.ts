import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryNode } from './memory-node.js';
import type { Provider } from '../types/provider.js';
import type { BroadcastMessage } from '../types/node.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import type { CuriosityGate } from '../types/curiosity-gate.js';

describe('MemoryNode', () => {
  let mockProvider: Provider;
  let eventStream: ConcreteEventStream;
  let mockCuriosityGate: CuriosityGate;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    eventStream = new ConcreteEventStream();
    mockCuriosityGate = {
      isCurious: vi.fn().mockResolvedValue(false),
    };
  });

  it('should create a memory node with the given props', () => {
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    expect(node.id).toBe('memory-1');
    expect(node.kind).toBe('memory');
    expect(node.context).toBe('Initial context');
    expect(node.status).toBe('idle');
  });

  it('should return undefined if memory is not relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [{ content: 'Previous message' }],
      },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);
    // Set curiosity gate to false so both checks fail
    vi.mocked(mockCuriosityGate.isCurious).mockResolvedValue(false);

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalled();
    expect(mockProvider.generate).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(node.status).toBe('idle');
  });

  it('should generate response when memory is relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [
          { content: 'Previous message 1' },
          { content: 'Previous message 2' },
        ],
      },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
    vi.mocked(mockProvider.generate).mockResolvedValue('Generated response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining('Initial context'),
      messages: [
        { content: 'Previous message 1' },
        { content: 'Previous message 2' },
        { content: 'New broadcast' },
      ],
      question: expect.stringContaining('non-redundant'),
    });

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining('Initial context'),
      messages: [
        { content: 'Previous message 1' },
        { content: 'Previous message 2' },
        { content: 'New broadcast' },
      ],
    });

    expect(result).toEqual({
      originatingNodeId: 'memory-1',
      content: 'Generated response',
    });
    expect(node.status).toBe('idle');
  });

  it('should generate response when curiosity overrides low relevance', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);
    vi.mocked(mockCuriosityGate.isCurious).mockResolvedValue(true);
    vi.mocked(mockProvider.generate).mockResolvedValue('Curious response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(mockCuriosityGate.isCurious).toHaveBeenCalledWith({
      broadcastMessage,
      nodeContext: 'Initial context',
    });
    expect(mockProvider.askYesNoQuestion).not.toHaveBeenCalled();
    expect(result).toEqual({
      originatingNodeId: 'memory-1',
      content: 'Curious response',
    });
  });

  it('should use preamble in askYesNoQuestion', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Specialized in test scenarios',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    await node.sendMessage(broadcastMessage);

    const askCall = vi.mocked(mockProvider.askYesNoQuestion).mock.calls[0]?.[0];
    expect(askCall).toBeDefined();
    expect(askCall?.systemPrompt).toContain(
      'You are one specialist node in a collective reasoning system',
    );
    expect(askCall?.systemPrompt).toContain('Specialized in test scenarios');
    expect(askCall?.messages).toEqual([{ content: 'New broadcast' }]);
  });

  it('should pass working memory and broadcast as discrete messages', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: {
        messages: [{ content: 'First WM' }, { content: 'Second WM' }],
      },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    await node.sendMessage(broadcastMessage);

    const askCall = vi.mocked(mockProvider.askYesNoQuestion).mock.calls[0]?.[0];
    expect(askCall).toBeDefined();
    // Working memory and the broadcast are now discrete messages rather than a
    // concatenated string, so the provider can place the volatile suffix after
    // the cacheable identity+context prefix (and there is no separator bug to
    // reintroduce).
    expect(askCall?.messages).toEqual([
      { content: 'First WM' },
      { content: 'Second WM' },
      { content: 'New broadcast' },
    ]);
  });

  it('should handle empty working memory', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
    vi.mocked(mockProvider.generate).mockResolvedValue('Response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    await node.sendMessage(broadcastMessage);

    expect(mockProvider.generate).toHaveBeenCalledWith({
      messages: [{ content: 'New broadcast' }],
      systemPrompt: expect.any(String),
    });
  });

  it('should preserve id and kind after creation', () => {
    const node = new MemoryNode({
      id: 'test-id',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    expect(node.id).toBe('test-id');
    expect(node.kind).toBe('memory');
    expect(node.status).toBe('idle');
  });

  it('should return undefined when relevant check returns false', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [{ content: 'test' }] },
      broadcast: { content: 'new' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);
    vi.mocked(mockProvider.generate).mockResolvedValue('Should not be called');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
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
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
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
      curiosityGate: mockCuriosityGate,
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
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);

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
      curiosityGate: mockCuriosityGate,
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
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);

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
      curiosityGate: mockCuriosityGate,
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
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);
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
      curiosityGate: mockCuriosityGate,
    });

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
  });

  it('should update context with broadcast and response when relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'New broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
    vi.mocked(mockProvider.generate).mockResolvedValue('Node response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
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
      broadcast: { content: 'First broadcast' },
    };

    const broadcastMessage2: BroadcastMessage = {
      workingMemory: { messages: [] },
      broadcast: { content: 'Second broadcast' },
    };

    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
    vi.mocked(mockProvider.generate)
      .mockResolvedValueOnce('First response')
      .mockResolvedValueOnce('Second response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      curiosityGate: mockCuriosityGate,
    });

    await node.sendMessage(broadcastMessage1);
    await node.sendMessage(broadcastMessage2);

    expect(node.context).toBe(
      'Initial context\n\n[BROADCAST MESSAGE]:First broadcast[NODE RESPONSE]:First response\n\n[BROADCAST MESSAGE]:Second broadcast[NODE RESPONSE]:Second response',
    );
    expect(node.status).toBe('idle');
  });
});
