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
      messages: [
        { role: 'working-memory' as const, content: 'Previous message' },
      ],
    };
    const candidateMessages: Message[] = [
      { role: 'node-response' as const, content: 'Candidate 1' },
      { role: 'node-response' as const, content: 'Candidate 2' },
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
      messages: [
        { role: 'working-memory' as const, content: 'Context message' },
      ],
    };
    const candidateMessages: Message[] = [
      { role: 'node-response' as const, content: 'Most relevant message' },
      { role: 'node-response' as const, content: 'Least relevant message' },
      { role: 'node-response' as const, content: 'Medium relevant message' },
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
      { role: 'node-response' as const, content: 'Most relevant message' },
      { role: 'node-response' as const, content: 'Medium relevant message' },
    ]);
  });

  it('should concatenate multi-message working memory without stray separators', async () => {
    const workingMemory: WorkingMemory = {
      messages: [
        { role: 'working-memory', content: 'First context' },
        { role: 'working-memory', content: 'Second context' },
      ],
    };
    const candidateMessages: Message[] = [
      { role: 'node-response' as const, content: 'Candidate 1' },
      { role: 'node-response' as const, content: 'Candidate 2' },
      { role: 'node-response' as const, content: 'Candidate 3' },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1, 2]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    await filter.filter(workingMemory, candidateMessages);

    // Regression: bare .join() inserted a comma between the per-message
    // entries; the concept string must concatenate them cleanly.
    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '[MESSAGE 0]:First context\n[MESSAGE 1]:Second context\n',
      ['Candidate 1', 'Candidate 2', 'Candidate 3'],
    );
  });

  it('should handle empty candidate messages', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Context' }],
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
      { role: 'node-response' as const, content: 'Candidate 1' },
      { role: 'node-response' as const, content: 'Candidate 2' },
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

    expect(result).toEqual([
      { role: 'node-response' as const, content: 'Candidate 1' },
    ]);
  });

  it('should apply attention gate limit after relevance ranking', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Context' }],
    };
    const candidateMessages: Message[] = [
      { role: 'node-response' as const, content: 'A' },
      { role: 'node-response' as const, content: 'B' },
      { role: 'node-response' as const, content: 'C' },
      { role: 'node-response' as const, content: 'D' },
      { role: 'node-response' as const, content: 'E' },
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
      { role: 'node-response' as const, content: 'A' },
      { role: 'node-response' as const, content: 'B' },
      { role: 'node-response' as const, content: 'C' },
    ]);
  });

  it('should handle case where relevance ranking returns indices beyond candidate array', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Context' }],
    };
    const candidateMessages: Message[] = [
      { role: 'node-response' as const, content: 'Only one' },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(10);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 0, 1, 2]);

    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(workingMemory, candidateMessages);

    expect(result).toEqual([
      { role: 'node-response' as const, content: 'Only one' },
    ]);
  });
});
