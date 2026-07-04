import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// Mock fs module - must use vi.hoisted for mutable objects used in mock factory
const { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } = vi.hoisted(
  () => {
    return {
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
      mkdirSync: vi.fn(),
      existsSync: vi.fn(),
      rmSync: vi.fn(),
    };
  },
);

vi.mock('node:fs', () => ({
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  rmSync,
}));

import * as fs from 'node:fs';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import { SessionSaver } from './session-saver.js';
import type { NodeStatus, Node } from '../types/node.js';

// Type alias for memory node interface
type MemoryNode = Node<'memory'>;

// Helper to create a mock memory node
function createMemoryNode(id: string, context: string = 'initial'): MemoryNode {
  return {
    id,
    kind: 'memory' as const,
    status: 'idle',
    context,
    sendMessage: vi.fn(),
  };
}

describe('SessionSaver', () => {
  const mockDirectory = '/tmp/test-session-saver';
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    eventStream = new ConcreteEventStream();
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(mockDirectory)) {
        fs.rmSync(mockDirectory, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('orchestrator/node-added event', () => {
    it('should save memory node to disk when orchestrator adds a node', async () => {
      const node: MemoryNode = {
        id: 'node-1',
        kind: 'memory' as const,
        status: 'idle',
        context: 'Test context for node-1',
        sendMessage: vi.fn(),
      };

      // Create directory
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: {
          addedNodes: [node],
        },
      });

      const expectedPath = path.join(mockDirectory, 'nodes', 'node-1.json');
      expect(writeFileSync).toHaveBeenCalled();
      const callArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgs[0]).toBe(expectedPath);
      const fileContent = callArgs[1];
      expect(JSON.parse(fileContent)).toEqual({
        id: 'node-1',
        kind: 'memory',
        context: 'Test context for node-1',
      });
    });

    it('should save multiple memory nodes to disk when orchestrator adds multiple nodes', async () => {
      const nodes: MemoryNode[] = [
        {
          id: 'node-a',
          kind: 'memory' as const,
          status: 'idle',
          context: 'Context for node-a',
          sendMessage: vi.fn(),
        },
        {
          id: 'node-b',
          kind: 'memory' as const,
          status: 'idle' as NodeStatus,
          context: 'Context for node-b',
          sendMessage: vi.fn(),
        },
      ];

      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: {
          addedNodes: nodes,
        },
      });

      // Verify first node (node-a)
      const callArgsA = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgsA[0]).toBe(
        path.join(mockDirectory, 'nodes', 'node-a.json'),
      );
      expect(JSON.parse(callArgsA[1])).toEqual({
        id: 'node-a',
        kind: 'memory',
        context: 'Context for node-a',
      });

      // Verify second node (node-b)
      const callArgsB = writeFileSync.mock.calls[1] as [string, string];
      expect(callArgsB[0]).toBe(
        path.join(mockDirectory, 'nodes', 'node-b.json'),
      );
      expect(JSON.parse(callArgsB[1])).toEqual({
        id: 'node-b',
        kind: 'memory',
        context: 'Context for node-b',
      });
    });

    it('should filter out non-memory nodes and only save memory nodes', async () => {
      interface OtherNode {
        id: string;
        kind: 'other';
        status: NodeStatus;
        context: string;
        sendMessage: MemoryNode['sendMessage'];
      }

      const mixedNodes: (MemoryNode | OtherNode)[] = [
        {
          id: 'memory-node-1',
          kind: 'memory' as const,
          status: 'idle',
          context: 'Memory context',
          sendMessage: vi.fn(),
        },
        {
          id: 'other-node-1',
          kind: 'other' as const,
          status: 'idle',
          context: 'Other context',
          sendMessage: vi.fn(),
        } satisfies OtherNode,
      ];

      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: {
          addedNodes: mixedNodes,
        },
      });

      // Only the memory node should be saved
      const callArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgs[0]).toBe(
        path.join(mockDirectory, 'nodes', 'memory-node-1.json'),
      );
      expect(JSON.parse(callArgs[1])).toEqual({
        id: 'memory-node-1',
        kind: 'memory',
        context: 'Memory context',
      });
    });

    it('should handle empty addedNodes array', async () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      // Should not throw
      expect(() => {
        eventStream.publish({
          topicName: 'orchestrator/node-added',
          data: {
            addedNodes: [],
          },
        });
      }).not.toThrow();
    });

    it('should normalize the directory path', async () => {
      const node: MemoryNode = {
        id: 'node-1',
        kind: 'memory' as const,
        status: 'idle',
        context: 'Test context',
        sendMessage: vi.fn(),
      };

      // Use a path with extra slashes that need normalization
      const dirWithExtraSlashes =
        '/tmp/test-session-saver/../test-session-saver/';
      fs.mkdirSync(dirWithExtraSlashes, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: dirWithExtraSlashes,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: {
          addedNodes: [node],
        },
      });

      const expectedPath = path.join(
        dirWithExtraSlashes,
        'nodes',
        'node-1.json',
      );
      const callArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgs[0]).toBe(expectedPath);
      expect(JSON.parse(callArgs[1])).toEqual({
        id: 'node-1',
        kind: 'memory',
        context: 'Test context',
      });
    });
  });

  describe('orchestrator/node-removed event', () => {
    it('should delete node file from disk when orchestrator removes a node', async () => {
      const nodeId = 'node-to-remove';
      const filePath = path.join(mockDirectory, 'nodes', `${nodeId}.json`);

      // Create directory and pre-create the file
      fs.mkdirSync(mockDirectory, { recursive: true });
      fs.writeFileSync(filePath, '{"id":"test"}');

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-removed',
        data: {
          removedNodeIds: [nodeId],
        },
      });

      // Verify unlinkSync was called with the correct path
      expect(unlinkSync).toHaveBeenCalledWith(filePath);
    });

    it('should delete multiple node files when orchestrator removes multiple nodes', async () => {
      const nodeIds = ['node-a', 'node-b', 'node-c'];
      const dirPath = path.join(mockDirectory, 'nodes');

      fs.mkdirSync(dirPath, { recursive: true });
      nodeIds.forEach((id) => {
        fs.writeFileSync(path.join(dirPath, `${id}.json`), '{"id":"test"}');
      });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-removed',
        data: {
          removedNodeIds: nodeIds,
        },
      });

      expect(unlinkSync).toHaveBeenCalledWith(
        path.join(dirPath, 'node-a.json'),
      );
      expect(unlinkSync).toHaveBeenCalledWith(
        path.join(dirPath, 'node-b.json'),
      );
      expect(unlinkSync).toHaveBeenCalledWith(
        path.join(dirPath, 'node-c.json'),
      );
    });

    it('should not throw when trying to delete a non-existent file', () => {
      fs.mkdirSync(mockDirectory, { recursive: true });
      existsSync.mockReturnValue(false); // File doesn't exist

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      // Should not throw even though the file doesn't exist
      expect(() => {
        eventStream.publish({
          topicName: 'orchestrator/node-removed',
          data: {
            removedNodeIds: ['non-existent-node'],
          },
        });
      }).not.toThrow();
    });

    it('should handle empty removedNodeIds array', () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      // Should not throw
      expect(() => {
        eventStream.publish({
          topicName: 'orchestrator/node-removed',
          data: {
            removedNodeIds: [],
          },
        });
      }).not.toThrow();
    });
  });

  describe('subscribe behavior', () => {
    it('should subscribe to both node-added and node-removed events', async () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      const node: MemoryNode = {
        id: 'node-1',
        kind: 'memory' as const,
        status: 'idle',
        context: 'Test context',
        sendMessage: vi.fn(),
      };

      // First publish a node-added event
      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: { addedNodes: [node] },
      });

      expect(writeFileSync).toHaveBeenCalled();

      writeFileSync.mockClear();

      // Then publish a node-removed event
      eventStream.publish({
        topicName: 'orchestrator/node-removed',
        data: { removedNodeIds: ['node-1'] },
      });

      expect(unlinkSync).toHaveBeenCalled();
    });

    it('should handle multiple subscribers on the same events', async () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      // Add another subscriber
      let secondSubscriberCalled = false;
      eventStream.subscribe({
        topicName: 'orchestrator/node-added',
        receiver: () => {
          secondSubscriberCalled = true;
        },
      });

      const node: MemoryNode = {
        id: 'node-1',
        kind: 'memory' as const,
        status: 'idle',
        context: 'Test context',
        sendMessage: vi.fn(),
      };

      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: { addedNodes: [node] },
      });

      expect(writeFileSync).toHaveBeenCalled();
      expect(secondSubscriberCalled).toBe(true);
    });
  });

  describe('orchestrator/node-updated event', () => {
    it('should update node file on disk when orchestrator publishes node-updated', async () => {
      const node = createMemoryNode('node-1', 'Initial context');

      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      // Save initial state
      eventStream.publish({
        topicName: 'orchestrator/node-updated',
        data: { node },
      });

      const expectedPath = path.join(mockDirectory, 'nodes', 'node-1.json');

      // Verify initial save
      const initialCallArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(initialCallArgs[0]).toBe(expectedPath);
      expect(JSON.parse(initialCallArgs[1])).toEqual({
        id: 'node-1',
        kind: 'memory',
        context: 'Initial context',
      });

      // Update the node's context
      const updatedNode: MemoryNode = {
        ...node,
        kind: 'memory',
        context: 'Updated context',
      };
      writeFileSync.mockClear();

      eventStream.publish({
        topicName: 'orchestrator/node-updated',
        data: { node: updatedNode },
      });

      // Verify update save
      const updateCallArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(updateCallArgs[0]).toBe(expectedPath);
      expect(JSON.parse(updateCallArgs[1])).toEqual({
        id: 'node-1',
        kind: 'memory',
        context: 'Updated context',
      });
    });

    it('should filter out non-memory nodes', async () => {
      interface OtherNode {
        id: string;
        kind: 'other';
        status: NodeStatus;
        context: string;
        sendMessage: MemoryNode['sendMessage'];
      }

      const node: OtherNode = {
        id: 'other-node',
        kind: 'other' as const,
        status: 'idle',
        context: 'Other context',
        sendMessage: vi.fn(),
      };

      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      eventStream.publish({
        topicName: 'orchestrator/node-updated',
        data: { node },
      });

      expect(writeFileSync).not.toHaveBeenCalledWith(
        path.join(mockDirectory, 'other-node.json'),
        expect.any(String),
      );
    });
  });

  describe('orchestrator/working-memory-updated event', () => {
    it('should save working memory to disk when orchestrator publishes working-memory-updated', async () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      const workingMemory = {
        messages: [
          { role: 'working-memory' as const, content: 'First message' },
          { role: 'working-memory' as const, content: 'Second message' },
        ],
      };

      eventStream.publish({
        topicName: 'orchestrator/working-memory-updated',
        data: {
          workingMemory,
          broadcast: {
            role: 'broadcast' as const,
            content: 'Current broadcast',
          },
        },
      });

      const expectedPath = path.join(mockDirectory, 'working-memory.json');
      expect(writeFileSync).toHaveBeenCalled();
      const callArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgs[0]).toBe(expectedPath);
      const savedEvent = JSON.parse(callArgs[1]);
      expect(savedEvent.workingMemory).toEqual(workingMemory);
      expect(savedEvent.broadcast).toEqual({
        role: 'broadcast',
        content: 'Current broadcast',
      });
    });

    it('should handle empty working memory', async () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({
        eventStream,
        directory: mockDirectory,
      });

      const workingMemory = { messages: [] };

      eventStream.publish({
        topicName: 'orchestrator/working-memory-updated',
        data: {
          workingMemory,
          broadcast: { role: 'broadcast' as const, content: 'Broadcast' },
        },
      });

      const expectedPath = path.join(mockDirectory, 'working-memory.json');
      expect(writeFileSync).toHaveBeenCalled();
      const callArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgs[0]).toBe(expectedPath);
      const savedEvent = JSON.parse(callArgs[1]);
      expect(savedEvent.workingMemory).toEqual(workingMemory);
      expect(savedEvent.broadcast).toEqual({
        role: 'broadcast',
        content: 'Broadcast',
      });
    });
  });

  describe('orchestrator/node-stats-updated event', () => {
    it('should persist node stats to stats.json', async () => {
      fs.mkdirSync(mockDirectory, { recursive: true });

      SessionSaver.watch({ eventStream, directory: mockDirectory });

      const nodeStats = [
        {
          nodeId: 'node-1',
          stats: { epochsAlive: 7, epochsSpoken: 5, epochsFiltered: 1 },
        },
      ];

      eventStream.publish({
        topicName: 'orchestrator/node-stats-updated',
        data: { nodeStats },
      });

      const expectedPath = path.join(mockDirectory, 'stats.json');
      const callArgs = writeFileSync.mock.calls[0] as [string, string];
      expect(callArgs[0]).toBe(expectedPath);
      expect(JSON.parse(callArgs[1])).toEqual(nodeStats);
    });
  });
});
