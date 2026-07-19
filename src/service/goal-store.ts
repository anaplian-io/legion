import { EventStream } from '../types/event-stream.js';
import { ActiveGoal, GoalOrigin } from '../types/goal.js';

export interface GoalDefinition {
  readonly objective: string;
  readonly successCriteria: string;
  readonly origin: GoalOrigin;
}

export interface GoalStoreProps {
  readonly eventStream: EventStream;
  readonly initialActiveGoal?: ActiveGoal;
  readonly createId?: () => string;
}

/** Owns the single active collective goal and reports every state transition. */
export class GoalStore {
  private _activeGoal: ActiveGoal | undefined;
  private readonly createId: () => string;
  private nextRevision: number;

  constructor(private readonly props: GoalStoreProps) {
    this._activeGoal = props.initialActiveGoal;
    this.createId = props.createId ?? (() => crypto.randomUUID());
    this.nextRevision = (props.initialActiveGoal?.revision ?? 0) + 1;
  }

  public get activeGoal(): ActiveGoal | undefined {
    return this._activeGoal;
  }

  public readonly setActiveGoal = (definition: GoalDefinition): ActiveGoal => {
    const objective = definition.objective.trim();
    const successCriteria = definition.successCriteria.trim();
    if (objective.length === 0) {
      throw new Error('[GoalStore] active goal objective must not be empty');
    }
    if (successCriteria.length === 0) {
      throw new Error(
        '[GoalStore] active goal success criteria must not be empty',
      );
    }
    const activeGoal = {
      id: this.createId(),
      objective,
      successCriteria,
      origin: definition.origin,
      revision: this.nextRevision,
    };
    this.nextRevision += 1;
    this._activeGoal = activeGoal;
    this.publishUpdate();
    return activeGoal;
  };

  public readonly clearActiveGoal = (expectedGoalId: string): boolean => {
    if (this._activeGoal === undefined) {
      return false;
    }
    if (this._activeGoal.id !== expectedGoalId) {
      throw new Error(
        `[GoalStore] cannot clear goal ${expectedGoalId}; active goal is ${this._activeGoal.id}`,
      );
    }
    this._activeGoal = undefined;
    this.publishUpdate();
    return true;
  };

  private readonly publishUpdate = (): void => {
    this.props.eventStream.publish({
      topicName: 'goal/updated',
      data: { activeGoal: this._activeGoal },
    });
  };
}
