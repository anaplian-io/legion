import { WorkingMemory } from './working-memory.js';

export interface GetTopNProps {
  readonly workingMemory: WorkingMemory;
}

export interface AttentionGate {
  readonly getTopN: (props: GetTopNProps) => Promise<number | 'all'>;
}
