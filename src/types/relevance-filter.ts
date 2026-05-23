import { Message } from './message.js';
import { WorkingMemory } from './working-memory.js';

export interface RelevanceFilter {
  readonly filter: (
    workingMemory: WorkingMemory,
    candidateMessages: Message[],
  ) => Promise<Message[]>;
}
