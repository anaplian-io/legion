import { MinimalOpenAi } from '../types/provider.js';
import { OpenAI } from 'openai';
import PQueue from 'p-queue';
import pRetry, { Options as RetryOptions } from 'p-retry';
import pTimeout from 'p-timeout';

export interface QueuingOpenAiProps {
  readonly client: OpenAI;
  readonly maxParallelism: number;
  readonly retryOptions: RetryOptions;
  readonly totalTimeout: number;
}

export class QueuingOpenAi implements MinimalOpenAi {
  private readonly queue: PQueue;

  constructor(private readonly props: QueuingOpenAiProps) {
    this.queue = new PQueue({ concurrency: props.maxParallelism });
  }

  public readonly responses: MinimalOpenAi['responses'] = {
    create: async (
      body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
      options?: OpenAI.RequestOptions,
    ): Promise<OpenAI.Responses.Response> => {
      const controller = new AbortController();
      const signal = controller.signal;

      const operation = async () => {
        return this.queue.add(async () => {
          return pTimeout(
            pRetry(
              () =>
                this.props.client.responses.create(body, {
                  ...options,
                  signal,
                }),
              {
                ...this.props.retryOptions,
                signal,
              },
            ),
            {
              milliseconds: this.props.totalTimeout,
            },
          );
        });
      };

      try {
        return await operation();
      } catch (e) {
        // On timeout (or any failure) abort the in-flight request so it does
        // not run on detached after we have already rejected.
        controller.abort();
        throw e;
      }
    },
  };
}
