import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalNode } from './goal-node.js';
import { GoalStore } from '../service/goal-store.js';
import type { EventStream } from '../types/event-stream.js';
import type { BroadcastMessage } from '../types/node.js';
import type { Provider, ToolCall } from '../types/provider.js';
import type { RelevanceGate } from '../types/relevance-gate.js';

const broadcastMessage: BroadcastMessage = {
  workingMemory: {
    messages: [
      { role: 'working-memory', content: 'Earlier collective thought' },
    ],
  },
  broadcast: { role: 'broadcast', content: '@goal-manager set a goal' },
};

const call = (name: string, argumentsString: string): ToolCall => ({
  id: `call-${name}`,
  type: 'function',
  function: { name, arguments: argumentsString },
});

describe('GoalNode', () => {
  let provider: Provider;
  let eventStream: EventStream;
  let relevanceGate: RelevanceGate;
  let goalStore: GoalStore;

  beforeEach(() => {
    provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    eventStream = { publish: vi.fn(), subscribe: vi.fn() };
    relevanceGate = { isRelevant: vi.fn().mockResolvedValue(true) };
    goalStore = new GoalStore({
      eventStream,
      createId: () => 'goal-1',
    });
  });

  const makeNode = (): GoalNode =>
    new GoalNode({
      id: 'goal-manager',
      provider,
      eventStream,
      relevanceGate,
      goalStore,
    });

  it('exposes a local goal-management capability', () => {
    const node = makeNode();

    expect(node.id).toBe('goal-manager');
    expect(node.kind).toBe('goal');
    expect(node.status).toBe('idle');
    expect(node.context).toBe('');
    expect(node.capabilityDescription).toContain('active collective goal');
    expect(node.preamble).toContain('set_active_goal');
    expect(node.preamble).toContain('clear_active_goal');
  });

  it('does not generate when the current broadcast does not address it', async () => {
    vi.mocked(relevanceGate.isRelevant).mockResolvedValue(false);
    const node = makeNode();

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();

    expect(relevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      nodeId: 'goal-manager',
      epochsAlive: 0,
      nodeContext: node.preamble,
    });
    expect(provider.generateWithTools).not.toHaveBeenCalled();
    expect(node.status).toBe('idle');
  });

  it('does not emit an afferent result when the model omits or empties tool calls', async () => {
    const node = makeNode();
    vi.mocked(provider.generateWithTools)
      .mockResolvedValueOnce({ content: '', toolCalls: undefined })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
    expect(node.status).toBe('idle');
  });

  it('sets and clears the active goal through local tool calls', async () => {
    const node = makeNode();
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        call('set_active_goal', '{"goal":"  Explore local sensors.  "}'),
        call('clear_active_goal', '{}'),
      ],
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(result).toEqual({
      role: 'afferent',
      originatingNodeId: 'goal-manager',
      content: JSON.stringify([
        {
          callId: 'call-set_active_goal',
          name: 'set_active_goal',
          success: true,
          activeGoal: { id: 'goal-1', content: 'Explore local sensors.' },
        },
        {
          callId: 'call-clear_active_goal',
          name: 'clear_active_goal',
          success: true,
          cleared: true,
        },
      ]),
    });
    expect(goalStore.activeGoal).toBeUndefined();
    expect(provider.generateWithTools).toHaveBeenCalledWith({
      systemPrompt: node.preamble,
      messages: [
        { role: 'working-memory', content: 'Earlier collective thought' },
        { role: 'broadcast', content: '@goal-manager set a goal' },
      ],
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'set_active_goal' }),
        expect.objectContaining({ name: 'clear_active_goal' }),
      ]),
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: 'goal-manager',
        callId: 'call-set_active_goal',
        toolName: 'set_active_goal',
        arguments: '{"goal":"  Explore local sensors.  "}',
      },
    });
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-completed',
      data: {
        nodeId: 'goal-manager',
        callId: 'call-clear_active_goal',
        toolName: 'clear_active_goal',
        success: true,
        output:
          '{"callId":"call-clear_active_goal","name":"clear_active_goal","success":true,"cleared":true}',
      },
    });
  });

  it('returns failed results for malformed and unsupported local tool calls', async () => {
    const node = makeNode();
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        call('set_active_goal', '{not json'),
        call('set_active_goal', '1'),
        call('set_active_goal', 'null'),
        call('set_active_goal', '[]'),
        call('set_active_goal', '{}'),
        call('set_active_goal', '{"goal":1}'),
        call('not_a_goal_tool', '{}'),
      ],
    });

    const result = await node.sendMessage(broadcastMessage);
    const parsed = JSON.parse(result?.content ?? '[]') as Array<{
      readonly name: string;
      readonly success: boolean;
      readonly error?: string;
    }>;

    expect(parsed).toHaveLength(7);
    expect(parsed.every((entry) => !entry.success)).toBe(true);
    expect(parsed[0]?.error).toContain('must be valid JSON');
    expect(parsed[1]?.error).toContain('require a string goal field');
    expect(parsed[6]?.error).toContain('unsupported goal tool');
    expect(eventStream.publish).toHaveBeenCalledWith({
      topicName: 'tool/invocation-completed',
      data: {
        nodeId: 'goal-manager',
        callId: 'call-not_a_goal_tool',
        toolName: 'not_a_goal_tool',
        success: false,
        output: '[GoalNode goal-manager] unsupported goal tool not_a_goal_tool',
      },
    });
  });

  it('preserves a non-Error local tool failure as text', async () => {
    const node = makeNode();
    vi.spyOn(goalStore, 'setActiveGoal').mockImplementation(() => {
      throw 'goal store offline';
    });
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [call('set_active_goal', '{"goal":"Explore"}')],
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(result?.content).toContain('goal store offline');
  });

  it('continues when status-event publishing throws', async () => {
    eventStream = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('event stream unavailable');
      }),
      subscribe: vi.fn(),
      reportError: vi.fn(),
    };
    relevanceGate = { isRelevant: vi.fn().mockResolvedValue(false) };
    goalStore = new GoalStore({ eventStream });
    const node = makeNode();

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
    expect(eventStream.reportError).toHaveBeenCalledWith({
      source: 'GoalNode goal-manager',
      message: 'Failed to publish a node status change.',
      error: expect.any(Error),
    });
  });
});
