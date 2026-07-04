import { describe, expect, it } from 'vitest';
import { CurrentTimeSensor } from './current-time-sensor.js';

describe('CurrentTimeSensor', () => {
  it('should report the current time as an ISO UTC timestamp', async () => {
    const sensor = new CurrentTimeSensor({
      clock: () => new Date('2026-07-03T12:34:56.789Z'),
    });

    await expect(sensor.sense()).resolves.toBe(
      'Current UTC time: 2026-07-03T12:34:56.789Z',
    );
  });

  it('should use the system clock by default', async () => {
    const sensor = new CurrentTimeSensor();

    await expect(sensor.sense()).resolves.toMatch(
      /^Current UTC time: \d{4}-\d{2}-\d{2}T/,
    );
  });
});
