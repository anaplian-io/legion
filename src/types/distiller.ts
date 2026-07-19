import { Message } from './message.js';
import { WorkingMemory } from './working-memory.js';

export interface DistillationProps {
  readonly workingMemory: WorkingMemory;
  readonly broadcasts: Message[];
  readonly afferentContext?: readonly Message[] | undefined;
}

export interface Distiller {
  readonly distill: (props: DistillationProps) => Promise<Message | undefined>;
}
