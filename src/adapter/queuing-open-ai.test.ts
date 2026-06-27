import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { QueuingOpenAi } from './queuing-open-ai.js';
import { OpenAI } from 'openai';
import RequestOptions = OpenAI.RequestOptions;

describe('QueuingOpenAi', () => {
  let mockClient: { responses: { create: Mock } };

  beforeEach(() => {
    mockClient = {
      responses: {
        create: vi.fn(),
      },
    };
  });

  it('should create a QueuingOpenAi instance with the given props', async () => {
    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 2,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    expect(typeof queuingClient.responses.create).toBe('function');
  });

  it('should queue requests and respect concurrency limit', async () => {
    let activeRequests = 0;
    let maxConcurrent = 0;

    mockClient.responses.create.mockImplementation(() => {
      activeRequests++;
      maxConcurrent = Math.max(maxConcurrent, activeRequests);
      return new Promise<import('openai/resources').Responses.Response>(
        (resolve) => {
          setTimeout(() => {
            activeRequests--;
            resolve({
              output_text: 'test response',
            } as import('openai/resources').Responses.Response);
          }, 100);
        },
      );
    });

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 2,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    // Make 4 concurrent requests
    const promises = Array.from({ length: 4 }, () =>
      queuingClient.responses.create({
        model: 'test-model',
        input: [{ role: 'user', content: 'test' }],
      }),
    );

    await Promise.all(promises);

    // Should never exceed maxParallelism of 2
    expect(maxConcurrent).toBe(2);
  });

  it('should return correct response from queued request', async () => {
    const expectedResponse = {
      output_text: 'Hello from queue!',
    } as import('openai/resources').Responses.Response;

    vi.mocked(mockClient.responses.create).mockResolvedValue(expectedResponse);

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    const result = await queuingClient.responses.create({
      model: 'test-model',
      input: [{ role: 'user', content: 'test' }],
    });

    expect(result).toBe(expectedResponse);
  });

  it('should pass through options parameter to client', async () => {
    const mockResponse = {
      output_text: 'response with options',
    } as import('openai/resources').Responses.Response;

    vi.mocked(mockClient.responses.create).mockResolvedValue(mockResponse);

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 1000,
    });

    const options = { timeout: 5000 } as RequestOptions;

    await queuingClient.responses.create(
      {
        model: 'test-model',
        input: [{ role: 'user', content: 'test' }],
      },
      options,
    );

    // Options are forwarded with an AbortSignal merged in so the overall
    // timeout can cancel the in-flight request.
    expect(mockClient.responses.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: 5000,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('should retry on failure and eventually succeed', async () => {
    const expectedResponse = {
      output_text: 'success after retries!',
    } as import('openai/resources').Responses.Response;

    vi.mocked(mockClient.responses.create)
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce(expectedResponse);

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 2, minTimeout: 0 },
      totalTimeout: 1000,
    });

    const result = await queuingClient.responses.create({
      model: 'test-model',
      input: [{ role: 'user', content: 'test' }],
    });

    expect(result).toBe(expectedResponse);
    expect(mockClient.responses.create).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries and throw error', async () => {
    vi.mocked(mockClient.responses.create).mockRejectedValue(
      new Error('persistent error'),
    );

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 2, minTimeout: 0 },
      totalTimeout: 1000,
    });

    await expect(
      queuingClient.responses.create({
        model: 'test-model',
        input: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow('persistent error');

    expect(mockClient.responses.create).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should timeout if operation exceeds totalTimeout', async () => {
    // Mock a very slow response
    vi.mocked(mockClient.responses.create).mockImplementation(() => {
      return new Promise<import('openai/resources').Responses.Response>(
        (resolve) => {
          setTimeout(
            () =>
              resolve({
                output_text: 'too late',
              } as import('openai/resources').Responses.Response),
            1000,
          );
        },
      );
    });

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 100, // Very short timeout
    });

    await expect(
      queuingClient.responses.create({
        model: 'test-model',
        input: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow();
  });

  it('should release concurrency slot immediately after timeout', async () => {
    vi.mocked(mockClient.responses.create).mockImplementation(() => {
      return new Promise<import('openai/resources').Responses.Response>(
        (resolve) => {
          setTimeout(() => {
            resolve({
              output_text: 'done',
            } as import('openai/resources').Responses.Response);
          }, 1000);
        },
      );
    });

    const queuingClient = new QueuingOpenAi({
      client: mockClient as unknown as import('openai').OpenAI,
      maxParallelism: 1,
      retryOptions: { retries: 3 },
      totalTimeout: 100,
    });

    // Start first request (will timeout)
    try {
      await queuingClient.responses.create({
        model: 'test-model',
        input: [{ role: 'user', content: 'test' }],
      });
      throw new Error('Should have timed out');
    } catch (e) {
      expect((e as Error).name).toMatch(/TimeoutError/);
    }

    // The first request timed out at 100ms.
    // If it was cancelled, the second request should be able to start immediately.
    // If not, it will have to wait for the 1000ms timer of the first request to finish.

    const startTime = Date.now();

    // Mock response for second request so we can measure how quickly it starts/finishes
    vi.mocked(mockClient.responses.create).mockResolvedValueOnce({
      output_text: 'second',
    } as import('openai/resources').Responses.Response);

    await queuingClient.responses.create({
      model: 'test-model',
      input: [{ role: 'user', content: 'test' }],
    });

    const duration = Date.now() - startTime;

    // If cancelled, the second request should finish very quickly (much less than 1000ms).
    // If not cancelled, it would wait at least 900ms more.
    expect(duration).toBeLessThan(500);
  });
});
