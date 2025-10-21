import { DeliverMessage } from './message.js';

export interface DaemonIdentity {
  readonly id: string;
  name: string;
  description: string;
}

export type Daemon = DaemonIdentity & {
  readonly inbox: DeliverMessage;
};
