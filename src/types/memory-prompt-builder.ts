import type { Message } from './message.js';
import type { BroadcastMessage } from './node.js';

/** Builds one ordered, token-conscious cognitive prompt message list. */
export interface MemoryPromptBuilder {
  readonly buildMessages: (broadcastMessage: BroadcastMessage) => Message[];
}
