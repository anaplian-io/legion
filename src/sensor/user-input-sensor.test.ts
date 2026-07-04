import { describe, expect, it } from 'vitest';
import { UserInputSensor } from './user-input-sensor.js';

describe('UserInputSensor', () => {
  it('should return empty output when no input is queued', async () => {
    const sensor = new UserInputSensor();

    await expect(sensor.sense()).resolves.toBe('');
  });

  it('should trim and drain one queued input', async () => {
    const sensor = new UserInputSensor();

    sensor.enqueue('  hello  ');

    await expect(sensor.sense()).resolves.toBe('hello');
    expect(sensor.consumeLastSensedInputs()).toEqual(['hello']);
    expect(sensor.consumeLastSensedInputs()).toEqual([]);
    await expect(sensor.sense()).resolves.toBe('');
  });

  it('should ignore empty submissions', async () => {
    const sensor = new UserInputSensor();

    sensor.enqueue(' ');
    sensor.enqueue('');

    await expect(sensor.sense()).resolves.toBe('');
  });

  it('should drain multiple queued inputs one at a time in FIFO order', async () => {
    const sensor = new UserInputSensor();

    sensor.enqueue('first');
    sensor.enqueue('second');

    await expect(sensor.sense()).resolves.toBe('first');
    expect(sensor.consumeLastSensedInputs()).toEqual(['first']);
    await expect(sensor.sense()).resolves.toBe('second');
    expect(sensor.consumeLastSensedInputs()).toEqual(['second']);
    await expect(sensor.sense()).resolves.toBe('');
  });
});
