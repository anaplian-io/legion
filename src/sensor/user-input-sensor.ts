import { Sensor } from '../types/sensor.js';

export interface QueuedUserInput {
  readonly id: string;
  readonly content: string;
  readonly receivedAtMs: number;
}

export class UserInputSensor implements Sensor {
  private readonly queue: QueuedUserInput[] = [];
  private lastSensedInputs: QueuedUserInput[] = [];

  public enqueue(
    content: string,
    metadata?: { readonly id: string; readonly receivedAtMs: number },
  ): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.queue.push({
      id: metadata?.id ?? crypto.randomUUID(),
      content: trimmed,
      receivedAtMs: metadata?.receivedAtMs ?? performance.now(),
    });
  }

  public async sense(): Promise<string> {
    const input = this.queue.shift();
    if (input === undefined) {
      this.lastSensedInputs = [];
      return '';
    }
    this.lastSensedInputs = [input];
    return input.content;
  }

  public consumeLastSensedInputs(): readonly string[] {
    return this.consumeLastSensedInputRecords().map(({ content }) => content);
  }

  public consumeLastSensedInputRecords(): readonly QueuedUserInput[] {
    const inputs = this.lastSensedInputs;
    this.lastSensedInputs = [];
    return inputs;
  }

  /** Inputs that can actually be consumed by the next single sensor poll. */
  public nextInputIds(): readonly string[] {
    const next = this.queue[0];
    return next === undefined ? [] : [next.id];
  }
}
