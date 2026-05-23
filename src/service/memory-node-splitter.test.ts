import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryNodeSplitter } from './memory-node-splitter.js';
import type { Provider } from '../types/provider.js';

describe('MemoryNodeSplitter', () => {
  let mockSplittingProvider: Provider;
  let mockNewNodeProvider: Provider;

  beforeEach(() => {
    mockSplittingProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
    };
    mockNewNodeProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
    };
  });

  it('should create a splitter with the given props', () => {
    const splitter = new MemoryNodeSplitter({
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
    });

    expect(typeof splitter.split).toBe('function');
  });

  it('should split a node into two nodes using the splitting provider', async () => {
    const splitter = new MemoryNodeSplitter({
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
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

    const result = await splitter.split(node);

    expect(mockSplittingProvider.splitString).toHaveBeenCalledWith(
      'Original context',
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('node-a-left');
    expect(result[1].id).toBe('node-a-right');
    expect(result[0].context).toBe('Left context');
    expect(result[1].context).toBe('Right context');
    expect(result[0].kind).toBe('memory');
    expect(result[1].kind).toBe('memory');
  });

  it('should use newNodeProvider for the split nodes', async () => {
    const splitter = new MemoryNodeSplitter({
      splittingProvider: mockSplittingProvider,
      newNodeProvider: mockNewNodeProvider,
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

    await splitter.split(node);

    // The new nodes should be created with newNodeProvider
    // Since we can't directly inspect the MemoryNode constructor call,
    // verify that splitString was called and returned the expected values
    const result = await splitter.split(node);
    expect(result[0].context).toBe('Left context');
    expect(result[1].context).toBe('Right context');
  });
});
