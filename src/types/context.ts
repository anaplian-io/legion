import { AgentOutputItem } from '@openai/agents';

export interface ContextProvider {
  readonly name: string;
  readonly description: string;
  readonly next: (agentResponse: AgentOutputItem[]) => Promise<string>;
}

export interface ContextFormatter {
  readonly format: (
    agentResponse: AgentOutputItem[],
    providers: ContextProvider[],
  ) => Promise<string>;
}

export interface AgentMessagePostProcessor {
  readonly transform: (
    agentOutputItems: AgentOutputItem[],
  ) => AgentOutputItem[];
}
