import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OpenaiProvider } from './openai-provider.js';
import { OpenAI } from 'openai';
import { ChatCompletion } from 'openai/resources/chat/completions';

/** Build a minimal ChatCompletion with a single choice. */
const completion = (
  content: string | null,
  toolCalls?: unknown[],
): ChatCompletion =>
  ({
    choices: [
      {
        message: {
          content,
          ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
  }) as unknown as ChatCompletion;

const noChoices = (): ChatCompletion =>
  ({ choices: [] }) as unknown as ChatCompletion;

describe('OpenaiProvider', () => {
  let mockClient: { chat: { completions: { create: Mock } } };

  beforeEach(() => {
    mockClient = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };
  });

  it('should create a provider with the given props', () => {
    const provider = new OpenaiProvider({
      model: 'test-model',
      client: mockClient as unknown as OpenAI,
    });

    expect(typeof provider.generate).toBe('function');
  });

  describe('generate', () => {
    it('should send system + user messages and return content', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('Hi there! I am a test response.'),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generate({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'broadcast' as const, content: 'Hello, how are you?' },
          {
            role: 'working-memory' as const,
            content: 'I am doing well, thanks!',
          },
        ],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: '[BROADCAST]\nHello, how are you?' },
          {
            role: 'user',
            content: '[WORKING MEMORY]\nI am doing well, thanks!',
          },
        ],
      });
      expect(result).toBe('Hi there! I am a test response.');
    });

    it('should synthesize a user turn when no messages are provided', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('Distilled output'),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generate({
        systemPrompt: 'Everything is in the system prompt.',
        messages: [],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'Everything is in the system prompt.' },
          {
            role: 'user',
            content:
              'Produce the output now, following the instructions above.',
          },
        ],
      });
      expect(result).toBe('Distilled output');
    });

    it('should label non-broadcast Legion message roles as user context', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('ok'),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await provider.generate({
        systemPrompt: 'System instructions',
        messages: [
          { role: 'afferent', content: 'Tool output' },
          {
            role: 'afferent-capability',
            content: 'Available capability',
          },
          { role: 'node-response', content: 'Memory node response' },
        ],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'System instructions' },
          { role: 'user', content: '[AFFERENT]\nTool output' },
          {
            role: 'user',
            content: '[AFFERENT CAPABILITY]\nAvailable capability',
          },
          {
            role: 'user',
            content: '[NODE RESPONSE]\nMemory node response',
          },
        ],
      });
    });

    it('should return empty string when there are no choices', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        noChoices(),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generate({
        systemPrompt: 'test',
        messages: [{ role: 'broadcast' as const, content: 'test' }],
      });

      expect(result).toBe('');
    });

    it('should return empty string when message content is null', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(null),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generate({
        systemPrompt: 'test',
        messages: [{ role: 'broadcast' as const, content: 'test' }],
      });

      expect(result).toBe('');
    });
  });

  describe('rankByRelevance', () => {
    it('should rank items by relevance and return indices', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(JSON.stringify({ rankedIndices: [0, 2, 1] })),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.rankByRelevance('fruit', [
        'apple',
        'carrot',
        'banana',
      ]);

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          temperature: 0,
          messages: [
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('fruit'),
            }),
          ],
          response_format: {
            type: 'json_schema',
            json_schema: expect.objectContaining({
              name: 'ranking',
              strict: true,
              schema: expect.objectContaining({
                required: ['rankedIndices'],
              }),
            }),
          },
        }),
      );
      expect(result).toEqual([0, 2, 1]);
    });
  });

  describe('askYesNoQuestion', () => {
    it('should return true and include the cacheable prefix, messages, and question', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(JSON.stringify({ answer: true })),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.askYesNoQuestion({
        systemPrompt: 'You are node 42.',
        messages: [
          {
            role: 'working-memory' as const,
            content: 'Working memory snapshot',
          },
        ],
        question: 'Is this relevant?',
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
          messages: [
            { role: 'system', content: 'You are node 42.' },
            {
              role: 'user',
              content: '[WORKING MEMORY]\nWorking memory snapshot',
            },
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Is this relevant?'),
            }),
          ],
          response_format: {
            type: 'json_schema',
            json_schema: expect.objectContaining({ name: 'yes_no_answer' }),
          },
        }),
      );
      expect(result).toBe(true);
    });

    it('should return false for no answers', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(JSON.stringify({ answer: false })),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.askYesNoQuestion({
        systemPrompt: 'sys',
        messages: [],
        question: 'Is this a test?',
      });

      expect(result).toBe(false);
    });

    it('throws a descriptive error when the model returns no output', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(null),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await expect(
        provider.askYesNoQuestion({
          systemPrompt: 'sys',
          messages: [],
          question: 'Is this a test?',
        }),
      ).rejects.toThrow('askYesNoQuestion');
    });

    it('throws a descriptive error when the output is not valid JSON', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('not json at all'),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await expect(
        provider.askYesNoQuestion({
          systemPrompt: 'sys',
          messages: [],
          question: 'Is this a test?',
        }),
      ).rejects.toThrow('failed to parse structured output');
    });
  });

  describe('splitString', () => {
    it('should split content into two parts', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(JSON.stringify({ left: 'A', right: 'B' })),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.splitString('test content');

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: expect.objectContaining({ name: 'split_output' }),
          },
        }),
      );
      expect(result).toEqual(['A', 'B']);
    });
  });

  describe('generateWithTools', () => {
    it('should map tools (strict when eligible) and return function tool calls', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(null, [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"San Francisco"}',
            },
          },
        ]),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generateWithTools({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'broadcast' as const, content: 'What is the weather?' },
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather',
            // Strict-eligible: additionalProperties:false + all props required.
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
              additionalProperties: false,
            },
          },
        ],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: 'required',
          messages: [
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get current weather',
                parameters: expect.any(Object),
                strict: true,
              },
            },
          ],
        }),
      );
      expect(result.content).toBe('');
      expect(result.toolCalls).toEqual([
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location":"San Francisco"}',
          },
        },
      ]);
    });

    it('should omit description and disable strict for a non-compliant tool, and return no tool calls', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('Response without tools'),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generateWithTools({
        systemPrompt: 'You are a helpful assistant.',
        messages: [{ role: 'broadcast' as const, content: 'Hello!' }],
        tools: [
          {
            name: 'minimal_tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      const sentTool =
        mockClient.chat.completions.create.mock.calls[0]![0].tools[0];
      expect(sentTool.function.name).toBe('minimal_tool');
      expect(sentTool.function).not.toHaveProperty('description');
      expect(sentTool.function.strict).toBe(false);
      expect(result.content).toBe('Response without tools');
      expect(result.toolCalls).toBeUndefined();
    });

    it('should return undefined tool calls when there are no choices', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        noChoices(),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generateWithTools({
        systemPrompt: 'You are a helpful assistant.',
        messages: [{ role: 'broadcast' as const, content: 'Hello!' }],
        tools: [],
      });

      expect(result.content).toBe('');
      expect(result.toolCalls).toBeUndefined();
    });

    it('should ignore non-function (custom) tool calls', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('', [
          {
            id: 'call_custom',
            type: 'custom',
            custom: { name: 'do_thing', input: 'payload' },
          },
        ]),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      const result = await provider.generateWithTools({
        systemPrompt: 'You are a helpful assistant.',
        messages: [{ role: 'broadcast' as const, content: 'Hello!' }],
        tools: [],
      });

      expect(result.toolCalls).toBeUndefined();
    });
  });
});
