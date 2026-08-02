import { CandidateMessage, Message } from './message.js';
import { WorkingMemory } from './working-memory.js';
import type { ActiveGoal, GoalDecision } from './goal.js';
import type { EvidenceReference } from './evidence.js';
import type { EpochTelemetryContext, InferenceStage } from './telemetry.js';

export interface DistillationTelemetryContext extends EpochTelemetryContext {
  readonly attempt: 'primary' | 'fallback' | 'configured';
  readonly attemptId: string;
  readonly inferenceStage: InferenceStage;
}

export interface DistillationProps {
  readonly workingMemory: WorkingMemory;
  readonly broadcasts: CandidateMessage[];
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
    telemetry: DistillationTelemetryContext,
  ) => Promise<DistillationResult | undefined>;
}
