import { AgentOutputItem } from '@openai/agents';

export interface DaemonIdentity {
  readonly id: string;
  name: string;
  description: string;
}

type OutputMessage = {
  readonly output: string;
};

export type DaemonResponseMessage = {
  readonly type: 'daemon';
  readonly identity: DaemonIdentity;
} & OutputMessage;

export type UserResponseMessage = {
  readonly type: 'human';
} & OutputMessage;

export type EpochMessage = DaemonResponseMessage | UserResponseMessage;

export type Daemon = DaemonIdentity & {
  readonly nextEpoch: (
    globalMessageHistory: EpochMessage[],
  ) => Promise<DaemonResponseMessage>;
  readonly history: AgentOutputItem[];
};
