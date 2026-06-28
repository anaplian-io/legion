import { MinimalOpenAi } from '../types/provider.js';
import { OpenAI } from 'openai';
import {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
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

  public readonly chat: MinimalOpenAi['chat'] = {
    completions: {
      create: async (
        body: ChatCompletionCreateParamsNonStreaming,
        options?: OpenAI.RequestOptions,
      ): Promise<ChatCompletion> => {
        const controller = new AbortController();
        const signal = controller.signal;

        const operation = async () => {
          return this.queue.add(async () => {
            return pTimeout(
              pRetry(
                () =>
                  this.props.client.chat.completions.create(body, {
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
    },
  };
}
