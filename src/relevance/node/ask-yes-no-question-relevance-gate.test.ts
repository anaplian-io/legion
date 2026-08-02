import { describe, expect, it, vi } from 'vitest';
import { AskYesNoQuestionRelevanceGate } from './ask-yes-no-question-relevance-gate.js';
import type { Provider } from '../../types/provider.js';
import { TEST_NODE_TELEMETRY } from '../../telemetry/test-context.fixture.js';

describe('AskYesNoQuestionRelevanceGate', () => {
  const provider = (): Provider => ({
    askYesNoQuestion: vi.fn(),
    generate: vi.fn(),
    rankByRelevance: vi.fn(),
    selectBest: vi.fn(),
    splitString: vi.fn(),
    generateWithTools: vi.fn(),
  });

  it('delegates relevance to askYesNoQuestion', async () => {
    const mockProvider = provider();
    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(true);
    const gate = new AskYesNoQuestionRelevanceGate({
      provider: mockProvider,
      question: 'Is this useful?',
    });

    await expect(
      gate.isRelevant({
        broadcastMessage: {
          telemetry: TEST_NODE_TELEMETRY,
          workingMemory: {
            messages: [{ role: 'working-memory', content: 'Previous' }],
          },
          broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
        },
        nodeId: 'node-1',
        epochsAlive: 2,
        nodeContext: 'Node context',
      }),
    ).resolves.toBe(true);

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalledWith(
      {
        systemPrompt: 'Node context',
        messages: [
          { role: 'working-memory', content: 'Previous' },
          { role: 'broadcast', content: 'Broadcast' },
        ],
        question: 'Is this useful?',
      },
      expect.objectContaining({ stage: 'node-relevance' }),
    );
  });

  it('includes afferent context before the broadcast when present', async () => {
    const mockProvider = provider();
    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);
    const gate = new AskYesNoQuestionRelevanceGate({
      provider: mockProvider,
      question: 'Is this useful?',
    });

    await gate.isRelevant({
      broadcastMessage: {
        telemetry: TEST_NODE_TELEMETRY,
        workingMemory: {
          messages: [{ role: 'working-memory', content: 'Previous' }],
        },
        afferentContext: [{ role: 'afferent', content: 'Tool capability' }],
        broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
      },
      nodeId: 'node-1',
      epochsAlive: 2,
      nodeContext: 'Node context',
    });

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalledWith(
      {
        systemPrompt: 'Node context',
        messages: [
          { role: 'working-memory', content: 'Previous' },
          { role: 'afferent', content: 'Tool capability' },
          { role: 'broadcast', content: 'Broadcast' },
        ],
        question: 'Is this useful?',
      },
      expect.objectContaining({ stage: 'node-relevance' }),
    );
  });

  it('uses empty defaults when optional context is absent', async () => {
    const mockProvider = provider();
    vi.mocked(mockProvider.askYesNoQuestion).mockResolvedValue(false);
    const gate = new AskYesNoQuestionRelevanceGate({
      provider: mockProvider,
      question: 'Is this useful?',
    });

    await gate.isRelevant({
      broadcastMessage: {
        telemetry: TEST_NODE_TELEMETRY,
        workingMemory: { messages: [] },
        broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
      },
      nodeId: 'node-1',
      epochsAlive: 2,
    });

    expect(mockProvider.askYesNoQuestion).toHaveBeenCalledWith(
      {
        systemPrompt: '',
        messages: [{ role: 'broadcast', content: 'Broadcast' }],
        question: 'Is this useful?',
      },
      expect.objectContaining({ stage: 'node-relevance' }),
    );
  });
});
