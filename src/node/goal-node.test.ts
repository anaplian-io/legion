import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalNode } from './goal-node.js';
import { GoalStore } from '../service/goal-store.js';
import type { EventStream } from '../types/event-stream.js';
import type { BroadcastMessage } from '../types/node.js';
import type { ActionRequest } from '../types/message.js';

const request = (
  operation: string,
  args: Readonly<Record<string, unknown>>,
  overrides: Partial<ActionRequest> = {},
): ActionRequest => ({
  id: `request-${operation}`,
  targetNodeId: 'goal-manager',
  operation,
  arguments: args,
  ...overrides,
});

const message = (
  actionRequests?: readonly ActionRequest[],
  content = 'Ordinary prose mentioning goal-manager.',
): BroadcastMessage => ({
  workingMemory: { messages: [] },
  broadcast: {
    role: 'broadcast',
    content,
    ...(actionRequests === undefined ? {} : { actionRequests }),
  },
});

describe('GoalNode', () => {
  let eventStream: EventStream;
  let goalStore: GoalStore;

  beforeEach(() => {
    eventStream = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      reportError: vi.fn(),
    };
    goalStore = new GoalStore({
      eventStream,
      createId: () => 'goal-1',
    });
  });

  const makeNode = (): GoalNode =>
    new GoalNode({ id: 'goal-manager', eventStream, goalStore });

  it('exposes its structured goal-management contract', () => {
    const node = makeNode();

    expect(node.id).toBe('goal-manager');
    expect(node.kind).toBe('goal');
    expect(node.status).toBe('idle');
    expect(node.context).toBe('');
    expect(node.capabilityDescription).toContain('successCriteria');
    expect(node.preamble).toContain('structured requests');
  });

  it('ignores prose mentions and requests addressed to other nodes', async () => {
    const node = makeNode();

    await expect(node.sendMessage(message())).resolves.toBeUndefined();
    await expect(
      node.sendMessage(
        message([
          request('set_active_goal', {}, { targetNodeId: 'other-node' }),
        ]),
      ),
    ).resolves.toBeUndefined();

    expect(goalStore.activeGoal).toBeUndefined();
    expect(eventStream.publish).not.toHaveBeenCalled();
  });

  it('sets and clears a precise goal through typed action requests', async () => {
    const node = makeNode();
    const result = await node.sendMessage(
      message([
        request('set_active_goal', {
          objective: '  Explore local sensors.  ',
          successCriteria: '  Record one verified sensor reading.  ',
          origin: 'user',
        }),
        request('clear_active_goal', { goalId: 'goal-1' }),
      ]),
    );

    expect(result).toEqual({
      role: 'afferent',
      originatingNodeId: 'goal-manager',
      content: JSON.stringify([
        {
          callId: 'request-set_active_goal',
          name: 'set_active_goal',
          success: true,
          activeGoal: {
            id: 'goal-1',
            objective: 'Explore local sensors.',
            successCriteria: 'Record one verified sensor reading.',
            origin: 'user',
            revision: 1,
          },
        },
        {
          callId: 'request-clear_active_goal',
          name: 'clear_active_goal',
          success: true,
          cleared: true,
        },
      ]),
    });
    expect(goalStore.activeGoal).toBeUndefined();
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: 'goal-manager',
        callId: 'request-set_active_goal',
        toolName: 'set_active_goal',
        arguments: JSON.stringify({
          objective: '  Explore local sensors.  ',
          successCriteria: '  Record one verified sensor reading.  ',
          origin: 'user',
        }),
      },
    });
  });

  it('returns failures for malformed, unsupported, and stale requests', async () => {
    const node = makeNode();
    goalStore.setActiveGoal({
      objective: 'Explore',
      successCriteria: 'Report a finding',
      origin: 'autonomous',
    });

    const result = await node.sendMessage(
      message([
        request('set_active_goal', {
          objective: '',
          successCriteria: 'Done',
          origin: 'autonomous',
        }),
        request('set_active_goal', {
          objective: 'Explore',
          successCriteria: 'Done',
          origin: 'external',
        }),
        request('clear_active_goal', { goalId: 'stale-goal' }),
        request('unsupported', {}),
      ]),
    );
    const parsed = JSON.parse(result?.content ?? '[]') as Array<{
      readonly success: boolean;
      readonly error?: string;
    }>;

    expect(parsed.every((entry) => !entry.success)).toBe(true);
    expect(parsed[0]?.error).toContain('non-empty string objective');
    expect(parsed[1]?.error).toContain('origin must be user or autonomous');
    expect(parsed[2]?.error).toContain('cannot clear goal stale-goal');
    expect(parsed[3]?.error).toContain('unsupported goal operation');
    expect(eventStream.reportError).toHaveBeenCalledTimes(4);
  });

  it('preserves a non-Error goal-store failure as text', async () => {
    vi.spyOn(goalStore, 'setActiveGoal').mockImplementation(() => {
      throw 'goal store offline';
    });

    const result = await makeNode().sendMessage(
      message([
        request('set_active_goal', {
          objective: 'Explore',
          successCriteria: 'Finish',
          origin: 'autonomous',
        }),
      ]),
    );

    expect(result?.content).toContain('goal store offline');
  });

  it('continues when status-event publishing throws', async () => {
    eventStream = {
      publish: vi.fn().mockImplementation((event: { topicName: string }) => {
        if (event.topicName === 'node/status-change') {
          throw new Error('event stream unavailable');
        }
      }),
      subscribe: vi.fn(),
      reportError: vi.fn(),
    };
    goalStore = new GoalStore({ eventStream, createId: () => 'goal-1' });

    await expect(
      makeNode().sendMessage(
        message([
          request('set_active_goal', {
            objective: 'Explore',
            successCriteria: 'Finish',
            origin: 'autonomous',
          }),
        ]),
      ),
    ).resolves.toBeDefined();
    expect(eventStream.reportError).toHaveBeenCalledWith({
      source: 'GoalNode goal-manager',
      message: 'Failed to publish a node status change.',
      error: expect.any(Error),
    });
  });
});
