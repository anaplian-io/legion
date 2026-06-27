import { Message } from './message.js';
import { WorkingMemory } from './working-memory.js';

export type NodeResponse = Message | undefined;

export interface BroadcastMessage {
  readonly workingMemory: WorkingMemory;
  readonly broadcast: Message;
  /**
   * Outputs produced by afferent nodes (tools, sensors) earlier in the same
   * epoch, supplied to cognitive (memory) nodes as additional context. Afferent
   * nodes themselves ignore this field.
   */
  readonly afferentContext?: readonly Message[] | undefined;
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
