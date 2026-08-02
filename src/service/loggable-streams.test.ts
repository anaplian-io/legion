import { describe, expect, it, vi } from 'vitest';
import { PublishProps } from '../types/event-stream.js';
import { ConcreteErrorStream } from './concrete-error-stream.js';
import { ConcreteEventStream } from './concrete-event-stream.js';
import { errorLogStream, eventLogStream } from './loggable-streams.js';

describe('loggable stream adapters', () => {
  it('adapts domain publication and preserves subscription cleanup', () => {
    const events = new ConcreteEventStream();
    const stream = eventLogStream(events);
    const received = vi.fn();
    const unsubscribe = stream.subscribeForLogging(received);
    const notice: PublishProps<'system/notice'> = {
      topicName: 'system/notice',
      data: { message: 'ready' },
    };

    events.publish(notice);
    unsubscribe();
    events.publish(notice);

    expect(stream.name).toBe('events');
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(notice);
  });

  it('serializes node snapshots explicitly', () => {
    const stream = eventLogStream(new ConcreteEventStream());
    const node = {
      id: 'node-1',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: 'focused context',
      sendMessage: async () => undefined,
    };

    expect(
      stream.serializeForLogging({
        topicName: 'orchestrator/nodes-changed',
        data: { allNodes: [node] },
      }),
    ).toEqual({
      topicName: 'orchestrator/nodes-changed',
      data: {
        allNodes: [
          {
            id: 'node-1',
            kind: 'memory',
            status: 'idle',
            context: 'focused context',
          },
        ],
      },
    });
    expect(
      stream.serializeForLogging({
        topicName: 'orchestrator/node-added',
        data: { addedNodes: [node] },
      }),
    ).toMatchObject({ data: { addedNodes: [{ id: 'node-1' }] } });
    expect(
      stream.serializeForLogging({
        topicName: 'orchestrator/node-updated',
        data: { node },
      }),
    ).toMatchObject({ data: { node: { id: 'node-1' } } });
  });

  it('explicitly serializes every bounded domain-event payload', () => {
    const stream = eventLogStream(new ConcreteEventStream());
    const events: PublishProps[] = [
      { topicName: 'system/notice', data: { message: 'notice' } },
      {
        topicName: 'node/status-change',
        data: { nodeId: 'node-1', status: 'idle' },
      },
      {
        topicName: 'tool/elaboration-completed',
        data: {
          nodeId: 'tool-1',
          requestId: 'request-1',
          success: true,
          toolCalls: [],
          output: '',
        },
      },
      {
        topicName: 'tool/invocation-started',
        data: {
          nodeId: 'tool-1',
          callId: 'call-1',
          toolName: 'lookup',
          arguments: '{}',
        },
      },
      {
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: 'tool-1',
          callId: 'call-1',
          toolName: 'lookup',
          success: true,
          output: 'done',
        },
      },
      { topicName: 'goal/updated', data: { activeGoal: undefined } },
      {
        topicName: 'orchestrator/node-removed',
        data: { removedNodeIds: ['node-1'] },
      },
      {
        topicName: 'orchestrator/working-memory-updated',
        data: {
          workingMemory: { messages: [] },
          broadcast: { role: 'broadcast', content: 'next' },
        },
      },
      {
        topicName: 'orchestrator/user-input-received',
        data: { content: 'hello' },
      },
      {
        topicName: 'orchestrator/user-input-consumed',
        data: { content: 'hello' },
      },
      {
        topicName: 'orchestrator/node-stats-updated',
        data: { nodeStats: [] },
      },
    ];

    events.forEach((event) => {
      expect(stream.serializeForLogging(event)).toBe(event);
    });
  });

  it('adapts minimal and detailed error reports', () => {
    const errors = new ConcreteErrorStream();
    const stream = errorLogStream(errors);
    const received = vi.fn();
    const unsubscribe = stream.subscribeForLogging(received);
    const report = { source: 'test', message: 'published' };

    errors.publish(report);
    unsubscribe();
    errors.publish(report);

    expect(stream.name).toBe('errors');
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(report);
    expect(stream.serializeForLogging(report)).toEqual(report);
    expect(
      stream.serializeForLogging({
        source: 'test',
        message: 'detailed',
        error: new Error('failed'),
        metadata: { operation: 'write' },
      }),
    ).toEqual({
      source: 'test',
      message: 'detailed',
      error: expect.any(Error),
      metadata: { operation: 'write' },
    });
  });
});
