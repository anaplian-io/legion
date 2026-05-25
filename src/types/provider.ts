import { Message } from './message.js';
import { GenerateWithToolsProps, ToolCall, ToolDefinition } from './tool.js';

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
