import * as fs from 'node:fs';
import path from 'node:path';
import { Message } from '../types/message.js';
import { WorkingMemory } from '../types/working-memory.js';
import { Node } from '../types/node.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { EventStream } from '../types/event-stream.js';
import { NodeStats } from '../types/node-stats.js';
import { NodeStatsEntry } from '../types/event-stream.js';

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
      const event = JSON.parse(content);
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
      entries.forEach(({ nodeId, stats }) => nodeStats.set(nodeId, stats));
    }

    return {
      nodes,
      workingMemory,
      broadcast,
      nodeStats,
    };
  },
};
