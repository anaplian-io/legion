import { describe, expect, it, vi } from 'vitest';
import { ActiveGoalSensor } from './active-goal-sensor.js';
import { GoalStore } from '../service/goal-store.js';
import type { EventStream } from '../types/event-stream.js';
import type { BroadcastMessage } from '../types/node.js';

const broadcastMessage: BroadcastMessage = {
  workingMemory: { messages: [] },
  broadcast: { role: 'broadcast', content: 'Continue.' },
};

const eventStream: EventStream = { publish: vi.fn(), subscribe: vi.fn() };

describe('ActiveGoalSensor', () => {
  it('returns no sensation when there is no active goal', async () => {
    const sensor = new ActiveGoalSensor({
      goalStore: new GoalStore({ eventStream }),
    });

    await expect(sensor.sense(broadcastMessage)).resolves.toBe('');
  });

  it('reflects the active goal as internal state', async () => {
    const goalStore = new GoalStore({
      eventStream,
      initialActiveGoal: {
        id: 'goal-7',
        objective: 'Find a concise explanation.',
        successCriteria: 'Produce a verified two-sentence explanation.',
        origin: 'user',
        revision: 3,
      },
    });
    const sensor = new ActiveGoalSensor({ goalStore });

    await expect(sensor.sense(broadcastMessage)).resolves.toBe(
      '[ACTIVE COLLECTIVE GOAL — INTERNAL STATE]\nID: goal-7\nRevision: 3\nOrigin: user\nObjective: Find a concise explanation.\nSuccess criteria: Produce a verified two-sentence explanation.',
    );
  });
});
