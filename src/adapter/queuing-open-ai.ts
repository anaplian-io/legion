import { MinimalOpenAi } from '../types/provider.js';
import { OpenAI } from 'openai';
import PQueue from 'p-queue';

export interface QueuingOpenAiProps {
  readonly client: OpenAI;
  readonly maxParallelism: number;
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
      return this.queue.add(() =>
        this.props.client.responses.create(body, options),
      );
    },
  };
}
