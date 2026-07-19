import { Message } from './message.js';

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface GenerateWithToolsProps {
  readonly systemPrompt: string;
  readonly messages: Message[];
  readonly tools: readonly ToolDefinition[];
  /** Actuators require a call; cognitive nodes may optionally request one. */
  readonly toolChoice?: 'auto' | 'required';
}
