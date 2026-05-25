import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmRelevanceFilter } from './llm-relevance-filter.js';
import type { Provider } from '../types/provider.js';
import type { AttentionGate } from '../types/attention-gate.js';
import type { WorkingMemory } from '../types/working-memory.js';
import type { Message } from '../types/message.js';

describe('LlmRelevanceFilter', () => {
  let mockProvider: Provider;
  let mockAttentionGate: AttentionGate;

  beforeEach(() => {
    mockProvider = {
      rankByRelevance: vi.fn(),
      generate: vi.fn(),
      askYesNoQuestion: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    mockAttentionGate = {
      getTopN: vi.fn(),
    };
  });

  it('should create a filter with the given props', () => {
    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    expect(typeof filter.filter).toBe('function');
  });

  it('should return all candidate messages when attentionGate returns "all"', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ content: 'Previous message' }],
    };
    const candidateMessages: Message[] = [
      { content: 'Candidate 1' },
      { content: 'Candidate 2' },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue('all');

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(mockProvider.rankByRelevance).not.toHaveBeenCalled();
    expect(result).toEqual(candidateMessages);
  });

  it('should filter candidate messages by relevance and apply attention gate', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ content: 'Context message' }],
    };
    const candidateMessages: Message[] = [
      { content: 'Most relevant message' },
      { content: 'Least relevant message' },
      { content: 'Medium relevant message' },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(2);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 2, 1]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '[MESSAGE 0]:Context message\n',
      [
        'Most relevant message',
        'Least relevant message',
        'Medium relevant message',
      ],
    );

    expect(result).toEqual([
      { content: 'Most relevant message' },
      { content: 'Medium relevant message' },
    ]);
  });

  it('should handle empty candidate messages', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ content: 'Context' }],
    };
    const candidateMessages: Message[] = [];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(5);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(result).toEqual([]);
  });

  it('should handle empty working memory', async () => {
    const workingMemory: WorkingMemory = {
      messages: [],
    };
    const candidateMessages: Message[] = [
      { content: 'Candidate 1' },
      { content: 'Candidate 2' },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith('', [
      'Candidate 1',
      'Candidate 2',
    ]);

    expect(result).toEqual([{ content: 'Candidate 1' }]);
  });

  it('should apply attention gate limit after relevance ranking', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ content: 'Context' }],
    };
    const candidateMessages: Message[] = [
      { content: 'A' },
      { content: 'B' },
      { content: 'C' },
      { content: 'D' },
      { content: 'E' },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(3);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1, 2, 3, 4]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { content: 'A' },
      { content: 'B' },
      { content: 'C' },
    ]);
  });

  it('should handle case where relevance ranking returns indices beyond candidate array', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ content: 'Context' }],
    };
    const candidateMessages: Message[] = [{ content: 'Only one' }];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(10);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 0, 1, 2]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(result).toEqual([{ content: 'Only one' }]);
  });
});
