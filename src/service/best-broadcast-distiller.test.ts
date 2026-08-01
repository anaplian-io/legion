import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BestBroadcastDistiller } from './best-broadcast-distiller.js';
import type { Provider } from '../types/provider.js';
import type { Message } from '../types/message.js';

const candidate = (content: string): Message => ({
  role: 'node-response',
  content,
});

describe('BestBroadcastDistiller', () => {
  let mockProvider: Provider;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      generateWithTools: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
    };
  });

  it('returns undefined without selecting when there are no broadcasts', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });

    await expect(
      distiller.distill({ workingMemory: { messages: [] }, broadcasts: [] }),
    ).resolves.toBeUndefined();
    expect(mockProvider.selectBest).not.toHaveBeenCalled();
  });

  it('returns a sole broadcast unchanged without selecting', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    const broadcast = candidate('Ask tool-search to find the current source.');

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [broadcast],
      }),
    ).resolves.toEqual({
      broadcast,
      supportingEvidence: [{ source: 'candidate', index: 0 }],
      goalDecision: {
        kind: 'unchanged',
        reason: 'Selection preserved no proposed goal transition.',
      },
    });
    expect(mockProvider.selectBest).not.toHaveBeenCalled();
  });

  it('selects and returns one original broadcast with its context', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    const selected = candidate('Ask tool-search to find the current source.');
    vi.mocked(mockProvider.selectBest).mockResolvedValue(1);

    await expect(
      distiller.distill({
        workingMemory: {
          messages: [
            { role: 'working-memory', content: 'We need current sources.' },
          ],
        },
        afferentContext: [
          {
            role: 'afferent-capability',
            content:
              'Available afferent capabilities:\n- tool-search: can search.',
          },
          { role: 'user-input', content: 'Please cite a current source.' },
        ],
        broadcasts: [candidate('We should research this.'), selected],
      }),
    ).resolves.toEqual({
      broadcast: selected,
      supportingEvidence: [{ source: 'candidate', index: 1 }],
      goalDecision: {
        kind: 'unchanged',
        reason: 'Selection preserved no proposed goal transition.',
      },
    });

    expect(mockProvider.selectBest).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining('available afferent node'),
      messages: [
        { role: 'working-memory', content: 'We need current sources.' },
        {
          role: 'afferent-capability',
          content:
            'Available afferent capabilities:\n- tool-search: can search.',
        },
        { role: 'user-input', content: 'Please cite a current source.' },
      ],
      candidates: ['We should research this.', selected.content],
    });
    expect(
      vi.mocked(mockProvider.selectBest).mock.calls[0]?.[0].systemPrompt,
    ).toContain('specific facts, decisions, constraints, and next actions');
    expect(
      vi.mocked(mockProvider.selectBest).mock.calls[0]?.[0].systemPrompt,
    ).toContain('Use brevity only to break ties');
  });

  it('rejects an invalid selected index instead of returning a different broadcast', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    vi.mocked(mockProvider.selectBest).mockResolvedValue(2);

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [
          candidate('First candidate'),
          candidate('Second candidate'),
        ],
      }),
    ).rejects.toThrow('provider selected invalid candidate index 2');
  });

  it('preserves structured action requests and exposes them during selection', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    const selected = {
      ...candidate('Inspect the workspace.'),
      actionRequests: [
        {
          id: 'request-1',
          targetNodeId: 'tool-files',
          intent: 'List the workspace directory.',
          operation: 'list_directory',
          arguments: { path: '.' },
        },
      ],
    };
    vi.mocked(mockProvider.selectBest).mockResolvedValue(1);

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [candidate('Wait.'), selected],
      }),
    ).resolves.toEqual({
      broadcast: selected,
      supportingEvidence: [{ source: 'candidate', index: 1 }],
      goalDecision: {
        kind: 'unchanged',
        reason: 'Selection preserved no proposed goal transition.',
      },
    });
    expect(mockProvider.selectBest).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          'Wait.',
          expect.stringContaining(
            'target=tool-files intent="List the workspace directory." operationHint=list_directory',
          ),
        ],
      }),
    );
  });

  it('uses the active goal during selection and preserves a selected goal decision', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    const selected = {
      ...candidate('Continue the active investigation.'),
      goalDecision: {
        kind: 'unchanged' as const,
        reason: 'The active goal is still appropriate.',
      },
    };
    vi.mocked(mockProvider.selectBest).mockResolvedValue(1);

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [candidate('Change topics.'), selected],
        activeGoal: {
          id: 'goal-1',
          objective: 'Understand the workspace',
          successCriteria: 'Publish an evidence-backed summary',
          origin: 'user',
          revision: 1,
        },
      }),
    ).resolves.toEqual({
      broadcast: selected,
      supportingEvidence: [{ source: 'candidate', index: 1 }],
      goalDecision: selected.goalDecision,
    });
    expect(
      vi.mocked(mockProvider.selectBest).mock.calls[0]?.[0].systemPrompt,
    ).toContain('ID: goal-1');
  });
});
