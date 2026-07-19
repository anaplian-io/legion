import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteEventStream } from './concrete-event-stream.js';
import { Node, NodeStatus } from '../types/node.js';
import {
  SubscribeNodeStatusChange,
  SubscribeOrchestratorNodesChanged,
  PublishProps,
} from '../types/event-stream.js';
import { ConcreteErrorStream } from './concrete-error-stream.js';
import type { LoggableStream, LogRouter } from '../types/logging.js';

describe('ConcreteEventStream', () => {
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    eventStream = new ConcreteEventStream();
  });

  it('should publish and receive events on the same topic', () => {
    const receivedData: string[] = [];
    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: (data) => {
        receivedData.push(data.nodeId);
      },
    });

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'hello', status: 'idle' },
    });
    expect(receivedData).toEqual(['hello']);
  });

  it('should handle multiple subscribers on the same topic', () => {
    const receivedBy1: string[] = [];
    const receivedBy2: string[] = [];

    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: (data) => {
        receivedBy1.push(data.nodeId);
      },
    });
    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: (data) => {
        receivedBy2.push(data.nodeId);
      },
    });

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'node1', status: 'idle' },
    });

    expect(receivedBy1).toEqual(['node1']);
    expect(receivedBy2).toEqual(['node1']);
  });

  it('should create new subscription set when subscribing to a new topic', () => {
    const receivedData: string[] = [];

    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: (data) => {
        receivedData.push(data.nodeId);
      },
    });

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'first', status: 'idle' },
    });
    expect(receivedData).toEqual(['first']);
  });

  it('should handle subscribers that return promises', () => {
    const receivedData: string[] = [];

    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: (data) => {
        receivedData.push(data.nodeId);
      },
    });

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'async', status: 'idle' },
    });

    expect(receivedData).toEqual(['async']);
  });

  it('should not throw when publishing to a topic with no subscribers', () => {
    expect(() => {
      eventStream.publish({
        topicName: 'orchestrator/nodes-changed',
        data: { allNodes: [] },
      });
    }).not.toThrow();
  });

  it('should handle subscriber throwing an error without breaking other subscribers', async () => {
    const errors: unknown[] = [];
    const errorStream = new ConcreteErrorStream();
    errorStream.subscribe((error) => errors.push(error));
    eventStream = new ConcreteEventStream({ errorStream });
    const receivedByFirst = vi.fn(() => {
      throw new Error('First subscriber failed');
    });

    const receivedBySecond = vi.fn();

    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: receivedByFirst,
    });
    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: receivedBySecond,
    });

    expect(() => {
      eventStream.publish({
        topicName: 'node/status-change',
        data: { nodeId: 'test', status: 'idle' },
      });
    }).not.toThrow();

    expect(receivedByFirst).toHaveBeenCalledWith({
      nodeId: 'test',
      status: 'idle',
    });
    expect(receivedBySecond).toHaveBeenCalledWith({
      nodeId: 'test',
      status: 'idle',
    });
    expect(errors).toEqual([
      {
        source: 'EventStream',
        message: 'A subscriber for topic "node/status-change" threw.',
        error: expect.any(Error),
      },
    ]);
  });

  it('reports asynchronous subscriber rejections without blocking publication', async () => {
    const reports: unknown[] = [];
    const errorStream = new ConcreteErrorStream();
    errorStream.subscribe((report) => reports.push(report));
    eventStream = new ConcreteEventStream({ errorStream });
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: async () => {
        throw new Error('async failure');
      },
    });

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'async', status: 'idle' },
    });
    await Promise.resolve();

    expect(reports).toEqual([
      {
        source: 'EventStream',
        message:
          'An asynchronous subscriber for topic "node/status-change" rejected.',
        error: expect.any(Error),
      },
    ]);
  });

  it('automatically registers an all-event logging consumer', () => {
    let loggedStream: LoggableStream<PublishProps> | undefined;
    const router: LogRouter = {
      consume: (stream) => {
        loggedStream = stream as unknown as LoggableStream<PublishProps>;
      },
    };
    eventStream = new ConcreteEventStream({ logRouter: router });

    expect(loggedStream?.name).toBe('events');
    const received = vi.fn();
    loggedStream?.subscribeForLogging(received);
    eventStream.publish({
      topicName: 'system/notice',
      data: { message: 'ready' },
    });
    expect(received).toHaveBeenCalledWith({
      topicName: 'system/notice',
      data: { message: 'ready' },
    });
    expect(
      loggedStream?.serializeForLogging({
        topicName: 'system/notice',
        data: { message: 'ready' },
      }),
    ).toEqual({
      topicName: 'system/notice',
      data: { message: 'ready' },
    });

    const node = {
      id: 'node-1',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: 'focused context',
      sendMessage: async () => undefined,
    };
    expect(
      loggedStream?.serializeForLogging({
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
      loggedStream?.serializeForLogging({
        topicName: 'orchestrator/node-added',
        data: { addedNodes: [node] },
      }),
    ).toMatchObject({
      data: { addedNodes: [{ id: 'node-1' }] },
    });
    expect(
      loggedStream?.serializeForLogging({
        topicName: 'orchestrator/node-updated',
        data: { node },
      }),
    ).toMatchObject({ data: { node: { id: 'node-1' } } });
  });

  it('forwards explicitly reported errors to its configured error stream', () => {
    const received = vi.fn();
    const errorStream = new ConcreteErrorStream();
    errorStream.subscribe(received);
    eventStream = new ConcreteEventStream({ errorStream });

    eventStream.reportError({ source: 'test', message: 'explicit failure' });

    expect(received).toHaveBeenCalledWith({
      source: 'test',
      message: 'explicit failure',
    });
  });

  it('should pass correct data types for node/status-change topic', () => {
    const received: Array<{ nodeId: string; status: NodeStatus }> = [];

    eventStream.subscribe(<SubscribeNodeStatusChange>{
      topicName: 'node/status-change',
      receiver: (data) => {
        received.push(data);
      },
    });

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'node-1', status: 'idle' },
    });

    expect(received).toEqual([{ nodeId: 'node-1', status: 'idle' }]);
  });

  it('should pass correct data types for orchestrator/nodes-changed topic', () => {
    const received: Array<{ allNodes: Node<string>[] }> = [];

    eventStream.subscribe(<SubscribeOrchestratorNodesChanged>{
      topicName: 'orchestrator/nodes-changed',
      receiver: (data) => {
        received.push(data);
      },
    });

    const nodes: Node<string>[] = [
      {
        id: 'node-1',
        kind: 'memory' as const,
        status: 'idle',
        context: '',
        sendMessage: async () => undefined,
      },
      {
        id: 'node-2',
        kind: 'memory' as const,
        status: 'idle',
        context: '',
        sendMessage: async () => undefined,
      },
    ];

    eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: nodes },
    });

    expect(received).toEqual([{ allNodes: nodes }]);
  });
});
