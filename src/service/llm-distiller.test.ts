import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { LlmDistiller } from './llm-distiller.js';
import type { Provider } from '../types/provider.js';
import type { WorkingMemory } from '../types/working-memory.js';

describe('LlmDistiller', () => {
  let mockProvider: Provider;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
  });

  it('should distill broadcasts into a new working memory entry', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });

    const workingMemory: WorkingMemory = {
      messages: [
        { role: 'working-memory', content: 'Previous insight 1' },
        { role: 'working-memory', content: 'Previous insight 2' },
      ],
    };

    const broadcasts = [
      'Node A has important information',
      'Node B adds supplementary data',
    ];

    vi.mocked(mockProvider.generate).mockResolvedValue(
      'New consolidated insight',
    );

    const result = await distiller.distill({ workingMemory, broadcasts });

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining(
        'consolidate a reasoning step into the next global workspace broadcast',
      ),
      messages: [
        { role: 'working-memory', content: expect.stringContaining('Node A') },
      ],
    });

    expect(result).toBe('New consolidated insight');
  });

  it('should include working memory in the user message', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = {
      messages: [{ role: 'working-memory', content: 'Test WM' }],
    };
    const broadcasts = [''];

    await distiller.distill({ workingMemory, broadcasts });

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.any(String),
      messages: [
        {
          role: 'working-memory',
          content: expect.stringContaining('Test WM'),
        },
      ],
    });
  });

  it('should include all broadcasts in the user message', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = { messages: [] };
    const broadcasts = ['A content', 'B content'];

    await distiller.distill({ workingMemory, broadcasts });

    const callArgs = (mockProvider.generate as Mock).mock.calls[0]![0] as {
      systemPrompt: string;
      messages: Array<{ content: string }>;
    };
    expect(callArgs.messages[0]?.content).toContain('[BROADCAST 0]: A content');
    expect(callArgs.messages[0]?.content).toContain('[BROADCAST 1]: B content');
  });

  it('should include afferent context in the user message', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = { messages: [] };

    await distiller.distill({
      workingMemory,
      broadcasts: ['Memory node can answer after acknowledging the user.'],
      afferentContext: [
        {
          role: 'user-input',
          content: 'Can you explain what you are doing?',
          originatingNodeId: 'sensor-user-input',
        },
        {
          role: 'afferent-capability',
          content:
            'Available afferent capabilities:\n- tool-search: can search the web.',
        },
      ],
    });

    const callArgs = (mockProvider.generate as Mock).mock.calls[0]![0] as {
      systemPrompt: string;
      messages: Array<{ content: string }>;
    };
    expect(callArgs.messages[0]?.content).toContain(
      '[USER INPUT 0 from sensor-user-input]: Can you explain what you are doing?',
    );
    expect(callArgs.messages[0]?.content).toContain(
      '[AFFERENT CAPABILITY 1]: Available afferent capabilities',
    );
  });

  it('should instruct the model to preserve user acknowledgements and tool callouts', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = { messages: [] };

    await distiller.distill({
      workingMemory,
      broadcasts: [
        'Acknowledge the user, then ask tool-search to search for current source material.',
      ],
    });

    const callArgs = (mockProvider.generate as Mock).mock.calls[0]![0] as {
      systemPrompt: string;
      messages: Array<{ content: string }>;
    };
    expect(callArgs.systemPrompt).toContain('acknowledge and address');
    expect(callArgs.systemPrompt).toContain('Preserve exact afferent node IDs');
    expect(callArgs.messages[0]?.content).toContain('tool-search');
  });

  it('should handle empty broadcasts', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = { messages: [] };

    vi.mocked(mockProvider.generate).mockResolvedValue('');

    const result = await distiller.distill({ workingMemory, broadcasts: [] });

    expect(result).toBe('');
  });

  it('should handle empty working memory', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = { messages: [] };
    const broadcasts = ['test'];

    vi.mocked(mockProvider.generate).mockResolvedValue('Result');

    await distiller.distill({ workingMemory, broadcasts });

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.any(String),
      messages: [
        {
          role: 'working-memory' as const,
          content: expect.stringContaining('Working memory:'),
        },
      ],
    });
  });
});
