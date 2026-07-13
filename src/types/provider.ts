import { Message } from './message.js';
import { GenerateWithToolsProps, ToolCall, ToolDefinition } from './tool.js';
import {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { OpenAI } from 'openai';
import RequestOptions = OpenAI.RequestOptions;

export interface GenerateProps {
  readonly systemPrompt: string;
  readonly messages: Message[];
}

export interface SelectBestProps {
  /** Selection criteria and instructions for comparing candidates. */
  readonly systemPrompt: string;
  /** Context used to judge the candidates. */
  readonly messages: Message[];
  /** Candidate strings; the returned index must refer to this array. */
  readonly candidates: string[];
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
  /** Returns the index of the single best candidate. */
  readonly selectBest: (props: SelectBestProps) => Promise<number>;
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
  readonly chat: {
    readonly completions: {
      readonly create: (
        body: ChatCompletionCreateParamsNonStreaming,
        options?: RequestOptions,
      ) => Promise<ChatCompletion>;
    };
  };
}
