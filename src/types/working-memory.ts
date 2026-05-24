import { Message } from './message.js';

export interface WorkingMemory {
  readonly messages: Message[];
}
