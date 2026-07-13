import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BestBroadcastDistiller } from './best-broadcast-distiller.js';
import type { Provider } from '../types/provider.js';

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

  it('returns an empty string without selecting when there are no broadcasts', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });

    await expect(
      distiller.distill({ workingMemory: { messages: [] }, broadcasts: [] }),
    ).resolves.toBe('');
    expect(mockProvider.selectBest).not.toHaveBeenCalled();
  });

  it('returns a sole broadcast unchanged without selecting', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    const broadcast = 'Ask tool-search to find the current source.';

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [broadcast],
      }),
    ).resolves.toBe(broadcast);
    expect(mockProvider.selectBest).not.toHaveBeenCalled();
  });

  it('selects and returns one original broadcast with its context', async () => {
    const distiller = new BestBroadcastDistiller({ provider: mockProvider });
    const selected = 'Ask tool-search to find the current source.';
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
        broadcasts: ['We should research this.', selected],
      }),
    ).resolves.toBe(selected);

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
      candidates: ['We should research this.', selected],
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
        broadcasts: ['First candidate', 'Second candidate'],
      }),
    ).rejects.toThrow('provider selected invalid candidate index 2');
  });
});
