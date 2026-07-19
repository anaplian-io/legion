import { GoalStore } from '../service/goal-store.js';
import { Sensor } from '../types/sensor.js';

export interface ActiveGoalSensorProps {
  readonly goalStore: GoalStore;
}

/** Reflects the durable shared intention into the afferent wave. */
export class ActiveGoalSensor implements Sensor {
  constructor(private readonly props: ActiveGoalSensorProps) {}

  public readonly sense: Sensor['sense'] = async (): Promise<string> => {
    const activeGoal = this.props.goalStore.activeGoal;
    if (activeGoal === undefined) {
      return '';
    }
    return `[ACTIVE COLLECTIVE GOAL — INTERNAL STATE]\nID: ${activeGoal.id}\nRevision: ${activeGoal.revision}\nOrigin: ${activeGoal.origin}\nObjective: ${activeGoal.objective}\nSuccess criteria: ${activeGoal.successCriteria}`;
  };
}
