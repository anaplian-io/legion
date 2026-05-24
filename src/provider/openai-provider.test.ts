import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OpenaiProvider } from './openai-provider.js';
import { OpenAI } from 'openai';

describe('OpenaiProvider', () => {
  let mockClient: { responses: { create: Mock } };

  beforeEach(() => {
    mockClient = {
      responses: {
        create: vi.fn(),
      },
    };
  });

  it('should create a provider with the given props', async () => {
    const provider = new OpenaiProvider({
      model: 'test-model',
      client: mockClient as unknown as OpenAI,
    });

    expect(typeof provider.generate).toBe('function');
  });

  it('should call responses.create with correct input including system prompt', async () => {
    const props = {
      systemPrompt: 'You are a helpful assistant.',
      messages: [
        { content: 'Hello, how are you?' },
        { content: 'I am doing well, thanks!' },
      ],
    };

    const responseText = 'Hi there! I am a test response.';

    vi.mocked(mockClient.responses.create).mockResolvedValue({
      output_text: responseText,
    });

    const provider = new OpenaiProvider({
      model: 'test-model',
      client: mockClient as unknown as OpenAI,
    });

    const result = await provider.generate(props);

    expect(mockClient.responses.create).toHaveBeenCalledWith({
      model: 'test-model',
      input: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'user', content: 'I am doing well, thanks!' },
      ],
    });

    expect(result).toBe(responseText);
  });

  it('should return empty string when response has no output_text', async () => {
    vi.mocked(mockClient.responses.create).mockResolvedValue({
      output_text: null,
    });

    const provider = new OpenaiProvider({
      model: 'test-model',
      client: mockClient as unknown as OpenAI,
    });

    const result = await provider.generate({
      systemPrompt: 'test',
      messages: [{ content: 'test' }],
    });

    expect(result).toBe('');
  });

  it('should handle single message input', async () => {
    vi.mocked(mockClient.responses.create).mockResolvedValue({
      output_text: 'Single message response',
    });

    const provider = new OpenaiProvider({
      model: 'test-model',
      client: mockClient as unknown as OpenAI,
    });

    const result = await provider.generate({
      systemPrompt: 'System prompt',
      messages: [{ content: 'Only one message' }],
    });

    expect(mockClient.responses.create).toHaveBeenCalledWith({
      model: 'test-model',
      input: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Only one message' },
      ],
    });

    expect(result).toBe('Single message response');
  });

  describe('rankByRelevance', () => {
    it('should rank items by relevance and return indices', async () => {
      const concept = 'fruit';
      const items = ['apple', 'carrot', 'banana'];

      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ rankedIndices: [0, 2, 1] }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.rankByRelevance(concept, items);

      expect(mockClient.responses.create).toHaveBeenCalledWith({
        model: 'test-model',
        temperature: 0,
        input: expect.stringContaining('fruit'),
        text: {
          format: {
            type: 'json_schema',
            name: 'ranking',
            schema: expect.objectContaining({
              properties: { rankedIndices: expect.any(Object) },
              required: ['rankedIndices'],
            }),
          },
        },
      });

      expect(result).toEqual([0, 2, 1]);
    });

    it('should handle empty items array', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ rankedIndices: [] }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.rankByRelevance('concept', []);

      expect(result).toEqual([]);
    });

    it('should handle single item array', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ rankedIndices: [0] }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.rankByRelevance('concept', ['only item']);

      expect(result).toEqual([0]);
    });

    it('should use correct temperature (0) for deterministic ranking', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ rankedIndices: [1, 0] }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await provider.rankByRelevance('test', ['a', 'b']);

      expect(mockClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        }),
      );
    });
  });

  describe('askYesNoQuestion', () => {
    it('should return true for yes answers', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ answer: true }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.askYesNoQuestion('Is this a test?');

      expect(mockClient.responses.create).toHaveBeenCalledWith({
        model: 'test-model',
        temperature: 0,
        input: expect.stringContaining('Is this a test?'),
        text: {
          format: {
            type: 'json_schema',
            name: 'yes_no_answer',
            schema: expect.objectContaining({
              properties: { answer: expect.any(Object) },
              required: ['answer'],
            }),
          },
        },
      });

      expect(result).toBe(true);
    });

    it('should return false for no answers', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ answer: false }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.askYesNoQuestion('Is this a test?');

      expect(result).toBe(false);
    });

    it('should use correct temperature (0) for deterministic yes/no answers', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ answer: true }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await provider.askYesNoQuestion('Test question');

      expect(mockClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        }),
      );
    });

    it('should use correct temperature (0) for deterministic string splitting', async () => {
      vi.mocked(mockClient.responses.create).mockResolvedValue({
        output_text: JSON.stringify({ left: 'A', right: 'B' }),
      });

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await provider.splitString('test');

      expect(mockClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        }),
      );
    });
  });
});
