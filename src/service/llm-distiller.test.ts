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
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
  });

  it('should distill broadcasts into a new working memory entry', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });

    const workingMemory: WorkingMemory = {
      messages: [
        { content: 'Previous insight 1' },
        { content: 'Previous insight 2' },
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
        'consolidate a reasoning step into one line of working memory',
      ),
      messages: [{ content: expect.stringContaining('Node A') }],
    });

    expect(result).toBe('New consolidated insight');
  });

  it('should include working memory in the user message', async () => {
    const distiller = new LlmDistiller({ provider: mockProvider });
    const workingMemory: WorkingMemory = { messages: [{ content: 'Test WM' }] };
    const broadcasts = [''];

    await distiller.distill({ workingMemory, broadcasts });

    expect(mockProvider.generate).toHaveBeenCalledWith({
      systemPrompt: expect.any(String),
      messages: [{ content: expect.stringContaining('Test WM') }],
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
      messages: [{ content: expect.stringContaining('Working memory:') }],
    });
  });
});
