import { WorkingMemory } from './working-memory.js';

export interface DistillationProps {
  readonly workingMemory: WorkingMemory;
  readonly broadcasts: string[];
}

export interface Distiller {
  readonly distill: (props: DistillationProps) => Promise<string>;
}
