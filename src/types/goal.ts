import type { EvidenceReference } from './evidence.js';

export type GoalOrigin = 'user' | 'autonomous';

/** A durable, testable collective intention managed by the goal actuator. */
export interface ActiveGoal {
  readonly id: string;
  readonly objective: string;
  readonly successCriteria: string;
  readonly origin: GoalOrigin;
  /** Monotonically increasing within one GoalStore lifetime. */
  readonly revision: number;
}

interface ProposedGoalDecision {
  readonly id: string;
  readonly objective: string;
  readonly successCriteria: string;
  readonly origin: GoalOrigin;
  readonly reason: string;
  readonly supportingEvidence: readonly EvidenceReference[];
}

export interface UnchangedGoalDecision {
  readonly kind: 'unchanged';
  readonly reason: string;
}

export interface ActivateGoalDecision extends ProposedGoalDecision {
  readonly kind: 'activate';
}

export interface ReviseGoalDecision extends ProposedGoalDecision {
  readonly kind: 'revise';
  readonly goalId: string;
}

export interface SupersedeGoalDecision extends ProposedGoalDecision {
  readonly kind: 'supersede';
  readonly goalId: string;
}

interface TerminalGoalDecision {
  readonly id: string;
  readonly goalId: string;
  readonly reason: string;
  readonly supportingEvidence: readonly EvidenceReference[];
}

export interface CompleteGoalDecision extends TerminalGoalDecision {
  readonly kind: 'complete';
}

export interface AbandonGoalDecision extends TerminalGoalDecision {
  readonly kind: 'abandon';
}

/** A typed, evidence-backed proposal emitted by distillation for GoalNode. */
export type GoalDecision =
  | UnchangedGoalDecision
  | ActivateGoalDecision
  | ReviseGoalDecision
  | SupersedeGoalDecision
  | CompleteGoalDecision
  | AbandonGoalDecision;

/** Session file written by SessionSaver when the active goal changes. */
export const ACTIVE_GOAL_FILE_NAME = 'active-goal.json';
