import { EventStream } from '../types/event-stream.js';
import { MemoryNode } from '../node/memory-node.js';
import * as fs from 'node:fs';
import path from 'node:path';

export const SessionSaver = {
  watch: (props: {
    readonly eventStream: EventStream;
    readonly directory: string;
  }) => {
    const { eventStream, directory } = props;
    const normalizedDirectory = path.normalize(directory);
    eventStream.subscribe({
      topicName: 'orchestrator/node-added',
      receiver: (event) => {
        const memoryNodes = event.addedNodes.filter(
          (node): node is MemoryNode => node.kind === 'memory',
        );
        memoryNodes.forEach((node) =>
          fs.writeFileSync(
            path.join(normalizedDirectory, 'nodes', `${node.id}.json`),
            JSON.stringify(
              {
                id: node.id,
                kind: node.kind,
                context: node.context,
              },
              null,
              2,
            ),
          ),
        );
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/node-updated',
      receiver: (event) => {
        const node = event.node;
        if (node.kind === 'memory') {
          fs.writeFileSync(
            path.join(normalizedDirectory, 'nodes', `${node.id}.json`),
            JSON.stringify(
              {
                id: node.id,
                kind: node.kind,
                context: node.context,
              },
              null,
              2,
            ),
          );
        }
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/node-removed',
      receiver: (event) => {
        event.removedNodeIds.forEach((id) => {
          try {
            fs.unlinkSync(
              path.join(normalizedDirectory, 'nodes', `${id}.json`),
            );
          } catch {}
        });
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/working-memory-updated',
      receiver: (event) => {
        fs.writeFileSync(
          path.join(normalizedDirectory, 'working-memory.json'),
          JSON.stringify(event, null, 2),
        );
      },
    });
  },
};
