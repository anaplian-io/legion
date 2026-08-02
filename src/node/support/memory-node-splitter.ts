import { NodeSplitter } from '../../types/node-splitter.js';
import { Node } from '../../types/node.js';
import { Provider } from '../../types/provider.js';
import { MemoryNodeFactory } from '../../types/memory-node-factory.js';
import { EventStream } from '../../types/event-stream.js';
import type { EpochTelemetryContext } from '../../types/telemetry.js';
import {
  classifyTelemetryError,
  TelemetryRecorder,
} from '../../telemetry/telemetry-recorder.js';

export interface MemoryNodeSplitterProps {
  readonly splittingProvider: Provider;
  readonly newNodeProvider: Provider;
  readonly memoryNodeFactory: MemoryNodeFactory;
  readonly eventStream: EventStream;
  readonly telemetry: TelemetryRecorder;
}

export class MemoryNodeSplitter implements NodeSplitter<'memory'> {
  constructor(private readonly props: MemoryNodeSplitterProps) {}

  readonly split = async (
    node: Node<'memory'>,
    telemetryContext: EpochTelemetryContext,
  ): Promise<[Node<'memory'>, Node<'memory'>]> => {
    const span = this.props.telemetry.startSpan('split');
    const context = node.context;
    try {
      const [leftContext, rightContext] =
        await this.props.splittingProvider.splitString(context, {
          ...telemetryContext,
          stage: 'node-splitting',
          nodeId: node.id,
          parentSpanId: span.spanId,
        });

      const createSplitNode = (initialContext: string) => {
        return this.props.memoryNodeFactory.create({
          initialContext,
          eventStream: this.props.eventStream,
        });
      };

      const leftNode = createSplitNode(leftContext);
      const rightNode = createSplitNode(rightContext);

      this.props.telemetry.record(
        'node.split-completed',
        {
          parentNodeId: node.id,
          childNodeIds: [leftNode.id, rightNode.id],
          durationMs: this.props.telemetry.durationSince(span.startedAtMs),
          outcome: 'success',
        },
        { ...telemetryContext, nodeId: node.id },
        span.spanId,
      );
      return [leftNode, rightNode];
    } catch (error) {
      this.props.telemetry.record(
        'node.split-completed',
        {
          parentNodeId: node.id,
          childNodeIds: [],
          durationMs: this.props.telemetry.durationSince(span.startedAtMs),
          outcome: 'failure',
          errorCategory: classifyTelemetryError(error),
        },
        { ...telemetryContext, nodeId: node.id },
        span.spanId,
      );
      throw error;
    }
  };
}
