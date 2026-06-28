import { BroadcastMessage } from './node.js';

export interface CuriosityGateProps {
  readonly broadcastMessage: BroadcastMessage;
  readonly nodeContext?: string;
}

export interface CuriosityGate {
  readonly isCurious: (props: CuriosityGateProps) => Promise<boolean>;
}
