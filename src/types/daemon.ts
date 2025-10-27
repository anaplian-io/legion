import { AgentOutputItem } from '@openai/agents';

export interface DaemonIdentity {
  readonly id: string;
  name: string;
  description: string;
}

export type Daemon = DaemonIdentity & {
  readonly nextEpoch: () => Promise<string>;
  readonly history: AgentOutputItem[];
};
