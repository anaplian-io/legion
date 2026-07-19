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
    it('should send a Legion self-state assistant turn and return content', async () => {
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
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('You are a helpful assistant.'),
          }),
          {
            role: 'assistant',
            content:
              '[LEGION SELF STATE — PRIOR COLLECTIVE THOUGHT]\n[BROADCAST]\nHello, how are you?\n\n[WORKING MEMORY]\nI am doing well, thanks!',
          },
          {
            role: 'user',
            content:
              '[LEGION RUNTIME TICK — NOT HUMAN INPUT]\nProduce the next output for the collective, following the system instructions.',
          },
        ],
      });
      expect(
        mockClient.chat.completions.create.mock.calls[0]?.[0].messages[0]
          ?.content,
      ).toMatch(/^You are operating inside Legion/);
      expect(result).toBe('Hi there! I am a test response.');
    });

    it('should synthesize a runtime tick when no messages are provided', async () => {
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
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining(
              'Everything is in the system prompt.',
            ),
          }),
          {
            role: 'user',
            content:
              '[LEGION RUNTIME TICK — NOT HUMAN INPUT]\nProduce the next output for the collective, following the system instructions.',
          },
        ],
      });
      expect(result).toBe('Distilled output');
    });

    it('should expose structured action requests in self-state context', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion('Observed.'),
      );
      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await provider.generate({
        systemPrompt: 'Observe prior actions.',
        messages: [
          {
            role: 'working-memory',
            content: '',
            actionRequests: [
              {
                id: 'request-1',
                targetNodeId: 'clock',
                operation: 'read',
                arguments: {},
              },
            ],
          },
        ],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              content: expect.stringContaining(
                '[ACTION REQUEST request-1] target=clock operation=read',
              ),
            }),
          ]),
        }),
      );
    });

    it('should separate runtime context from actual user input', async () => {
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
          { role: 'user-input', content: 'User instruction' },
          { role: 'node-response', content: 'Memory node response' },
        ],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
        model: 'test-model',
        messages: [
          {
            role: 'system',
            content: expect.stringContaining('System instructions'),
          },
          {
            role: 'user',
            content:
              '[LEGION RUNTIME CONTEXT — NOT HUMAN INPUT]\n[AFFERENT]\nTool output\n\n[AFFERENT CAPABILITY]\nAvailable capability\n\n[NODE RESPONSE]\nMemory node response',
          },
          {
            role: 'user',
            content:
              '[LEGION RUNTIME TICK — NOT HUMAN INPUT]\nProduce the next output for the collective, following the system instructions.',
          },
          { role: 'user', content: '[USER INPUT]\nUser instruction' },
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

  describe('selectBest', () => {
    it('should select an in-range candidate index with context', async () => {
      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
        completion(JSON.stringify({ selectedIndex: 1 })),
      );

      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await expect(
        provider.selectBest({
          systemPrompt: 'Choose the concrete next action.',
          messages: [
            { role: 'working-memory', content: 'We need fresh information.' },
            { role: 'afferent', content: 'A tool returned old information.' },
          ],
          candidates: ['Generic response', 'Ask tool-search for fresh sources'],
        }),
      ).resolves.toBe(1);

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: expect.stringContaining(
                'Choose the concrete next action.',
              ),
            },
            {
              role: 'assistant',
              content:
                '[LEGION SELF STATE — PRIOR COLLECTIVE THOUGHT]\n[WORKING MEMORY]\nWe need fresh information.',
            },
            {
              role: 'user',
              content:
                '[LEGION RUNTIME CONTEXT — NOT HUMAN INPUT]\n[AFFERENT]\nA tool returned old information.',
            },
            {
              role: 'user',
              content:
                '[LEGION RUNTIME TICK — NOT HUMAN INPUT]\nProduce the next output for the collective, following the system instructions.',
            },
            {
              role: 'user',
              content:
                '[CANDIDATE SET — NOT HUMAN INPUT]\nCandidates:\n[CANDIDATE 0]: Generic response\n[CANDIDATE 1]: Ask tool-search for fresh sources',
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: expect.objectContaining({
              name: 'best_candidate_selection',
              strict: true,
              schema: expect.objectContaining({
                required: ['selectedIndex'],
              }),
            }),
          },
        }),
      );
    });

    it('should reject an empty candidate list before making a request', async () => {
      const provider = new OpenaiProvider({
        model: 'test-model',
        client: mockClient as unknown as OpenAI,
      });

      await expect(
        provider.selectBest({
          systemPrompt: 'Choose one.',
          messages: [],
          candidates: [],
        }),
      ).rejects.toThrow('requires at least one candidate');
      expect(mockClient.chat.completions.create).not.toHaveBeenCalled();
    });

    it.each([1.5, -1, 2])(
      'should reject an invalid selected index of %s',
      async (selectedIndex) => {
        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
          completion(JSON.stringify({ selectedIndex })),
        );

        const provider = new OpenaiProvider({
          model: 'test-model',
          client: mockClient as unknown as OpenAI,
        });

        await expect(
          provider.selectBest({
            systemPrompt: 'Choose one.',
            messages: [],
            candidates: ['First', 'Second'],
          }),
        ).rejects.toThrow('model selected invalid candidate index');
      },
    );
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
          {
            role: 'user-input' as const,
            content: 'User asked about this',
          },
        ],
        question: 'Is this relevant?',
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: expect.stringContaining('You are node 42.'),
            },
            {
              role: 'assistant',
              content:
                '[LEGION SELF STATE — PRIOR COLLECTIVE THOUGHT]\n[WORKING MEMORY]\nWorking memory snapshot',
            },
            {
              role: 'user',
              content:
                '[LEGION RUNTIME TICK — NOT HUMAN INPUT]\nProduce the next output for the collective, following the system instructions.',
            },
            {
              role: 'user',
              content: '[USER INPUT]\nUser asked about this',
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
            expect.objectContaining({
              role: 'assistant',
              content: expect.stringContaining('[LEGION SELF STATE'),
            }),
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
