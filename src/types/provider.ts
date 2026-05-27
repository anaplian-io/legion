import { Message } from './message.js';
import { GenerateWithToolsProps, ToolCall, ToolDefinition } from './tool.js';
import {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import { OpenAI } from 'openai';
import RequestOptions = OpenAI.RequestOptions;

export interface GenerateProps {
  readonly systemPrompt: string;
  readonly messages: Message[];
}

export type { GenerateWithToolsProps, ToolCall, ToolDefinition };

export interface Provider {
  readonly generate: (props: GenerateProps) => Promise<string>;
  readonly rankByRelevance: (
    concept: string,
    items: string[],
  ) => Promise<number[]>;
  readonly askYesNoQuestion: (question: string) => Promise<boolean>;
  readonly splitString: (content: string) => Promise<[string, string]>;
  readonly generateWithTools: (
    props: GenerateWithToolsProps,
  ) => Promise<{ content: string; toolCalls: ToolCall[] | undefined }>;
}

export interface MinimalOpenAi {
  readonly responses: {
    readonly create: (
      body: ResponseCreateParamsNonStreaming,
      options?: RequestOptions,
    ) => Promise<Response>;
  };
}
