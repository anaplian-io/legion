import { BroadcastMessage } from './node.js';
import type { Message } from './message.js';

export interface RelevanceGateProps {
  readonly broadcastMessage: BroadcastMessage;
  /** Ordered prompt messages shared with the subsequent node generation. */
  readonly messages: readonly Message[];
  readonly nodeId: string;
  readonly epochsAlive: number;
  readonly nodeContext?: string;
}

export interface RelevanceGate {
  readonly isRelevant: (props: RelevanceGateProps) => Promise<boolean>;
}
