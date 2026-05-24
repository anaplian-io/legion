import { Message } from './message.js';
import { WorkingMemory } from './working-memory.js';

export type NodeResponse = Message | undefined;

export interface BroadcastMessage {
  readonly workingMemory: WorkingMemory;
  readonly broadcast: Message;
}

export type NodeStatus = 'idle' | 'generating' | 'evaluating-relevance';

export interface Node<T extends string> {
  readonly id: string;
  readonly status: NodeStatus;
  readonly kind: T;
  readonly context: string;
  readonly sendMessage: (
    broadcastMessage: BroadcastMessage,
  ) => Promise<NodeResponse>;
}
