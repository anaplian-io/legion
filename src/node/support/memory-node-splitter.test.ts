import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryNodeSplitter } from './memory-node-splitter.js';
import type { Provider } from '../../types/provider.js';
import type { MemoryNodeFactory } from '../../types/memory-node-factory.js';
import { ConcreteEventStream } from '../../stream/concrete-event-stream.js';
import {
  createTestTelemetry,
  TEST_EPOCH_TELEMETRY,
} from '../../telemetry/test-context.fixture.js';
import type { TelemetryEvent } from '../../types/telemetry.js';

describe('MemoryNodeSplitter', () => {
  let mockSplittingProvider: Provider;
  let mockNewNodeProvider: Provider;
  let mockMemoryNodeFactory: MemoryNodeFactory;
  let eventStream: ConcreteEventStream;
  const telemetry = createTestTelemetry();

  beforeEach(() => {
    mockSplittingProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    mockNewNodeProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
    mockMemoryNodeFactory = {
      create: vi.fn(),
    };
    eventStream = new ConcreteEventStream();
  });

  it('should create a splitter with the given props', () => {
    const splitter = new MemoryNodeSplitter({
      telemetry,
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
      memoryNodeFactory: mockMemoryNodeFactory,
      eventStream,
    });

    expect(typeof splitter.split).toBe('function');
  });

  it('should split a node into two nodes using the splitting provider', async () => {
    const leftNode = {
      id: 'node-a-left',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: '',
      sendMessage: vi.fn(),
    };
    const rightNode = {
      id: 'node-a-right',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: '',
      sendMessage: vi.fn(),
    };

    vi.mocked(mockMemoryNodeFactory.create)
      .mockReturnValueOnce(leftNode)
      .mockReturnValueOnce(rightNode);

    const splitter = new MemoryNodeSplitter({
      telemetry,
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
      memoryNodeFactory: mockMemoryNodeFactory,
      eventStream,
    });

    vi.mocked(mockSplittingProvider.splitString).mockResolvedValue([
      'Left context',
      'Right context',
    ]);

    const node = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: 'Original context',
      sendMessage: vi.fn(),
    };

    const result = await splitter.split(node, TEST_EPOCH_TELEMETRY);

    expect(mockSplittingProvider.splitString).toHaveBeenCalledWith(
      'Original context',
      expect.objectContaining({
        epochId: TEST_EPOCH_TELEMETRY.epochId,
        stage: 'node-splitting',
        nodeId: 'node-a',
      }),
    );

    expect(mockMemoryNodeFactory.create).toHaveBeenNthCalledWith(1, {
      initialContext: 'Left context',
      eventStream,
    });
    expect(mockMemoryNodeFactory.create).toHaveBeenNthCalledWith(2, {
      initialContext: 'Right context',
      eventStream,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(leftNode);
    expect(result[1]).toBe(rightNode);
  });

  it('should pass eventStream to split nodes', async () => {
    const leftNode = {
      id: 'node-a-left',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: '',
      sendMessage: vi.fn(),
    };
    const rightNode = {
      id: 'node-a-right',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: '',
      sendMessage: vi.fn(),
    };

    let capturedLeftEventStream: ConcreteEventStream | undefined;
    let capturedRightEventStream: ConcreteEventStream | undefined;

    vi.mocked(mockMemoryNodeFactory.create).mockImplementation((props) => {
      if ((props.initialContext as string).includes('Left')) {
        capturedLeftEventStream = props.eventStream as ConcreteEventStream;
        return leftNode;
      }
      capturedRightEventStream = props.eventStream as ConcreteEventStream;
      return rightNode;
    });

    const splitter = new MemoryNodeSplitter({
      telemetry,
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
      memoryNodeFactory: mockMemoryNodeFactory,
      eventStream,
    });

    vi.mocked(mockSplittingProvider.splitString).mockResolvedValue([
      'Left context',
      'Right context',
    ]);

    const node = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: 'Original context',
      sendMessage: vi.fn(),
    };

    await splitter.split(node, TEST_EPOCH_TELEMETRY);

    expect(capturedLeftEventStream).toBe(eventStream);
    expect(capturedRightEventStream).toBe(eventStream);
  });

  it('records failed splits before rethrowing', async () => {
    const failureTelemetry = createTestTelemetry();
    const events: TelemetryEvent[] = [];
    failureTelemetry.subscribe((event) => events.push(event));
    vi.mocked(mockSplittingProvider.splitString).mockRejectedValue(
      new TypeError('split failed'),
    );
    const splitter = new MemoryNodeSplitter({
      telemetry: failureTelemetry,
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
      memoryNodeFactory: mockMemoryNodeFactory,
      eventStream,
    });
    const node = {
      id: 'node-a',
      kind: 'memory' as const,
      status: 'idle' as const,
      context: 'Original context',
      sendMessage: vi.fn(),
    };

    await expect(splitter.split(node, TEST_EPOCH_TELEMETRY)).rejects.toThrow(
      'split failed',
    );
    expect(events[0]).toMatchObject({
      event: 'node.split-completed',
      spanId: expect.any(String),
      data: {
        outcome: 'failure',
        childNodeIds: [],
        errorCategory: 'TypeError',
      },
    });
  });
});
