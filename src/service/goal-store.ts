import { EventStream } from '../types/event-stream.js';
import { ActiveGoal } from '../types/goal.js';

export interface GoalStoreProps {
  readonly eventStream: EventStream;
  readonly initialActiveGoal?: ActiveGoal;
  readonly createId?: () => string;
}

/** Owns the single active collective goal and reports every state transition. */
export class GoalStore {
  private _activeGoal: ActiveGoal | undefined;
  private readonly createId: () => string;

  constructor(private readonly props: GoalStoreProps) {
    this._activeGoal = props.initialActiveGoal;
    this.createId = props.createId ?? (() => crypto.randomUUID());
  }

  public get activeGoal(): ActiveGoal | undefined {
    return this._activeGoal;
  }

  public readonly setActiveGoal = (content: string): ActiveGoal => {
    const normalizedContent = content.trim();
    if (normalizedContent.length === 0) {
      throw new Error('[GoalStore] active goal content must not be empty');
    }
    const activeGoal = { id: this.createId(), content: normalizedContent };
    this._activeGoal = activeGoal;
    this.publishUpdate();
    return activeGoal;
  };

  public readonly clearActiveGoal = (): boolean => {
    if (this._activeGoal === undefined) {
      return false;
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
