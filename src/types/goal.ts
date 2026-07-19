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

/** Session file written by SessionSaver when the active goal changes. */
export const ACTIVE_GOAL_FILE_NAME = 'active-goal.json';
