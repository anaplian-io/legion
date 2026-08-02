import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalStore } from './goal-store.js';
import type { EventStream } from '../../types/event-stream.js';
import type { ActiveGoal } from '../../types/goal.js';

const restoredGoal: ActiveGoal = {
  id: 'restored-goal',
  objective: 'Resume the inquiry',
  successCriteria: 'Produce the pending conclusion',
  origin: 'autonomous',
  revision: 7,
};

describe('GoalStore', () => {
  let eventStream: EventStream;

  beforeEach(() => {
    eventStream = { publish: vi.fn(), subscribe: vi.fn() };
  });

  it('restores an initial active goal', () => {
    const store = new GoalStore({
      eventStream,
      initialActiveGoal: restoredGoal,
    });

    expect(store.activeGoal).toEqual(restoredGoal);
  });

  it('sets trimmed, versioned goals and publishes state', () => {
    const store = new GoalStore({
      eventStream,
      initialActiveGoal: restoredGoal,
      createId: () => 'goal-1',
    });
    const activeGoal = store.setActiveGoal({
      objective: '  Investigate the sensor path.  ',
      successCriteria: '  Trace one reading end to end.  ',
      origin: 'user',
    });

    expect(activeGoal).toEqual({
      id: 'goal-1',
      objective: 'Investigate the sensor path.',
      successCriteria: 'Trace one reading end to end.',
      origin: 'user',
      revision: 8,
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'goal/updated',
      data: { activeGoal },
    });
  });

  it('uses a generated ID', () => {
    const store = new GoalStore({ eventStream });

    expect(
      store.setActiveGoal({
        objective: 'Explore',
        successCriteria: 'Find one result',
        origin: 'autonomous',
      }).id,
    ).toEqual(expect.any(String));
  });

  it('revises the matching goal while preserving identity', () => {
    const store = new GoalStore({
      eventStream,
      initialActiveGoal: restoredGoal,
    });

    const revised = store.reviseActiveGoal('restored-goal', {
      objective: '  Refine the inquiry  ',
      successCriteria: '  Publish the refined conclusion  ',
      origin: 'user',
    });

    expect(revised).toEqual({
      id: 'restored-goal',
      objective: 'Refine the inquiry',
      successCriteria: 'Publish the refined conclusion',
      origin: 'user',
      revision: 8,
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'goal/updated',
      data: { activeGoal: revised },
    });
  });

  it('rejects stale and malformed revisions', () => {
    const store = new GoalStore({ eventStream });

    expect(() =>
      store.reviseActiveGoal('missing', {
        objective: 'Explore',
        successCriteria: 'Finish',
        origin: 'autonomous',
      }),
    ).toThrow('active goal is none');

    const restored = new GoalStore({
      eventStream,
      initialActiveGoal: restoredGoal,
    });
    expect(() =>
      restored.reviseActiveGoal('stale', {
        objective: 'Explore',
        successCriteria: 'Finish',
        origin: 'autonomous',
      }),
    ).toThrow('active goal is restored-goal');
    expect(() =>
      restored.reviseActiveGoal('restored-goal', {
        objective: ' ',
        successCriteria: 'Finish',
        origin: 'autonomous',
      }),
    ).toThrow('requires an objective and success criteria');
    expect(() =>
      restored.reviseActiveGoal('restored-goal', {
        objective: 'Explore',
        successCriteria: ' ',
        origin: 'autonomous',
      }),
    ).toThrow('requires an objective and success criteria');
  });

  it('rejects empty objectives and success criteria', () => {
    const store = new GoalStore({ eventStream });
    expect(() =>
      store.setActiveGoal({
        objective: ' ',
        successCriteria: 'Done',
        origin: 'autonomous',
      }),
    ).toThrow('objective must not be empty');
    expect(() =>
      store.setActiveGoal({
        objective: 'Explore',
        successCriteria: ' ',
        origin: 'autonomous',
      }),
    ).toThrow('success criteria must not be empty');
  });

  it('does not publish when no goal exists to clear', () => {
    const store = new GoalStore({ eventStream });

    expect(store.clearActiveGoal('goal-1')).toBe(false);
    expect(eventStream.publish).not.toHaveBeenCalled();
  });

  it('rejects stale clear requests and clears the matching active goal', () => {
    const store = new GoalStore({
      eventStream,
      initialActiveGoal: restoredGoal,
    });

    expect(() => store.clearActiveGoal('stale')).toThrow(
      'cannot clear goal stale; active goal is restored-goal',
    );
    expect(store.clearActiveGoal('restored-goal')).toBe(true);
    expect(store.activeGoal).toBeUndefined();
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'goal/updated',
      data: { activeGoal: undefined },
    });
  });
});
