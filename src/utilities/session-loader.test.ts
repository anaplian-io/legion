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
import { createTestTelemetry } from '../telemetry/test-context.fixture.js';

describe('SessionLoader', () => {
  const mockDirectory = '/tmp/test-session-loader';
  const telemetry = createTestTelemetry();

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
      telemetry,
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result).toBeUndefined();
  });

  it('records read failures both inside and outside an epoch', () => {
    const mockEventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const mockMemoryNodeFactory: MemoryNodeFactory = { create: vi.fn() };
    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue(['node-1.json']);
    readFileSync.mockImplementation(() => {
      throw new TypeError('read failed');
    });

    [false, true].forEach((insideEpoch) => {
      const failureTelemetry = createTestTelemetry();
      const received: import('../types/telemetry.js').TelemetryEvent[] = [];
      failureTelemetry.subscribe((event) => received.push(event));
      const epoch = insideEpoch ? failureTelemetry.beginEpoch() : undefined;

      expect(() =>
        SessionLoader.load({
          telemetry: failureTelemetry,
          directory: mockDirectory,
          eventStream: mockEventStream,
          memoryNodeFactory: mockMemoryNodeFactory,
        }),
      ).toThrow('read failed');
      expect(received.at(-1)).toMatchObject({
        event: 'persistence.completed',
        ...(epoch === undefined ? {} : { epochId: epoch.epochId }),
        data: { outcome: 'failure', errorCategory: 'TypeError' },
      });
    });
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
      telemetry,
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
      telemetry,
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
        telemetry,
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
      telemetry,
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
      telemetry,
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
        telemetry,
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
        telemetry,
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
      telemetry,
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result?.nodeStats.get('node-1')).toEqual({
      epochsAlive: 9,
      epochsGenerated: 4,
      epochsPassedAttention: 2,
      epochsSelected: 2,
    });
  });

  it('restores current node stats and rejects malformed stats', () => {
    readdirSync.mockReturnValue([]);
    existsSync.mockReturnValue(true);
    const currentStats = {
      epochsAlive: 4,
      epochsGenerated: 3,
      epochsPassedAttention: 2,
      epochsSelected: 1,
    };
    readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('working-memory.json')) {
        return JSON.stringify({
          workingMemory: { messages: [] },
          broadcast: { role: 'broadcast', content: '' },
        });
      }
      if (filePath.includes('stats.json')) {
        return JSON.stringify([{ nodeId: 'node-1', stats: currentStats }]);
      }
      throw new Error(`unexpected read ${filePath}`);
    });
    const eventStream: EventStream = {
      subscribe: vi.fn(),
      publish: vi.fn(),
    };
    const memoryNodeFactory: MemoryNodeFactory = { create: vi.fn() };

    expect(
      SessionLoader.load({
        telemetry,
        directory: mockDirectory,
        eventStream,
        memoryNodeFactory,
      })?.nodeStats.get('node-1'),
    ).toEqual(currentStats);

    const invalidStats: unknown[] = [
      null,
      {},
      { ...currentStats, epochsSelected: -1 },
      { epochsAlive: 1, epochsSpoken: 1, epochsFiltered: -1 },
    ];
    invalidStats.forEach((stats) => {
      readFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('working-memory.json')) {
          return JSON.stringify({
            workingMemory: { messages: [] },
            broadcast: { role: 'broadcast', content: '' },
          });
        }
        return JSON.stringify([{ nodeId: 'node-1', stats }]);
      });
      expect(() =>
        SessionLoader.load({
          telemetry,
          directory: mockDirectory,
          eventStream,
          memoryNodeFactory,
        }),
      ).toThrow('[SessionLoader] node stats have invalid data');
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
      telemetry,
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
      telemetry,
      directory: mockDirectory,
      eventStream: mockEventStream,
      memoryNodeFactory: mockMemoryNodeFactory,
    });

    expect(result?.broadcast.content).toBe('Third');
  });

  it('should return an empty MCP server summary cache when none is saved', () => {
    existsSync.mockReturnValue(false);

    expect(
      SessionLoader.loadMcpServerSummaries({
        directory: mockDirectory,
        telemetry,
      }),
    ).toEqual({});
  });

  it('should load persisted MCP server summaries independently of a session', () => {
    const summaries = {
      'search-server': {
        capabilityDescription: 'can search the web.',
        toolSignature: 'tool-signature',
      },
    };
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(summaries));

    expect(
      SessionLoader.loadMcpServerSummaries({
        directory: mockDirectory,
        telemetry,
      }),
    ).toEqual(summaries);
    expect(readFileSync).toHaveBeenCalledWith(
      path.join(mockDirectory, 'mcp-server-summaries.json'),
      'utf-8',
    );
  });

  it('returns no active goal when one was not persisted', () => {
    existsSync.mockReturnValue(false);

    expect(
      SessionLoader.loadActiveGoal({ directory: mockDirectory, telemetry }),
    ).toBeUndefined();
  });

  it('loads an active goal or an explicitly cleared goal', () => {
    existsSync.mockReturnValue(true);
    readFileSync
      .mockReturnValueOnce(
        JSON.stringify({
          activeGoal: { id: 'goal-1', content: 'Explore sensors' },
        }),
      )
      .mockReturnValueOnce(JSON.stringify({ activeGoal: null }));

    expect(
      SessionLoader.loadActiveGoal({ directory: mockDirectory, telemetry }),
    ).toEqual({
      id: 'goal-1',
      objective: 'Explore sensors',
      successCriteria:
        'Explicitly confirm that the migrated objective is complete.',
      origin: 'autonomous',
      revision: 1,
    });
    expect(
      SessionLoader.loadActiveGoal({ directory: mockDirectory, telemetry }),
    ).toBeUndefined();
    expect(readFileSync).toHaveBeenCalledWith(
      path.join(mockDirectory, 'active-goal.json'),
      'utf-8',
    );
  });

  it('loads the current precise active-goal format', () => {
    existsSync.mockReturnValue(true);
    const activeGoal = {
      id: 'goal-2',
      objective: 'Inspect sensors',
      successCriteria: 'Record one verified reading',
      origin: 'user',
      revision: 4,
    };
    readFileSync.mockReturnValue(JSON.stringify({ activeGoal }));

    expect(
      SessionLoader.loadActiveGoal({ directory: mockDirectory, telemetry }),
    ).toEqual(activeGoal);
  });

  it('rejects malformed active-goal file shapes', () => {
    existsSync.mockReturnValue(true);
    const invalidShapes = ['1', 'null', '[]', '{}'];

    invalidShapes.forEach((content) => {
      readFileSync.mockReturnValue(content);
      expect(() =>
        SessionLoader.loadActiveGoal({ directory: mockDirectory, telemetry }),
      ).toThrow('[SessionLoader] active goal file has invalid shape');
    });
  });

  it('rejects malformed active-goal data', () => {
    existsSync.mockReturnValue(true);
    const invalidGoals = [
      JSON.stringify({ activeGoal: [] }),
      JSON.stringify({ activeGoal: { id: 1, content: 'Explore' } }),
      JSON.stringify({ activeGoal: { id: 'goal-1', content: 1 } }),
      JSON.stringify({ activeGoal: { id: 'goal-1' } }),
      JSON.stringify({
        activeGoal: {
          id: 'goal-1',
          objective: 1,
          successCriteria: 'Done',
          origin: 'user',
          revision: 1,
        },
      }),
      JSON.stringify({
        activeGoal: {
          id: 'goal-1',
          objective: 'Explore',
          successCriteria: 1,
          origin: 'user',
          revision: 1,
        },
      }),
      JSON.stringify({
        activeGoal: {
          id: 'goal-1',
          objective: 'Explore',
          successCriteria: 'Done',
          origin: 'external',
          revision: 1,
        },
      }),
      JSON.stringify({
        activeGoal: {
          id: 'goal-1',
          objective: 'Explore',
          successCriteria: 'Done',
          origin: 'user',
          revision: 0,
        },
      }),
    ];

    invalidGoals.forEach((content) => {
      readFileSync.mockReturnValue(content);
      expect(() =>
        SessionLoader.loadActiveGoal({ directory: mockDirectory, telemetry }),
      ).toThrow('[SessionLoader] active goal file has invalid goal data');
    });
  });
});
