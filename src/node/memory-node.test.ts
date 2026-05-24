import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryNode } from './memory-node.js';
import type { Provider } from '../types/provider.js';
import type { BroadcastMessage } from '../types/node.js';

describe('MemoryNode', () => {
  let mockProvider: Provider;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
    };
  });

  it('should create a memory node with the given props', () => {
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
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

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
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
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalledWith(
      expect.stringContaining(
        'Is your experience relevant to this new information?',
      ),
    );

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
    });

    await node.sendMessage(broadcastMessage);

    const askCall = vi.mocked(mockProvider.askYesNoQuestion).mock.calls[0]?.[0];
    expect(askCall).toBeDefined();
    expect(askCall).toContain('You are a single memory and processing node');
    expect(askCall).toContain('Specialized in test scenarios');
    expect(askCall).toContain('[NEW BROADCAST MESSAGE]:New broadcast');
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
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(result).toBeUndefined();
    expect(mockProvider.generate).not.toHaveBeenCalled();
    expect(node.status).toBe('idle');
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
    });

    await node.sendMessage(broadcastMessage1);
    await node.sendMessage(broadcastMessage2);

    expect(node.context).toBe(
      'Initial context\n\n[BROADCAST MESSAGE]:First broadcast[NODE RESPONSE]:First response\n\n[BROADCAST MESSAGE]:Second broadcast[NODE RESPONSE]:Second response',
    );
    expect(node.status).toBe('idle');
  });
});
