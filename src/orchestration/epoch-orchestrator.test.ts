import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EpochOrchestrator } from './epoch-orchestrator.js';
import type { RelevanceFilter } from '../types/relevance-filter.js';
import type { Provider } from '../types/provider.js';
import type { Node, BroadcastMessage, NodeResponse } from '../types/node.js';
import type { WorkingMemory } from '../types/working-memory.js';
import { Distiller } from '../types/distiller.js';
import type { MemoryNodeFactory } from '../types/memory-node-factory.js';
import type { MemoryNode } from '../node/memory-node.js';
import type { NodeSplitter } from '../types/node-splitter.js';
import type { NodePruner } from '../types/node-pruner.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import { SubscribeOrchestratorNodesChanged } from '../types/event-stream.js';
import { UserInputSensor } from '../sensor/user-input-sensor.js';
import { SensoryNode } from '../node/sensory-node.js';

type TestDistiller = Distiller;
type TestMemoryNodeSplitter = NodeSplitter<'memory'>;

describe('EpochOrchestrator', () => {
  let mockProvider: Provider;
  let mockRelevanceFilter: RelevanceFilter;
  let mockDistiller: TestDistiller;
  let mockMemoryNodeFactory: MemoryNodeFactory;
  let mockMemoryNodeSplitter: TestMemoryNodeSplitter;
  let mockNodePruner: NodePruner;
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
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
    // Default: prune nothing, so existing tests observe unchanged behavior.
    mockNodePruner = {
      selectForPruning: vi.fn().mockReturnValue([]),
    };
    eventStream = new ConcreteEventStream();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('should create an orchestrator with initial working memory', () => {
    const initialWM: WorkingMemory = {
      messages: [{ role: 'working-memory' as const, content: 'Initial' }],
    };

    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialWorkingMemory: initialWM,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    expect(orchestrator.nodes).toEqual([]);
    expect(orchestrator.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'Initial' },
    ]);
    expect(orchestrator.currentBroadcast.content).toBe('Initial broadcast');
  });

  it('should create an orchestrator with initial nodes', () => {
    const nodeA = createMockNode('node-a');
    const nodeB = createMockNode('node-b');

    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
      initialNodes: [nodeA, nodeB],
    });

    expect(orchestrator.nodes).toEqual([nodeA, nodeB]);
  });

  it('should track the initial broadcast separately from working memory', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    expect(orchestrator.workingMemory.messages).toEqual([]);
    expect(orchestrator.currentBroadcast.content).toBe('Initial broadcast');
  });

  it('should use custom max working memory messages', () => {
    const initialWM: WorkingMemory = { messages: [] };
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 5,
      initialWorkingMemory: initialWM,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      role: 'node-response' as const,
      originatingNodeId: 'node-a',
      content: 'Response',
    }));

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
    // First distillation produces both the next broadcast and the new
    // working-memory entry.
    vi.mocked(mockDistiller.distill).mockResolvedValue('New insight');

    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'Initial broadcast' },
    ]);
    // The next broadcast is set to the distilled content
    expect(orchestrator.currentBroadcast.content).toBe('New insight');
  });

  it('should use the sending node id when a response omits originatingNodeId', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast',
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    orchestrator.addNode(
      createMockNode('node-a', async () => ({
        role: 'node-response',
        content: 'Response',
      })),
    );

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('insight');

    await orchestrator.runEpoch();

    expect(mockRelevanceFilter.filter).toHaveBeenCalledWith(expect.anything(), [
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
  });

  it('should handle adding multiple nodes with same id (overwrites)', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      role: 'node-response' as const,
      originatingNodeId: 'node-a',
      content: 'Node A response',
    }));

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Node A response',
        originatingNodeId: 'node-a',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Distilled insight');

    await orchestrator.runEpoch();

    expect(mockRelevanceFilter.filter).toHaveBeenCalled();
    expect(mockDistiller.distill).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcasts: expect.arrayContaining(['Node A response']),
      }),
    );
    expect(orchestrator.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'Initial broadcast' },
    ]);
  });

  it('should handle empty candidate messages', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => undefined);
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    orchestrator.addNode(nodeA);

    // When no responses, filter is called with empty array and returns empty
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);

    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toEqual([]);
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
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      role: 'node-response' as const,
      originatingNodeId: 'node-a',
      content: 'Response',
    }));

    orchestrator.addNode(nodeA);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);
    // Mock the factory to return a new node when spawned
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toEqual([]);
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Initial broadcast',
      eventStream,
    });
  });

  it('should accumulate per-node stats across epochs', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    orchestrator.addNode(
      createMockNode('speaker', async () => ({
        role: 'node-response' as const,
        originatingNodeId: 'speaker',
        content: 'kept',
      })),
    );
    orchestrator.addNode(createMockNode('silent', async () => undefined));
    orchestrator.addNode(
      createMockNode('filtered', async () => ({
        role: 'node-response' as const,
        originatingNodeId: 'filtered',
        content: 'dropped',
      })),
    );

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'kept',
        originatingNodeId: 'speaker',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('insight');

    await orchestrator.runEpoch();

    const stats = orchestrator.nodeStats;
    expect(stats.get('speaker')).toEqual({
      epochsAlive: 1,
      epochsSpoken: 1,
      epochsFiltered: 0,
    });
    expect(stats.get('silent')).toEqual({
      epochsAlive: 1,
      epochsSpoken: 0,
      epochsFiltered: 0,
    });
    expect(stats.get('filtered')).toEqual({
      epochsAlive: 1,
      epochsSpoken: 1,
      epochsFiltered: 1,
    });
  });

  it('should publish a node-stats-updated event each epoch', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    orchestrator.addNode(
      createMockNode('node-a', async () => ({
        role: 'node-response' as const,
        originatingNodeId: 'node-a',
        content: 'Response',
      })),
    );

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('insight');

    let published: Array<{ nodeId: string }> | undefined;
    eventStream.subscribe({
      topicName: 'orchestrator/node-stats-updated',
      receiver: (data) => {
        published = data.nodeStats;
      },
    });

    await orchestrator.runEpoch();

    expect(published).toEqual([
      {
        nodeId: 'node-a',
        stats: { epochsAlive: 1, epochsSpoken: 1, epochsFiltered: 0 },
      },
    ]);
  });

  it('should pass restored node stats into each polled node', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      role: 'node-response' as const,
      originatingNodeId: 'node-a',
      content: 'Response',
    });
    const node = createMockNode('node-a', sendMessage);
    const restoredStats = {
      epochsAlive: 3,
      epochsSpoken: 2,
      epochsFiltered: 1,
    };
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
      initialNodes: [node],
      initialNodeStats: new Map([['node-a', restoredStats]]),
    });
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('insight');

    await orchestrator.runEpoch();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientNodeStats: restoredStats,
      }),
    );
  });

  it('should prune nodes selected by the pruner and drop their stats', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const speaker = createMockNode('speaker', async () => ({
      role: 'node-response' as const,
      originatingNodeId: 'speaker',
      content: 'kept',
    }));
    const deadweight = createMockNode('deadweight', async () => undefined);
    orchestrator.addNode(speaker);
    orchestrator.addNode(deadweight);

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'kept',
        originatingNodeId: 'speaker',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('insight');
    vi.mocked(mockNodePruner.selectForPruning).mockReturnValue([
      deadweight as unknown as MemoryNode,
    ]);

    await orchestrator.runEpoch();

    expect(mockNodePruner.selectForPruning).toHaveBeenCalled();
    expect(orchestrator.nodes.map((n) => n.id)).toEqual(['speaker']);
    expect(orchestrator.nodeStats.has('deadweight')).toBe(false);
  });

  it('should apply rolling window to working memory', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 3,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => ({
      role: 'node-response' as const,
      originatingNodeId: 'node-a',
      content: 'Response',
    }));

    orchestrator.addNode(nodeA);

    // Fill working memory to max (3 epochs)
    for (let i = 0; i < 3; i++) {
      vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
        {
          role: 'node-response',
          content: 'Response',
          originatingNodeId: 'node-a',
        },
      ]);
      vi.mocked(mockDistiller.distill).mockResolvedValue(`Distilled ${i}`);
      await orchestrator.runEpoch();
    }

    // WM contains the three broadcasts that have rolled out of the current
    // broadcast slot. Distilled 2 is still current after the third epoch.
    expect(orchestrator.workingMemory.messages).toHaveLength(3);
    expect(orchestrator.workingMemory.messages[0]?.content).toBe(
      'Initial broadcast',
    );
    expect(orchestrator.workingMemory.messages[1]?.content).toBe('Distilled 0');
    expect(orchestrator.workingMemory.messages[2]?.content).toBe('Distilled 1');

    // One more epoch should roll Distilled 2 into memory and evict Initial.
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Distilled 3');
    await orchestrator.runEpoch();

    expect(orchestrator.workingMemory.messages).toHaveLength(3);
    expect(orchestrator.workingMemory.messages[0]?.content).toBe('Distilled 0');
    expect(orchestrator.workingMemory.messages[1]?.content).toBe('Distilled 1');
    expect(orchestrator.workingMemory.messages[2]?.content).toBe('Distilled 2');
    expect(orchestrator.currentBroadcast.content).toBe('Distilled 3');
  });

  it('should broadcast initial broadcast to nodes', async () => {
    const initialWM: WorkingMemory = {
      messages: [
        { role: 'working-memory', content: 'First message' },
        { role: 'working-memory', content: 'Second message' },
      ],
    };

    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialWorkingMemory: initialWM,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const sendMessageSpy = vi.fn();
    sendMessageSpy.mockResolvedValue({
      role: 'node-response' as const,
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
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
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

  it('should receive user input without mutating the global workspace broadcast', () => {
    const userInputSensor = new UserInputSensor();
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
      userInputSensor,
    });

    let receivedInput: string | undefined;
    eventStream.subscribe({
      topicName: 'orchestrator/user-input-received',
      receiver: (data) => {
        receivedInput = data.content;
      },
    });

    orchestrator.receiveUserInput('User typed this');

    expect(orchestrator.currentBroadcast.content).toBe('Initial broadcast');
    expect(receivedInput).toBe('User typed this');
  });

  it('should ignore empty user input without publishing an event', () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const receiver = vi.fn();
    eventStream.subscribe({
      topicName: 'orchestrator/user-input-received',
      receiver,
    });

    orchestrator.receiveUserInput('  ');

    expect(receiver).not.toHaveBeenCalled();
    expect(orchestrator.currentBroadcast.content).toBe('Initial broadcast');
  });

  it('should deliver queued user input as afferent context on the next epoch', async () => {
    const userInputSensor = new UserInputSensor();
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
      userInputSensor,
    });

    orchestrator.addNode(
      new SensoryNode({
        id: 'sensor-user-input',
        provider: mockProvider,
        eventStream,
        sensor: userInputSensor,
        responseRole: 'user-input',
        capabilityDescription: 'can provide queued user input.',
      }),
    );
    const sendMessageSpy = vi.fn();
    sendMessageSpy.mockResolvedValue({
      role: 'node-response' as const,
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
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Distilled insight');

    orchestrator.receiveUserInput('Hello workspace');
    await orchestrator.runEpoch();

    // The global workspace remains the existing broadcast while user input is
    // delivered through afferent context.
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcast: expect.objectContaining({ content: 'Initial broadcast' }),
        afferentContext: [
          {
            role: 'afferent-capability',
            content:
              'Available afferent capabilities:\n- sensor-user-input: can provide queued user input.',
          },
          {
            role: 'user-input',
            content: 'Hello workspace',
            originatingNodeId: 'sensor-user-input',
          },
        ],
      }),
    );
    expect(mockDistiller.distill).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcasts: ['Response'],
        afferentContext: [
          {
            role: 'afferent-capability',
            content:
              'Available afferent capabilities:\n- sensor-user-input: can provide queued user input.',
          },
          {
            role: 'user-input',
            content: 'Hello workspace',
            originatingNodeId: 'sensor-user-input',
          },
        ],
      }),
    );
    expect(orchestrator.currentBroadcast.content).toBe('Distilled insight');
  });

  it('should deliver multiple queued user inputs once in FIFO order', async () => {
    const userInputSensor = new UserInputSensor();
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
      userInputSensor,
    });

    orchestrator.addNode(
      new SensoryNode({
        id: 'sensor-user-input',
        provider: mockProvider,
        eventStream,
        sensor: userInputSensor,
        responseRole: 'user-input',
        capabilityDescription: 'can provide queued user input.',
      }),
    );
    const memorySend = vi.fn().mockResolvedValue({
      role: 'node-response' as const,
      originatingNodeId: 'mem',
      content: 'Memory response',
    });
    orchestrator.addNode(createMockNode('mem', memorySend));
    const consumedInputs: string[] = [];
    eventStream.subscribe({
      topicName: 'orchestrator/user-input-consumed',
      receiver: ({ content }) => {
        consumedInputs.push(content);
      },
    });

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Memory response',
        originatingNodeId: 'mem',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('Distilled insight');

    orchestrator.receiveUserInput('first');
    orchestrator.receiveUserInput('second');
    await orchestrator.runEpoch();
    await orchestrator.runEpoch();

    expect(consumedInputs).toEqual(['first', 'second']);
    expect(memorySend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        afferentContext: expect.arrayContaining([
          {
            role: 'user-input',
            content: 'first',
            originatingNodeId: 'sensor-user-input',
          },
        ]),
      }),
    );
    expect(memorySend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        afferentContext: expect.arrayContaining([
          {
            role: 'user-input',
            content: 'second',
            originatingNodeId: 'sensor-user-input',
          },
        ]),
      }),
    );
  });

  it('should spawn a new node when all candidates return undefined', async () => {
    const initialWM: WorkingMemory = {
      messages: [
        { role: 'working-memory' as const, content: 'Existing message' },
      ],
    };
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      initialWorkingMemory: initialWM,
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
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

    // Should have spawned a new memory node using WM plus the current broadcast.
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Existing message\nInitial broadcast',
      eventStream,
    });
    // Now should have 2 nodes: node-a and the new one from factory
    expect(orchestrator.nodes).toHaveLength(2);
  });

  it('should spawn a new node with initial broadcast when working memory is empty', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast content',
      },
      initialWorkingMemory: { messages: [] }, // Empty working memory
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA = createMockNode('node-a', async () => undefined);
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    orchestrator.addNode(nodeA);

    // Filter returns empty when all candidates are filtered out
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);

    await orchestrator.runEpoch();

    // Should have spawned a new memory node using factory with initial broadcast content
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Initial broadcast content',
      eventStream,
    });
    expect(orchestrator.nodes).toHaveLength(2);
  });

  it('should split nodes when context exceeds threshold', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 10, // Small threshold to trigger split
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const longContext = 'A'.repeat(50); // Exceeds threshold
    const nodeA: Node<'memory'> = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle',
      context: longContext,
      sendMessage: vi.fn().mockResolvedValue({
        role: 'node-response' as const,
        originatingNodeId: 'node-a',
        content: 'Response',
      }),
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
      {
        role: 'node-response',
        content: 'Response',
        originatingNodeId: 'node-a',
      },
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

  it('should feed afferent (tool/sensor) output to memory nodes as context, not as broadcast candidates', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const toolNode: Node<'tool'> = {
      id: 'tool-node',
      kind: 'tool' as const,
      status: 'idle',
      context: 'Tool context',
      capabilityDescription: 'can search the web for current information.',
      sendMessage: vi.fn().mockResolvedValue({
        role: 'node-response' as const,
        originatingNodeId: 'tool-node',
        content: 'Tool response',
      }),
    };
    const memorySend = vi.fn().mockResolvedValue({
      role: 'node-response' as const,
      originatingNodeId: 'mem',
      content: 'Memory response',
    });
    orchestrator.addNode(toolNode);
    orchestrator.addNode(createMockNode('mem', memorySend));

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content: 'Memory response',
        originatingNodeId: 'mem',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('insight');

    await orchestrator.runEpoch();

    // The memory node receives the tool output as afferentContext.
    expect(memorySend).toHaveBeenCalledWith(
      expect.objectContaining({
        afferentContext: [
          {
            role: 'afferent-capability',
            content:
              'Available afferent capabilities:\n- tool-node: can search the web for current information.',
          },
          {
            role: 'afferent',
            content: 'Tool response',
            originatingNodeId: 'tool-node',
          },
        ],
      }),
    );
    // Only the memory output reaches the relevance filter; the tool output is
    // never a broadcast candidate.
    expect(mockRelevanceFilter.filter).toHaveBeenCalledWith(expect.anything(), [
      {
        role: 'node-response',
        content: 'Memory response',
        originatingNodeId: 'mem',
      },
    ]);
    // A memory node responded, so no spawn is needed.
    expect(mockMemoryNodeFactory.create).not.toHaveBeenCalled();
  });

  it('should feed afferent capabilities to memory nodes even when afferent nodes are silent', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const toolNode: Node<'tool'> = {
      id: 'ddg-search',
      kind: 'tool' as const,
      status: 'idle',
      context: '',
      capabilityDescription:
        'can search the web for current/local information, forecasts, events, and linked sources.',
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const memorySend = vi.fn().mockResolvedValue({
      role: 'node-response' as const,
      originatingNodeId: 'mem',
      content:
        'Search the web for Brooklyn NY weather next few days and nearby events.',
    });
    orchestrator.addNode(toolNode);
    orchestrator.addNode(createMockNode('mem', memorySend));

    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        content:
          'Search the web for Brooklyn NY weather next few days and nearby events.',
        originatingNodeId: 'mem',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('search request');

    await orchestrator.runEpoch();

    expect(memorySend).toHaveBeenCalledWith(
      expect.objectContaining({
        afferentContext: [
          {
            role: 'afferent-capability',
            content:
              'Available afferent capabilities:\n- ddg-search: can search the web for current/local information, forecasts, events, and linked sources.',
          },
        ],
      }),
    );
  });

  it('should spawn a new node when no memory node responds, even if afferent nodes did', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const toolNode: Node<'tool'> = {
      id: 'tool-node',
      kind: 'tool' as const,
      status: 'idle',
      context: 'Tool context',
      sendMessage: vi.fn().mockResolvedValue({
        role: 'node-response' as const,
        originatingNodeId: 'tool-node',
        content: 'Tool response',
      }),
    };
    orchestrator.addNode(toolNode);

    // No memory nodes responded this epoch.
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);
    const mockNewNode = createMockNode('new-memory-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    await orchestrator.runEpoch();

    expect(mockMemoryNodeFactory.create).toHaveBeenCalled();
  });

  it('should evaluate a spawned fallback memory node with the current afferent context', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const toolNode: Node<'tool'> = {
      id: 'tool-node',
      kind: 'tool' as const,
      status: 'idle',
      context: 'Tool context',
      sendMessage: vi.fn().mockResolvedValue({
        role: 'node-response' as const,
        originatingNodeId: 'tool-node',
        content: 'Tool response',
      }),
    };
    const fallbackSend = vi.fn().mockResolvedValue({
      role: 'node-response' as const,
      originatingNodeId: 'new-memory-node',
      content: 'Fallback memory response',
    });
    const mockNewNode = createMockNode('new-memory-node', fallbackSend);
    orchestrator.addNode(toolNode);
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([
      {
        role: 'node-response',
        originatingNodeId: 'new-memory-node',
        content: 'Fallback memory response',
      },
    ]);
    vi.mocked(mockDistiller.distill).mockResolvedValue('fallback insight');

    await orchestrator.runEpoch();

    expect(fallbackSend).toHaveBeenCalledWith(
      expect.objectContaining({
        afferentContext: [
          {
            role: 'afferent',
            content: 'Tool response',
            originatingNodeId: 'tool-node',
          },
        ],
      }),
    );
    expect(mockRelevanceFilter.filter).toHaveBeenCalledWith(expect.anything(), [
      {
        role: 'node-response',
        originatingNodeId: 'new-memory-node',
        content: 'Fallback memory response',
      },
    ]);
    expect(mockDistiller.distill).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcasts: ['Fallback memory response'],
      }),
    );
    expect(orchestrator.currentBroadcast.content).toBe('fallback insight');
  });

  it('should handle node throwing an error during sendMessage', async () => {
    const orchestrator = new EpochOrchestrator({
      provider: mockProvider,
      relevanceFilter: mockRelevanceFilter,
      distiller: mockDistiller,
      maxWorkingMemoryMessages: 10,
      initialBroadcast: {
        role: 'broadcast' as const,
        content: 'Initial broadcast',
      },
      memoryNodeFactory: mockMemoryNodeFactory,
      contextLengthThreshold: 1000,
      memoryNodeSplitter: mockMemoryNodeSplitter,
      nodePruner: mockNodePruner,
      eventStream,
    });

    const nodeA: Node<'memory'> = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle',
      context: 'Context for node-a',
      sendMessage: vi.fn().mockRejectedValue(new Error('Something went wrong')),
    };

    orchestrator.addNode(nodeA);

    // Filter returns empty because the response was undefined due to error
    vi.mocked(mockRelevanceFilter.filter).mockResolvedValue([]);
    const mockNewNode = createMockNode('new-node');
    vi.mocked(mockMemoryNodeFactory.create).mockReturnValue(mockNewNode);

    await orchestrator.runEpoch();

    // Should handle the error gracefully and spawn a new node
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[EpochOrchestrator] Node node-a threw an error:',
      ),
    );
    expect(mockMemoryNodeFactory.create).toHaveBeenCalled();
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
