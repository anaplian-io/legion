import { Message } from './message.js';
import { WorkingMemory } from './working-memory.js';
import type { ActiveGoal, GoalDecision } from './goal.js';
import type { EvidenceReference } from './evidence.js';

export interface DistillationProps {
  readonly workingMemory: WorkingMemory;
  readonly broadcasts: Message[];
  readonly afferentContext?: readonly Message[] | undefined;
  readonly activeGoal?: ActiveGoal | undefined;
}

export interface DistillationResult {
  readonly broadcast: Message;
  readonly supportingEvidence: readonly EvidenceReference[];
  readonly goalDecision: GoalDecision;
}

export interface Distiller {
  readonly distill: (
    props: DistillationProps,
  ) => Promise<DistillationResult | undefined>;
}
