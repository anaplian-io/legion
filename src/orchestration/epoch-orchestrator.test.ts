import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EpochOrchestrator } from './epoch-orchestrator.js';
import type { RelevanceFilter } from '../types/relevance-filter.js';
import type { Provider } from '../types/provider.js';
import type { Node, BroadcastMessage, NodeResponse } from '../types/node.js';
import type { WorkingMemory } from '../types/working-memory.js';
import { Distiller } from '../types/distiller.js';
import type { MemoryNodeFactory } from '../types/memory-node-factory.js';
import type { NodeSplitter } from '../types/node-splitter.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import { SubscribeOrchestratorNodesChanged } from '../types/event-stream.js';

// Type alias for test file
type TestDistiller = Distiller;
type TestMemoryNodeSplitter = NodeSplitter<'memory'>;

describe('EpochOrchestrator', () => {
  let mockProvider: Provider;
  let mockRelevanceFilter: RelevanceFilter;
  let mockDistiller: TestDistiller;
  let mockMemoryNodeFactory: MemoryNodeFactory;
  let mockMemoryNodeSplitter: TestMemoryNodeSplitter;
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
    };
    mockRelevanceFilter = {
      filter: vi.fn(),
    };
    mockDistiller = {
      distill: vi.fn(),
    };
    mockMemoryNodeFactory = {
      create: vi.fn(),
    };
    mockMemoryNodeSplitter = {
      split: vi.fn(),
    };
    eventStream = new ConcreteEventStream();
  });

  it('should create an orchestrator with initial working memory', () => {
    const initialWM: WorkingMemory = { messages: [{ content: 'Initial' }] };

    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialWorkingMemory: initialWM,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    expect(orchestrator.nodes).toEqual([]);
  });

  it('should create an orchestrator with empty working memory by default', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    expect(orchestrator.workingMemory.messages).toEqual([]);
  });

  it('should use custom max working memory messages', () => {
    const initialWM: WorkingMemory = { messages: [] };
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 5,
      initialWorkingMemory: initialWM,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    expect(orchestrator.workingMemory.messages).toEqual([]);
  });

  it('should add nodes by id', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a');
    const nodeB = createMockNode('node-b');

    orchestrator.addNode(nodeA);
    orchestrator.addNode(nodeB);

    expect(orchestrator.nodes).toEqual([nodeA, nodeB]);
  });

  it('should remove nodes by id', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a');
    const nodeB = createMockNode('node-b');

    orchestrator.addNode(nodeA);
    orchestrator.addNode(nodeB);

    orchestrator.removeNode('node-a');

    expect(orchestrator.nodes).toEqual([nodeB]);
  });

  it('should publish nodes-changed event when adding nodes', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    let addedNodeId: string | undefined;
    eventStream.subscribe(<SubscribeOrchestratorNodesChanged>{
      topicName: 'orchestrator/nodes-changed',
      receiver: (data) => {
        const nodes = data.allNodes;
        if (nodes.length === 1) {
          addedNodeId = nodes[0]!.id;
        }
      },
    });

    const nodeA = createMockNode('node-a');
    orchestrator.addNode(nodeA);

    expect(addedNodeId).toEqual('node-a');
  });

  it('should publish nodes-changed event when removing nodes', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    let removedNodeId: string | undefined;
    eventStream.subscribe(<SubscribeOrchestratorNodesChanged>{
      topicName: 'orchestrator/nodes-changed',
      receiver: (data) => {
        const nodes = data.allNodes;
        if (nodes.length === 0) {
          removedNodeId = 'node-a';
        }
      },
    });

    orchestrator.addNode(createMockNode('node-a'));
    orchestrator.removeNode('node-a');

    expect(removedNodeId).toEqual('node-a');
  });

  it('should update working memory when running epoch', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      originatingNodeId: 'node-a',
      content: 'Response',
    }));

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      { content: 'Response', originatingNodeId: 'node-a' },
    ]);
    // First distillation produces 'New insight' (broadcast for next epoch)
    // The previous broadcast ('Initial broadcast') goes to WM as history
    vi.mocked(mockDistiller.distill).mockResolvedValue('New insight');

    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toHaveLength(1);
    // Working memory gets the initial broadcast as history
    expect(orchestrator.workingMemory.messages[0]?.content).toBe(
      'Initial broadcast',
    );
    // The next broadcast is set to the distilled content
    expect(orchestrator.currentBroadcast.content).toBe('New insight');
  });

  it('should handle adding multiple nodes with same id (overwrites)', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a');
    const nodeAUpdated = createMockNode('node-a');

    orchestrator.addNode(nodeA);
    orchestrator.addNode(nodeAUpdated);

    expect(orchestrator.nodes).toEqual([nodeAUpdated]);
    expect(orchestrator.nodes.length).toBe(1);
  });

  it('should run an epoch with one node that responds', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      originatingNodeId: 'node-a',
      content: 'Node A response',
    }));

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      { content: 'Node A response', originatingNodeId: 'node-a' },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Distilled insight');

    await orchestrator.runEpoch();

    expect(mockRelevanceFilter.filter).toHaveBeenCalled();
    expect(mockDistiller.distill).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcasts: expect.arrayContaining(['Node A response']),
      }),
    );
    expect(orchestrator.workingMemory.messages).toHaveLength(1);
    // Working memory gets the initial broadcast as history
    expect(orchestrator.workingMemory.messages[0]?.content).toBe(
      'Initial broadcast',
    );
  });

  it('should handle empty candidate messages', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => undefined);
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    orchestrator.addNode(nodeA);

    // When no responses, filter is called with empty array and returns empty
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);

    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toHaveLength(0);
    expect(mockRelevanceFilter.filter).toHaveBeenCalled();
    // A new node should be spawned using the factory (when all filtered messages are empty)
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Initial broadcast',
      eventStream,
    });
  });

  it('should handle empty filtered messages', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      originatingNodeId: 'node-a',
      content: 'Response',
    }));

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);
    // Mock the factory to return a new node when spawned
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toHaveLength(0);
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Initial broadcast',
      eventStream,
    });
  });

  it('should apply rolling window to working memory', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 3,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      originatingNodeId: 'node-a',
      content: 'Response',
    }));

    orchestrator.addNode(nodeA);

    // Fill working memory to max (3 epochs)
    for (let i = 0; i < 3; i++) {
      vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
        { content: 'Response', originatingNodeId: 'node-a' },
      ]);
      vi.mocked(mockDistiller.distill).mockResolvedValue(`Distilled ${i}`);
      await orchestrator.runEpoch();
    }

    // WM should contain: ['Initial broadcast', 'Distilled 0', 'Distilled 1']
    expect(orchestrator.workingMemory.messages).toHaveLength(3);
    expect(orchestrator.workingMemory.messages[0]?.content).toBe(
      'Initial broadcast',
    );

    // One more epoch should trigger pruning
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      { content: 'Response', originatingNodeId: 'node-a' },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Distilled 3');
    await orchestrator.runEpoch();

    // WM now has 4 messages, prunes to 3
    // Removes 'Initial broadcast', keeps ['Distilled 0', 'Distilled 1', 'Distilled 2']
    expect(orchestrator.workingMemory.messages).toHaveLength(3);
    expect(orchestrator.workingMemory.messages[0]?.content).toBe('Distilled 0');
    expect(orchestrator.workingMemory.messages[1]?.content).toBe('Distilled 1');
    expect(orchestrator.workingMemory.messages[2]?.content).toBe('Distilled 2');
  });

  it('should broadcast initial broadcast to nodes', async () => {
    const initialWM: WorkingMemory = {
      messages: [{ content: 'First message' }, { content: 'Second message' }],
    };

    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialWorkingMemory: initialWM,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const sendMessageSpy = vi.fn();
    sendMessageSpy.mockResolvedValue({
      originatingNodeId: 'node-a',
      content: 'Response',
    });

    const nodeA: Node<'memory'> = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle',
      context: 'Context for node-a',
      sendMessage: sendMessageSpy,
    };

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      { content: 'Response', originatingNodeId: 'node-a' },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Insight');

    await orchestrator.runEpoch();

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcast: expect.objectContaining({
          content: 'Initial broadcast',
        }),
      }),
    );
  });

  it('should spawn a new node when all candidates return undefined', async () => {
    const initialWM: WorkingMemory = {
      messages: [{ content: 'Existing message' }],
    };
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      initialWorkingMemory: initialWM,
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => undefined);
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    orchestrator.addNode(nodeA);

    // Filter returns empty when all candidates are filtered out
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);

    // Verify no nodes spawned initially (only node-a)
    expect(orchestrator.nodes).toHaveLength(1);

    await orchestrator.runEpoch();

    // Should have spawned a new memory node using factory with existing WM content
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Existing message',
      eventStream,
    });
    // Now should have 2 nodes: node-a and the new one from factory
    expect(orchestrator.nodes).toHaveLength(2);
  });

  it('should split nodes when context exceeds threshold', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: { content: 'Initial broadcast' },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 10, // Small threshold to trigger split
      memoryNodeSplitter: mockMemoryNodeSplitter,
      eventStream,
    });

    const longContext = 'A'.repeat(50); // Exceeds threshold
    const nodeA: Node<'memory'> = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle',
      context: longContext,
      sendMessage: vi.fn(),
    };

    orchestrator.addNode(nodeA);
    expect(orchestrator.nodes).toHaveLength(1);

    // Mock split to return two new nodes
    const newNodeA = createMockNode('node-a-left');
    const newNodeB = createMockNode('node-a-right');
    vi.mocked(mockMemoryNodeSplitter.split).mockResolvedValue([
      newNodeA,
      newNodeB,
    ]);

    // Set up mock responses for the epoch
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      { content: 'Response', originatingNodeId: 'node-a' },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Insight');

    await orchestrator.runEpoch();

    // Original node should be removed, replaced by two split nodes
    expect(orchestrator.nodes).toHaveLength(2);
    expect(orchestrator.nodes.map((n) => n.id)).toEqual([
      'node-a-left',
      'node-a-right',
    ]);
    expect(mockMemoryNodeSplitter.split).toHaveBeenCalledWith(nodeA);
  });
});

function createMockNode(
  id: string,
  sendMessageFn?: (broadcast: BroadcastMessage) => Promise<NodeResponse>,
): Node<'memory'> {
  const sendMessage = sendMessageFn ?? vi.fn().mockResolvedValue(undefined);
  return {
    id,
    kind: 'memory' as const,
    status: 'idle',
    context: `Context for ${id}`,
    sendMessage,
  };
}
