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
    });

    const options = { timeout: 5000 } as RequestOptions;

    await queuingClient.responses.create(
      {
        model: 'test-model',
        input: [{ role: 'user', content: 'test' }],
      },
      options,
    );

    expect(mockClient.responses.create).toHaveBeenCalledWith(
      expect.anything(),
      options,
    );
  });
});
