import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcreteEventStream } from './concrete-event-stream.js';
import { Node, NodeStatus } from '../types/node.js';
import {
  SubscribeNodeStatusChange,
  SubscribeOrchestratorNodesChanged,
} from '../types/event-stream.js';

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
