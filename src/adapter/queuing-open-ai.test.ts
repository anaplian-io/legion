import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { QueuingOpenAi } from './queuing-open-ai.js';
import { OpenAI } from 'openai';
import { ChatCompletion } from 'openai/resources/chat/completions';
import RequestOptions = OpenAI.RequestOptions;

const chatCompletion = (id: string): ChatCompletion =>
  ({ id, choices: [] }) as unknown as ChatCompletion;

describe('QueuingOpenAi', () => {
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

  it('should create a QueuingOpenAi instance with the given props', () => {
    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 2,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    expect(typeof queuingClient.chat.completions.create).toBe('function');
  });

  it('should queue requests and respect concurrency limit', async () => {
    let activeRequests = 0;
    let maxConcurrent = 0;

    mockClient.chat.completions.create.mockImplementation(() => {
      activeRequests++;
      maxConcurrent = Math.max(maxConcurrent, activeRequests);
      return new Promise<ChatCompletion>((resolve) => {
        setTimeout(() => {
          activeRequests--;
          resolve(chatCompletion('test'));
        }, 100);
      });
    });

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 2,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    const promises = Array.from({ length: 4 }, () =>
      queuingClient.chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      }),
    );

    await Promise.all(promises);

    expect(maxConcurrent).toBe(2);
  });

  it('should return correct response from queued request', async () => {
    const expectedResponse = chatCompletion('hello-from-queue');

    vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
      expectedResponse,
    );

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    const result = await queuingClient.chat.completions.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result).toBe(expectedResponse);
  });

  it('should pass through options parameter to client', async () => {
    vi.mocked(mockClient.chat.completions.create).mockResolvedValue(
      chatCompletion('with-options'),
    );

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    const options = { timeout: 5000 } as RequestOptions;

    await queuingClient.chat.completions.create(
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      },
      options,
    );

    // Options are forwarded with an AbortSignal merged in so the overall
    // timeout can cancel the in-flight request.
    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: 5000,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('should retry on failure and eventually succeed', async () => {
    const expectedResponse = chatCompletion('success-after-retries');

    vi.mocked(mockClient.chat.completions.create)
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce(expectedResponse);

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 2, minTimeout: 0 },
      totalTimeout: 1000,
    });

    const result = await queuingClient.chat.completions.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result).toBe(expectedResponse);
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries and throw error', async () => {
    vi.mocked(mockClient.chat.completions.create).mockRejectedValue(
      new Error('persistent error'),
    );

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 2, minTimeout: 0 },
      totalTimeout: 1000,
    });

    await expect(
      queuingClient.chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow('persistent error');

    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it('should timeout if operation exceeds totalTimeout', async () => {
    vi.mocked(mockClient.chat.completions.create).mockImplementation(() => {
      return new Promise<ChatCompletion>((resolve) => {
        setTimeout(() => resolve(chatCompletion('too-late')), 1000);
      });
    });

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 100,
    });

    await expect(
      queuingClient.chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow();
  });

  it('should release concurrency slot immediately after timeout', async () => {
    vi.mocked(mockClient.chat.completions.create).mockImplementation(() => {
      return new Promise<ChatCompletion>((resolve) => {
        setTimeout(() => resolve(chatCompletion('done')), 1000);
      });
    });

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 100,
    });

    try {
      await queuingClient.chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      });
      throw new Error('Should have timed out');
    } catch (e) {
      expect((e as Error).name).toMatch(/TimeoutError/);
    }

    const startTime = Date.now();

    vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce(
      chatCompletion('second'),
    );

    await queuingClient.chat.completions.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
    });

    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(500);
  });
});
