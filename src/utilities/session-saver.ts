import { EventStream } from '../types/event-stream.js';
import * as fs from 'node:fs';
import path from 'node:path';
import {
  MCP_SERVER_SUMMARIES_FILE_NAME,
  PersistedMcpServerSummaries,
} from '../types/mcp-server-summary.js';
import { ACTIVE_GOAL_FILE_NAME } from '../types/goal.js';
import { hasErrorCode, isMemoryNode } from './type-guards.js';
import {
  classifyTelemetryError,
  TelemetryRecorder,
} from '../telemetry/telemetry-recorder.js';

export const SessionSaver = {
  saveMcpServerSummaries: (props: {
    readonly directory: string;
    readonly summaries: PersistedMcpServerSummaries;
    readonly telemetry: TelemetryRecorder;
  }): void => {
    persist(props.telemetry, 'write', 'mcp-server-summaries', () => {
      const normalizedDirectory = path.normalize(props.directory);
      fs.mkdirSync(normalizedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(normalizedDirectory, MCP_SERVER_SUMMARIES_FILE_NAME),
        JSON.stringify(props.summaries, null, 2),
      );
    });
  },
  watch: (props: {
    readonly eventStream: EventStream;
    readonly directory: string;
    readonly telemetry: TelemetryRecorder;
  }) => {
    const { eventStream, directory } = props;
    const normalizedDirectory = path.normalize(directory);
    const nodesDirectory = path.join(normalizedDirectory, 'nodes');
    fs.mkdirSync(nodesDirectory, { recursive: true });

    eventStream.subscribe({
      topicName: 'orchestrator/node-added',
      receiver: (event) => {
        const memoryNodes = event.addedNodes.filter(isMemoryNode);
        memoryNodes.forEach((node) =>
          persist(props.telemetry, 'write', 'memory-node', () =>
            fs.writeFileSync(
              path.join(nodesDirectory, `${node.id}.json`),
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
          ),
        );
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/node-updated',
      receiver: (event) => {
        const node = event.node;
        if (node.kind === 'memory') {
          persist(props.telemetry, 'write', 'memory-node', () =>
            fs.writeFileSync(
              path.join(nodesDirectory, `${node.id}.json`),
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
        }
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/node-removed',
      receiver: (event) => {
        event.removedNodeIds.forEach((id) => {
          try {
            persist(props.telemetry, 'delete', 'memory-node', () =>
              fs.unlinkSync(path.join(nodesDirectory, `${id}.json`)),
            );
          } catch (error) {
            if (!hasErrorCode(error, 'ENOENT')) {
              eventStream.reportError?.({
                source: 'SessionSaver',
                message: `Failed to remove the saved node ${id}.`,
                error,
                metadata: { nodeId: id },
              });
            }
          }
        });
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/working-memory-updated',
      receiver: (event) => {
        persist(props.telemetry, 'write', 'working-memory', () =>
          fs.writeFileSync(
            path.join(normalizedDirectory, 'working-memory.json'),
            JSON.stringify(event, null, 2),
          ),
        );
      },
    });
    eventStream.subscribe({
      topicName: 'orchestrator/node-stats-updated',
      receiver: (event) => {
        persist(props.telemetry, 'write', 'node-stats', () =>
          fs.writeFileSync(
            path.join(normalizedDirectory, 'stats.json'),
            JSON.stringify(event.nodeStats, null, 2),
          ),
        );
      },
    });
    eventStream.subscribe({
      topicName: 'goal/updated',
      receiver: (event) => {
        persist(props.telemetry, 'write', 'active-goal', () =>
          fs.writeFileSync(
            path.join(normalizedDirectory, ACTIVE_GOAL_FILE_NAME),
            JSON.stringify({ activeGoal: event.activeGoal ?? null }, null, 2),
          ),
        );
      },
    });
  },
};

const persist = <Result>(
  telemetry: TelemetryRecorder,
  operation: 'read' | 'write' | 'delete',
  target: string,
  action: () => Result,
): Result => {
  const startedAtMs = telemetry.monotonicNow();
  try {
    const result = action();
    telemetry.record(
      'persistence.completed',
      {
        operation,
        target,
        durationMs: telemetry.durationSince(startedAtMs),
        outcome: 'success',
      },
      telemetry.currentEpochContext ?? {},
    );
    return result;
  } catch (error) {
    telemetry.record(
      'persistence.completed',
      {
        operation,
        target,
        durationMs: telemetry.durationSince(startedAtMs),
        outcome: 'failure',
        errorCategory: classifyTelemetryError(error),
      },
      telemetry.currentEpochContext ?? {},
    );
    throw error;
  }
};
