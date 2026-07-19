import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeRegistry } from './node-registry.js';
import { ConcreteEventStream } from './concrete-event-stream.js';
import type { Node } from '../types/node.js';

const memoryNode = (id: string): Node<'memory'> => ({
  id,
  kind: 'memory',
  status: 'idle',
  context: `context-${id}`,
  sendMessage: vi.fn(),
});

const toolNode = (id: string): Node<'tool'> => ({
  id,
  kind: 'tool',
  status: 'idle',
  context: '',
  sendMessage: vi.fn(),
});

describe('NodeRegistry', () => {
  let eventStream: ConcreteEventStream;
  let registry: NodeRegistry;

  beforeEach(() => {
    eventStream = new ConcreteEventStream();
    registry = new NodeRegistry(eventStream);
  });

  it('registers nodes and seeds zeroed stats', () => {
    registry.register(memoryNode('a'));

    expect(registry.all().map((n) => n.id)).toEqual(['a']);
    expect(registry.stats().get('a')).toEqual({
      epochsAlive: 0,
      epochsGenerated: 0,
      epochsPassedAttention: 0,
      epochsSelected: 0,
    });
  });

  it('does not reset stats when re-registering an existing id', () => {
    registry.register(memoryNode('a'));
    registry.recordEpoch({
      aliveNodeIds: ['a'],
      generatedNodeIds: new Set(['a']),
      attentionPassingNodeIds: new Set(['a']),
      selectedNodeIds: new Set(['a']),
    });

    registry.register(memoryNode('a'));

    expect(registry.stats().get('a')).toEqual({
      epochsAlive: 1,
      epochsGenerated: 1,
      epochsPassedAttention: 1,
      epochsSelected: 1,
    });
  });

  it('unregisters nodes and drops their stats', () => {
    registry.register(memoryNode('a'));
    registry.unregister('a');

    expect(registry.all()).toEqual([]);
    expect(registry.stats().has('a')).toBe(false);
  });

  it('exposes only memory nodes via memoryNodes()', () => {
    registry.register(memoryNode('mem'));
    registry.register(toolNode('tool'));

    expect(registry.memoryNodes().map((n) => n.id)).toEqual(['mem']);
  });

  it('publishes lifecycle events on register and unregister', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const changedSizes: number[] = [];
    eventStream.subscribe({
      topicName: 'orchestrator/node-added',
      receiver: (data) => {
        added.push(...data.addedNodes.map((n) => n.id));
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/node-removed',
      receiver: (data) => {
        removed.push(...data.removedNodeIds);
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/nodes-changed',
      receiver: (data) => {
        changedSizes.push(data.allNodes.length);
      },
    });

    registry.register(memoryNode('a'));
    registry.unregister('a');

    expect(added).toEqual(['a']);
    expect(removed).toEqual(['a']);
    expect(changedSizes).toEqual([1, 0]);
  });

  it('records generated/attention/selected participation and publishes stats', () => {
    registry.register(memoryNode('speaker'));
    registry.register(memoryNode('silent'));
    registry.register(memoryNode('filtered'));

    let published: Array<{ nodeId: string }> | undefined;
    eventStream.subscribe({
      topicName: 'orchestrator/node-stats-updated',
      receiver: (data) => {
        published = data.nodeStats;
      },
    });

    registry.recordEpoch({
      aliveNodeIds: ['speaker', 'silent', 'filtered'],
      generatedNodeIds: new Set(['speaker', 'filtered']),
      attentionPassingNodeIds: new Set(['speaker']),
      selectedNodeIds: new Set(['speaker']),
    });

    const stats = registry.stats();
    expect(stats.get('speaker')).toEqual({
      epochsAlive: 1,
      epochsGenerated: 1,
      epochsPassedAttention: 1,
      epochsSelected: 1,
    });
    expect(stats.get('silent')).toEqual({
      epochsAlive: 1,
      epochsGenerated: 0,
      epochsPassedAttention: 0,
      epochsSelected: 0,
    });
    expect(stats.get('filtered')).toEqual({
      epochsAlive: 1,
      epochsGenerated: 1,
      epochsPassedAttention: 0,
      epochsSelected: 0,
    });
    expect(published).toHaveLength(3);
  });

  it('seeds stats for an alive id that was never registered', () => {
    // Defensive contract: recordEpoch tolerates an unknown id by treating it as
    // zero-based rather than throwing.
    registry.recordEpoch({
      aliveNodeIds: ['ghost'],
      generatedNodeIds: new Set(['ghost']),
      attentionPassingNodeIds: new Set(),
      selectedNodeIds: new Set(),
    });

    expect(registry.stats().get('ghost')).toEqual({
      epochsAlive: 1,
      epochsGenerated: 1,
      epochsPassedAttention: 0,
      epochsSelected: 0,
    });
  });
});
