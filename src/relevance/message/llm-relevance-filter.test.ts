import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmRelevanceFilter } from './llm-relevance-filter.js';
import type { Provider } from '../../types/provider.js';
import type { AttentionGate } from '../../types/attention-gate.js';
import type { WorkingMemory } from '../../types/working-memory.js';
import type { CandidateMessage } from '../../types/message.js';
import {
  createTestTelemetry,
  TEST_EPOCH_TELEMETRY,
} from '../../telemetry/test-context.fixture.js';
import type { TelemetryEvent } from '../../types/telemetry.js';

describe('LlmRelevanceFilter', () => {
  let mockProvider: Provider;
  let mockAttentionGate: AttentionGate;
  const telemetry = createTestTelemetry();

  beforeEach(() => {
    mockProvider = {
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
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
      telemetry,
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
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 1',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 2',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue('all');

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(
      workingMemory,
      candidateMessages,
      TEST_EPOCH_TELEMETRY,
    );

    expect(mockProvider.rankByRelevance).not.toHaveBeenCalled();
    expect(result).toEqual(candidateMessages);
  });

  it('should filter candidate messages by relevance and apply attention gate', async () => {
    const workingMemory: WorkingMemory = {
      messages: [
        { role: 'working-memory' as const, content: 'Context message' },
      ],
    };
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Most relevant message',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Least relevant message',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Medium relevant message',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(2);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 2, 1]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(
      workingMemory,
      candidateMessages,
      TEST_EPOCH_TELEMETRY,
    );

    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '[MESSAGE 0]:Context message\n',
      [
        'Most relevant message',
        'Least relevant message',
        'Medium relevant message',
      ],
      expect.objectContaining({ stage: 'attention-ranking' }),
    );

    expect(result).toEqual([
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Most relevant message',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Medium relevant message',
      },
    ]);
  });

  it('includes structured action requests in candidate ranking', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory', content: 'Need the current time' }],
    };
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response',
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'I will check.',
        actionRequests: [
          {
            id: 'request-1',
            targetNodeId: 'current-time',
            intent: 'Read the current time in UTC.',
            operation: 'read',
            arguments: { timezone: 'UTC' },
          },
        ],
      },
      {
        role: 'node-response',
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Unrelated candidate',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    await filter.filter(workingMemory, candidateMessages, TEST_EPOCH_TELEMETRY);

    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '[MESSAGE 0]:Need the current time\n',
      [
        'I will check.\n[ACTION REQUEST request-1] target=current-time intent="Read the current time in UTC." operationHint=read argumentsHint={"timezone":"UTC"}',
        'Unrelated candidate',
      ],
      expect.objectContaining({ stage: 'attention-ranking' }),
    );
  });

  it('includes historical action-only broadcasts in the working-memory concept', async () => {
    const workingMemory: WorkingMemory = {
      messages: [
        {
          role: 'working-memory',
          content: '',
          actionRequests: [
            {
              id: 'historical-request',
              targetNodeId: 'clock',
              intent: 'Read the current time.',
              operation: 'read',
              arguments: {},
            },
          ],
        },
      ],
    };
    const candidates = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'A',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'B',
      },
    ];
    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1]);
    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    await filter.filter(workingMemory, candidates, TEST_EPOCH_TELEMETRY);

    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '[MESSAGE 0]:[ACTION REQUEST historical-request] target=clock intent="Read the current time." operationHint=read argumentsHint={}\n',
      ['A', 'B'],
      expect.objectContaining({ stage: 'attention-ranking' }),
    );
  });

  it('should concatenate multi-message working memory without stray separators', async () => {
    const workingMemory: WorkingMemory = {
      messages: [
        { role: 'working-memory', content: 'First context' },
        { role: 'working-memory', content: 'Second context' },
      ],
    };
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 1',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 2',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 3',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1, 2]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    await filter.filter(workingMemory, candidateMessages, TEST_EPOCH_TELEMETRY);

    // Regression: bare .join() inserted a comma between the per-message
    // entries; the concept string must concatenate them cleanly.
    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '[MESSAGE 0]:First context\n[MESSAGE 1]:Second context\n',
      ['Candidate 1', 'Candidate 2', 'Candidate 3'],
      expect.objectContaining({ stage: 'attention-ranking' }),
    );
  });

  it('should handle empty candidate messages', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Context' }],
    };
    const candidateMessages: CandidateMessage[] = [];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(5);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(
      workingMemory,
      candidateMessages,
      TEST_EPOCH_TELEMETRY,
    );

    expect(result).toEqual([]);
  });

  it('should handle empty working memory', async () => {
    const workingMemory: WorkingMemory = {
      messages: [],
    };
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 1',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 2',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(
      workingMemory,
      candidateMessages,
      TEST_EPOCH_TELEMETRY,
    );

    expect(mockProvider.rankByRelevance).toHaveBeenCalledWith(
      '',
      ['Candidate 1', 'Candidate 2'],
      expect.objectContaining({ stage: 'attention-ranking' }),
    );

    expect(result).toEqual([
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Candidate 1',
      },
    ]);
  });

  it('should apply attention gate limit after relevance ranking', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Context' }],
    };
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'A',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'B',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'C',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'D',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'E',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(3);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 1, 2, 3, 4]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(
      workingMemory,
      candidateMessages,
      TEST_EPOCH_TELEMETRY,
    );

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'A',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'B',
      },
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'C',
      },
    ]);
  });

  it('should handle case where relevance ranking returns indices beyond candidate array', async () => {
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Context' }],
    };
    const candidateMessages: CandidateMessage[] = [
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Only one',
      },
    ];

    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(10);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0, 0, 1, 2]);

    const filter = new LlmRelevanceFilter({
      telemetry,
      provider: mockProvider,
      attentionGate: mockAttentionGate,
    });

    const result = await filter.filter(
      workingMemory,
      candidateMessages,
      TEST_EPOCH_TELEMETRY,
    );

    expect(result).toEqual([
      {
        role: 'node-response' as const,
        originatingNodeId: 'node-test',
        candidateId: 'candidate-test',
        content: 'Only one',
      },
    ]);
  });

  it('records a failed relevance operation before rethrowing', async () => {
    const failureTelemetry = createTestTelemetry();
    const events: TelemetryEvent[] = [];
    failureTelemetry.subscribe((event) => events.push(event));
    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockRejectedValue(
      new TypeError('ranking failed'),
    );
    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
      telemetry: failureTelemetry,
    });

    await expect(
      filter.filter(
        { messages: [] },
        [
          {
            role: 'node-response',
            content: 'First',
            originatingNodeId: 'memory-1',
            candidateId: 'candidate-1',
          },
          {
            role: 'node-response',
            content: 'Second',
            originatingNodeId: 'memory-2',
            candidateId: 'candidate-2',
          },
        ],
        TEST_EPOCH_TELEMETRY,
      ),
    ).rejects.toThrow('ranking failed');
    expect(events[0]).toMatchObject({
      event: 'relevance.completed',
      spanId: expect.any(String),
      data: {
        outcome: 'failure',
        errorCategory: 'TypeError',
        rankedCandidateIds: [],
        survivorCandidateIds: [],
      },
    });
  });

  it('records an incomplete provider ranking as a failed relevance operation', async () => {
    const failureTelemetry = createTestTelemetry();
    const events: TelemetryEvent[] = [];
    failureTelemetry.subscribe((event) => events.push(event));
    vi.mocked(mockAttentionGate.getTopN).mockResolvedValue(1);
    vi.mocked(mockProvider.rankByRelevance).mockResolvedValue([0]);
    const filter = new LlmRelevanceFilter({
      provider: mockProvider,
      attentionGate: mockAttentionGate,
      telemetry: failureTelemetry,
    });

    await expect(
      filter.filter(
        { messages: [] },
        [
          {
            role: 'node-response',
            content: 'First',
            originatingNodeId: 'memory-1',
            candidateId: 'candidate-1',
          },
          {
            role: 'node-response',
            content: 'Second',
            originatingNodeId: 'memory-2',
            candidateId: 'candidate-2',
          },
        ],
        TEST_EPOCH_TELEMETRY,
      ),
    ).rejects.toThrow('expected 2 ranked indices');
    expect(events[0]).toMatchObject({
      event: 'relevance.completed',
      data: { outcome: 'failure', errorCategory: 'Error' },
    });
  });
});
