import * as fs from 'node:fs';
import path from 'node:path';
import { Message } from '../types/message.js';
import { WorkingMemory } from '../types/working-memory.js';
import { Node } from '../types/node.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { EventStream } from '../types/event-stream.js';
import { NodeStats } from '../types/node-stats.js';
import { NodeStatsEntry } from '../types/event-stream.js';
import {
  MCP_SERVER_SUMMARIES_FILE_NAME,
  PersistedMcpServerSummaries,
} from '../types/mcp-server-summary.js';
import { ACTIVE_GOAL_FILE_NAME, ActiveGoal } from '../types/goal.js';
import { isRecord } from './type-guards.js';

export interface LoadedSession {
  readonly nodes: Node<'memory'>[];
  readonly workingMemory: WorkingMemory;
  readonly broadcast: Message;
  readonly nodeStats: Map<string, NodeStats>;
}

export const SessionLoader = {
  load: (props: {
    readonly directory: string;
    readonly eventStream: EventStream;
    readonly memoryNodeFactory: MemoryNodeFactory;
  }): LoadedSession | undefined => {
    const { directory, memoryNodeFactory, eventStream } = props;
    const normalizedDirectory = path.normalize(directory);
    const nodesDir = path.join(normalizedDirectory, 'nodes');
    const nodes: LoadedSession['nodes'] = [];

    if (fs.existsSync(nodesDir)) {
      const nodeFiles = fs
        .readdirSync(nodesDir)
        .filter((file) => file.endsWith('.json'));
      nodeFiles.forEach((file) => {
        const filePath = path.join(nodesDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const nodeData = JSON.parse(content);
        nodes.push(
          memoryNodeFactory.create({
            initialContext: nodeData.context,
            nodeId: nodeData.id,
            eventStream,
          }),
        );
      });
    } else {
      return undefined;
    }

    let workingMemory: LoadedSession['workingMemory'];
    let broadcast: LoadedSession['broadcast'];
    const wmFilePath = path.join(normalizedDirectory, 'working-memory.json');
    if (fs.existsSync(wmFilePath)) {
      const content = fs.readFileSync(wmFilePath, 'utf-8');
      const event = JSON.parse(content) as {
        readonly workingMemory: WorkingMemory;
        readonly broadcast: Message;
      };
      workingMemory = event.workingMemory;
      broadcast = event.broadcast;
    } else {
      return undefined;
    }

    // Stats are optional: a session saved before stats persistence (or before
    // the first stats event) simply restores with empty stats.
    const nodeStats = new Map<string, NodeStats>();
    const statsFilePath = path.join(normalizedDirectory, 'stats.json');
    if (fs.existsSync(statsFilePath)) {
      const entries = JSON.parse(
        fs.readFileSync(statsFilePath, 'utf-8'),
      ) as NodeStatsEntry[];
      entries.forEach(({ nodeId, stats }) =>
        nodeStats.set(nodeId, normalizeNodeStats(stats)),
      );
    }

    return {
      nodes,
      workingMemory,
      broadcast,
      nodeStats,
    };
  },
  loadMcpServerSummaries: (props: {
    readonly directory: string;
  }): PersistedMcpServerSummaries => {
    const filePath = path.join(
      path.normalize(props.directory),
      MCP_SERVER_SUMMARIES_FILE_NAME,
    );
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as PersistedMcpServerSummaries;
  },
  loadActiveGoal: (props: {
    readonly directory: string;
  }): ActiveGoal | undefined => {
    const filePath = path.join(
      path.normalize(props.directory),
      ACTIVE_GOAL_FILE_NAME,
    );
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed) || !('activeGoal' in parsed)) {
      throw new Error('[SessionLoader] active goal file has invalid shape');
    }
    const activeGoal = parsed['activeGoal'];
    if (activeGoal === null) {
      return undefined;
    }
    if (!isRecord(activeGoal) || typeof activeGoal['id'] !== 'string') {
      throw new Error('[SessionLoader] active goal file has invalid goal data');
    }
    if ('content' in activeGoal) {
      if (typeof activeGoal['content'] !== 'string') {
        throw new Error(
          '[SessionLoader] active goal file has invalid goal data',
        );
      }
      return {
        id: activeGoal['id'],
        objective: activeGoal['content'],
        successCriteria:
          'Explicitly confirm that the migrated objective is complete.',
        origin: 'autonomous',
        revision: 1,
      };
    }
    if (!('objective' in activeGoal)) {
      throw new Error('[SessionLoader] active goal file has invalid goal data');
    }
    return {
      id: activeGoal['id'],
      objective: requiredString(activeGoal, 'objective'),
      successCriteria: requiredString(activeGoal, 'successCriteria'),
      origin: requiredGoalOrigin(activeGoal),
      revision: requiredPositiveInteger(activeGoal, 'revision'),
    };
  },
};

const normalizeNodeStats = (stats: unknown): NodeStats => {
  if (!isRecord(stats)) {
    throw new Error('[SessionLoader] node stats have invalid data');
  }
  if ('epochsGenerated' in stats) {
    return {
      epochsAlive: requiredNonNegativeInteger(stats, 'epochsAlive'),
      epochsGenerated: requiredNonNegativeInteger(stats, 'epochsGenerated'),
      epochsPassedAttention: requiredNonNegativeInteger(
        stats,
        'epochsPassedAttention',
      ),
      epochsSelected: requiredNonNegativeInteger(stats, 'epochsSelected'),
    };
  }
  if ('epochsSpoken' in stats) {
    const epochsAlive = requiredNonNegativeInteger(stats, 'epochsAlive');
    const epochsSpoken = requiredNonNegativeInteger(stats, 'epochsSpoken');
    const epochsFiltered = requiredNonNegativeInteger(stats, 'epochsFiltered');
    const passedAttention = Math.max(0, epochsSpoken - epochsFiltered);
    return {
      epochsAlive,
      epochsGenerated: epochsSpoken,
      epochsPassedAttention: passedAttention,
      // Historical sessions did not record the final selection; passing
      // attention is the least-destructive approximation for restored pruning.
      epochsSelected: passedAttention,
    };
  }
  throw new Error('[SessionLoader] node stats have invalid data');
};

const requiredString = (
  record: Record<string, unknown>,
  field: string,
): string => {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error('[SessionLoader] active goal file has invalid goal data');
  }
  return value;
};

const requiredGoalOrigin = (
  record: Record<string, unknown>,
): ActiveGoal['origin'] => {
  const value = record['origin'];
  if (value !== 'user' && value !== 'autonomous') {
    throw new Error('[SessionLoader] active goal file has invalid goal data');
  }
  return value;
};

const requiredPositiveInteger = (
  record: Record<string, unknown>,
  field: string,
): number => {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('[SessionLoader] active goal file has invalid goal data');
  }
  return value;
};

const requiredNonNegativeInteger = (
  record: Record<string, unknown>,
  field: string,
): number => {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('[SessionLoader] node stats have invalid data');
  }
  return value;
};
