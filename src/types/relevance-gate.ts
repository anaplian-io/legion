import { BroadcastMessage } from './node.js';

export interface RelevanceGateProps {
  readonly broadcastMessage: BroadcastMessage;
  readonly nodeId: string;
  readonly epochsAlive: number;
  readonly nodeContext?: string;
}

export interface RelevanceGate {
  readonly isRelevant: (props: RelevanceGateProps) => Promise<boolean>;
}
