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

export interface AskYesNoQuestionProps {
  /**
   * Stable, cacheable prefix (e.g. a node's identity + accumulated context).
   * Placed first so it can be reused as a prompt-cache prefix across the
   * relevance check and the subsequent generation call.
   */
  readonly systemPrompt: string;
  /** Volatile stimuli (working memory + broadcast) shared with `generate`. */
  readonly messages: Message[];
  /** The yes/no question, appended after the shared prefix. */
  readonly question: string;
}

export type { GenerateWithToolsProps, ToolCall, ToolDefinition };

export interface Provider {
  readonly generate: (props: GenerateProps) => Promise<string>;
  readonly rankByRelevance: (
    concept: string,
    items: string[],
  ) => Promise<number[]>;
  readonly askYesNoQuestion: (props: AskYesNoQuestionProps) => Promise<boolean>;
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
