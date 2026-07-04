import { Sensor } from '../types/sensor.js';

export interface CurrentTimeSensorProps {
  readonly clock?: () => Date;
}

export class CurrentTimeSensor implements Sensor {
  private readonly clock: () => Date;

  constructor(props?: CurrentTimeSensorProps) {
    this.clock = props?.clock ?? (() => new Date());
  }

  public async sense(): Promise<string> {
    return `Current UTC time: ${this.clock().toISOString()}`;
  }
}
