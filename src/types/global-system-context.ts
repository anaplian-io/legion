import { AgentInputItem } from '@openai/agents-core/types';
import { DaemonIdentity } from './daemon.js';

export interface GlobalSystemContext {
  readonly date: string;
  readonly myDaemonIdentity: DaemonIdentity;
  readonly allDaemons: DaemonIdentity[];
  readonly recentConversationHistory: AgentInputItem[];
  readonly relevantMemories: {
    readonly document: string;
    readonly date: string;
  }[];
}
