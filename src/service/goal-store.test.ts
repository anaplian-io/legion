import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalStore } from './goal-store.js';
import type { EventStream } from '../types/event-stream.js';

describe('GoalStore', () => {
  let eventStream: EventStream;

  beforeEach(() => {
    eventStream = { publish: vi.fn(), subscribe: vi.fn() };
  });

  it('restores an initial active goal', () => {
    const activeGoal = { id: 'restored-goal', content: 'Resume the inquiry' };

    const store = new GoalStore({ eventStream, initialActiveGoal: activeGoal });

    expect(store.activeGoal).toEqual(activeGoal);
  });

  it('sets a trimmed goal and publishes its new state', () => {
    const store = new GoalStore({
      eventStream,
      createId: () => 'goal-1',
    });

    const activeGoal = store.setActiveGoal('  Investigate the sensor path.  ');

    expect(activeGoal).toEqual({
      id: 'goal-1',
      content: 'Investigate the sensor path.',
    });
    expect(store.activeGoal).toEqual(activeGoal);
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'goal/updated',
      data: { activeGoal },
    });
  });

  it('uses a generated ID when a caller does not provide one', () => {
    const store = new GoalStore({ eventStream });

    expect(store.setActiveGoal('Explore the workspace').id).toEqual(
      expect.any(String),
    );
  });

  it('rejects an empty active goal', () => {
    const store = new GoalStore({ eventStream });

    expect(() => store.setActiveGoal('   ')).toThrow(
      '[GoalStore] active goal content must not be empty',
    );
    expect(eventStream.publish).not.toHaveBeenCalled();
  });

  it('does not publish when clearing a goal that is already absent', () => {
    const store = new GoalStore({ eventStream });

    expect(store.clearActiveGoal()).toBe(false);
    expect(eventStream.publish).not.toHaveBeenCalled();
  });

  it('clears an active goal and publishes the absence', () => {
    const store = new GoalStore({
      eventStream,
      initialActiveGoal: { id: 'goal-1', content: 'Explore' },
    });

    expect(store.clearActiveGoal()).toBe(true);
    expect(store.activeGoal).toBeUndefined();
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'goal/updated',
      data: { activeGoal: undefined },
    });
  });
});
