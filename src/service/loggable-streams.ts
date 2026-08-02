import { ErrorReport, ErrorStream } from '../types/error-stream.js';
import { ObservableEventStream, PublishProps } from '../types/event-stream.js';
import { LoggableStream } from '../types/logging.js';

/** Adapts domain events to the existing forensic event-log representation. */
export const eventLogStream = (
  eventStream: ObservableEventStream,
): LoggableStream<PublishProps> => ({
  name: 'events',
  subscribeForLogging: eventStream.subscribeAll,
  serializeForLogging: serializePublishedEvent,
});

/** Adapts recoverable errors to their durable diagnostic representation. */
export const errorLogStream = (
  errorStream: ErrorStream,
): LoggableStream<ErrorReport> => ({
  name: 'errors',
  subscribeForLogging: errorStream.subscribe,
  serializeForLogging: (report) => ({
    source: report.source,
    message: report.message,
    ...(report.error === undefined ? {} : { error: report.error }),
    ...(report.metadata === undefined ? {} : { metadata: report.metadata }),
  }),
});

const serializeNode = (node: {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly context: string;
}): Record<string, string> => ({
  id: node.id,
  kind: node.kind,
  status: node.status,
  context: node.context,
});

/**
 * This switch is deliberately exhaustive: a new domain event cannot silently
 * fall through to logging an unbounded payload.
 */
const serializePublishedEvent = (props: PublishProps): unknown => {
  switch (props.topicName) {
    case 'orchestrator/nodes-changed':
      return {
        topicName: props.topicName,
        data: { allNodes: props.data.allNodes.map(serializeNode) },
      };
    case 'orchestrator/node-added':
      return {
        topicName: props.topicName,
        data: { addedNodes: props.data.addedNodes.map(serializeNode) },
      };
    case 'orchestrator/node-updated':
      return {
        topicName: props.topicName,
        data: { node: serializeNode(props.data.node) },
      };
    case 'system/notice':
    case 'node/status-change':
    case 'tool/elaboration-completed':
    case 'tool/invocation-started':
    case 'tool/invocation-completed':
    case 'goal/updated':
    case 'orchestrator/node-removed':
    case 'orchestrator/working-memory-updated':
    case 'orchestrator/user-input-received':
    case 'orchestrator/user-input-consumed':
    case 'orchestrator/node-stats-updated':
      return props;
  }
};
