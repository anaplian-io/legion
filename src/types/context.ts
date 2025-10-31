import { AgentInputItem, AgentOutputItem } from '@openai/agents';
import { EpochMessage } from './daemon.js';

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

export interface AgentMessageTransformer {
  readonly transform: (
    agentOutputItems: AgentOutputItem[],
  ) => AgentOutputItem[];
}

export interface EpochMessageTransformer {
  readonly transform: (epochMessages: EpochMessage[]) => AgentInputItem[];
}
