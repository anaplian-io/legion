export type Role = 'user' | 'assistant';

export interface Message {
  readonly role: Role;
  readonly content: string;
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  generate(prompt: string, context?: string): Promise<string>;
  addToHistory(role: Role, content: string): void;
  getHistory(): Message[];
  reset(): void;
}

export interface AgentOptions {
  readonly id: string;
  readonly name: string;
  readonly instructions?: string;
}
