import { Message } from '../agent/types.js';
import type { DaemonResponseMessage, UserResponseMessage } from './daemon.js';

export interface ContextProvider {
  readonly name: string;
  readonly description: string;
  readonly next: (agentResponse: Message[]) => Promise<string>;
}

export interface ContextFormatter {
  readonly format: (
    agentResponse: Message[],
    providers: ContextProvider[],
  ) => Promise<string>;
}

export interface AgentMessageTransformer {
  readonly transform: (agentMessages: Message[]) => Message[];
}

export type EpochMessage = DaemonResponseMessage | UserResponseMessage;

export interface EpochMessageTransformer {
  readonly transform: (epochMessages: EpochMessage[]) => Message[];
}
