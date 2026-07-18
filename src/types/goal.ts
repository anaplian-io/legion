/** A durable collective intention managed by Legion's native goal actuator. */
export interface ActiveGoal {
  readonly id: string;
  readonly content: string;
}

/** Session file written by SessionSaver when the active goal changes. */
export const ACTIVE_GOAL_FILE_NAME = 'active-goal.json';
