import { AgentOptions } from '../agent/types.js';

export interface Provider {
  readonly name: string;
  generate(
    options: AgentOptions,
    prompt: string,
    context?: string,
  ): Promise<string>;
}

export interface ProviderClient {
  createChatCompletion(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>;
}
