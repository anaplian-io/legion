import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// Mock fs module - must use vi.hoisted for mutable objects used in mock factory
const { readFileSync, existsSync, readdirSync, writeFileSync } = vi.hoisted(
  () => {
    return {
      readFileSync: vi.fn(),
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    };
  },
);

vi.mock('node:fs', () => ({
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
}));

import { SessionLoader } from './session-loader.js';
import type { EventStream } from '../types/event-stream.js';
import type { MemoryNodeFactory } from '../types/memory-node-factory.js';

describe('SessionLoader', () => {
  const mockDirectory = '/tmp/test-session-loader';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined when nodes directory does not exist', () => {
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result).toBeUndefined();
  });

  it('should load nodes and working memory from disk', () => {
    const nodeFiles = ['node-1.json', 'node-2.json'];
    readdirSync.mockReturnValue(nodeFiles);
    existsSync.mockImplementation((filePath: string) => {
      if (typeof filePath === 'string') {
        return (
          filePath.includes('nodes') || filePath.includes('working-memory.json')
        );
      }
      return false;
    });
    readFileSync.mockImplementation((filePath: string) => {
      if (typeof filePath !== 'string') {
        return '';
      }
      if (filePath.includes('node-1')) {
        return JSON.stringify({
          id: 'node-1',
          kind: 'memory',
          context: 'Context for node-1',
        });
      }
      if (filePath.includes('node-2')) {
        return JSON.stringify({
          id: 'node-2',
          kind: 'memory',
          context: 'Context for node-2',
        });
      }
      if (filePath.includes('working-memory.json')) {
        return JSON.stringify({
          workingMemory: { messages: [] },
          broadcast: { role: 'broadcast' as const, content: '' },
        });
      }
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    });

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(({ initialContext, nodeId }) => ({
        id: nodeId ?? 'default-id',
        kind: 'memory' as const,
        context: initialContext,
        status: 'idle' as const,
        sendMessage: vi.fn(),
      })),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result).toEqual({
      nodes: [
        {
          id: 'node-1',
          kind: 'memory',
          context: 'Context for node-1',
          status: 'idle',
          sendMessage: expect.any(Function),
        },
        {
          id: 'node-2',
          kind: 'memory',
          context: 'Context for node-2',
          status: 'idle',
          sendMessage: expect.any(Function),
        },
      ],
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: '' },
      nodeStats: new Map(),
    });

    expect(mockMemoryNodeFactory.create).toHaveBeenCalledTimes(2);
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Context for node-1',
      nodeId: 'node-1',
      eventStream: mockEventStream,
    });
    expect(mockMemoryNodeFactory.create).toHaveBeenCalledWith({
      initialContext: 'Context for node-2',
      nodeId: 'node-2',
      eventStream: mockEventStream,
    });
  });

  it('should load working memory with messages', () => {
    const nodeFiles: string[] = [];
    readdirSync.mockReturnValue(nodeFiles);
    existsSync.mockImplementation(
      (filePath: string) =>
        filePath.includes('nodes') || filePath.includes('working-memory.json'),
    );
    readFileSync.mockImplementation(() => {
      return JSON.stringify({
        workingMemory: {
          messages: [
            { role: 'working-memory', content: 'First message' },
            { role: 'working-memory', content: 'Second message' },
          ],
        },
        broadcast: { role: 'broadcast' as const, content: 'Second message' },
      });
    });

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(() => ({
        id: 'default-id',
        kind: 'memory' as const,
        context: '',
        status: 'idle' as const,
        sendMessage: vi.fn(),
      })),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result).toEqual({
      nodes: [],
      workingMemory: {
        messages: [
          { role: 'working-memory', content: 'First message' },
          { role: 'working-memory', content: 'Second message' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'Second message' },
      nodeStats: new Map(),
    });
  });

  it('should panic if nodes directory cannot be read', () => {
    readdirSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    existsSync.mockReturnValue(true);

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    expect(() =>
      SessionLoader.load({
        directory: mockDirectory,
        eventStream: mockEventStream,
        memoryNodeFactory: mockMemoryNodeFactory,
      }),
    ).toThrow('Permission denied');
  });

  it('should handle missing working memory file gracefully', () => {
    const nodeFiles: string[] = [];
    readdirSync.mockReturnValue(nodeFiles);
    existsSync.mockImplementation((filePath: string) =>
      filePath.includes('nodes'),
    );
    // working-memory.json doesn't exist, so readFileSync should not be called

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(() => ({
        id: 'default-id',
        kind: 'memory' as const,
        context: '',
        status: 'idle' as const,
        sendMessage: vi.fn(),
      })),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result).toBeUndefined();
  });

  it('should handle empty node files array', () => {
    readdirSync.mockReturnValue([]);
    existsSync.mockImplementation(
      (filePath: string) =>
        filePath.includes('nodes') || filePath.includes('working-memory.json'),
    );
    readFileSync.mockImplementation(() => {
      return JSON.stringify({
        workingMemory: { messages: [] },
        broadcast: { role: 'broadcast' as const, content: '' },
      });
    });

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result).toEqual({
      nodes: [],
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: '' },
      nodeStats: new Map(),
    });
  });

  it('should throw if any node file cannot be read or parsed', () => {
    const nodeFiles = ['good.json', 'bad.json'];
    readdirSync.mockReturnValue(nodeFiles);
    existsSync.mockImplementation((filePath: string) =>
      filePath.includes('nodes'),
    );

    readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('good')) {
        return JSON.stringify({
          id: 'good-node',
          kind: 'memory',
          context: 'Good context',
        });
      }
      // Return invalid JSON to trigger parse error inside catch block
      return 'not valid json';
    });

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    expect(() =>
      SessionLoader.load({
        directory: mockDirectory,
        eventStream: mockEventStream,
        memoryNodeFactory: mockMemoryNodeFactory,
      }),
    ).toThrow('not valid json');
  });

  it('should throw if working memory file contains invalid JSON', () => {
    const nodeFiles: string[] = [];
    readdirSync.mockReturnValue(nodeFiles);
    existsSync.mockImplementation(
      (filePath: string) =>
        filePath.includes('nodes') || filePath.includes('working-memory.json'),
    );
    // Return invalid JSON to trigger parse error
    readFileSync.mockImplementation(() => 'not valid json');

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    expect(() =>
      SessionLoader.load({
        directory: mockDirectory,
        eventStream: mockEventStream,
        memoryNodeFactory: mockMemoryNodeFactory,
      }),
    ).toThrow('not valid json');
  });

  it('should restore node stats from stats.json when present', () => {
    readdirSync.mockReturnValue([]);
    existsSync.mockImplementation(
      (filePath: string) =>
        filePath.includes('nodes') ||
        filePath.includes('working-memory.json') ||
        filePath.includes('stats.json'),
    );
    readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('working-memory.json')) {
        return JSON.stringify({
          workingMemory: { messages: [] },
          broadcast: { role: 'broadcast' as const, content: '' },
        });
      }
      if (filePath.includes('stats.json')) {
        return JSON.stringify([
          {
            nodeId: 'node-1',
            stats: { epochsAlive: 9, epochsSpoken: 4, epochsFiltered: 2 },
          },
        ]);
      }
      throw new Error(`unexpected read ${filePath}`);
    });

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result?.nodeStats.get('node-1')).toEqual({
      epochsAlive: 9,
      epochsSpoken: 4,
      epochsFiltered: 2,
    });
  });

  it('should normalize the directory path', () => {
    const dirWithExtraSlashes =
      '/tmp/test-session-loader/../test-session-loader/';
    const nodesDir = path.join(dirWithExtraSlashes, 'nodes');

    readdirSync.mockReturnValue([]);
    existsSync.mockImplementation((filePath: string) => filePath === nodesDir);

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    SessionLoader.load({
      directory: dirWithExtraSlashes,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(readdirSync).toHaveBeenCalledWith(nodesDir);
  });

  it('should extract broadcast from last working memory message', () => {
    const nodeFiles: string[] = [];
    readdirSync.mockReturnValue(nodeFiles);
    existsSync.mockImplementation(
      (filePath: string) =>
        filePath.includes('nodes') || filePath.includes('working-memory.json'),
    );
    readFileSync.mockImplementation(() => {
      return JSON.stringify({
        workingMemory: {
          messages: [
            { content: 'First' },
            { content: 'Second' },
            { content: 'Third' },
          ],
        },
        broadcast: { role: 'broadcast' as const, content: 'Third' },
      });
    });

    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = {
      create: vi.fn(),
    };

    const result = SessionLoader.load({
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result?.broadcast.content).toBe('Third');
  });
});
