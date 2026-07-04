import { Sensor } from '../types/sensor.js';

export class UserInputSensor implements Sensor {
  private readonly queue: string[] = [];
  private lastSensedInputs: string[] = [];

  public enqueue(content: string): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.queue.push(trimmed);
  }

  public async sense(): Promise<string> {
    const input = this.queue.shift();
    if (input === undefined) {
      this.lastSensedInputs = [];
      return '';
    }
    this.lastSensedInputs = [input];
    return input;
  }

  public consumeLastSensedInputs(): readonly string[] {
    const inputs = this.lastSensedInputs;
    this.lastSensedInputs = [];
    return inputs;
  }
}
