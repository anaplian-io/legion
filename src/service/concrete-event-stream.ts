/**
 * EventStream - A simple publish/subscribe system for decoupled event handling.
 *
 * Events are fired and forgotten (fire-and-forget) to avoid blocking publishers
 * when subscribers throw errors or are slow. Subscriber failures are published
 * to the separate error stream, and an optional log router consumes every event
 * as soon as this stream is created.
 */

import {
  EventStream,
  PublishProps,
  SubscribeProps,
} from '../types/event-stream.js';
import { ErrorReport, ErrorStream } from '../types/error-stream.js';
import { LogRouter } from '../types/logging.js';
import { ConcreteErrorStream } from './concrete-error-stream.js';

export interface ConcreteEventStreamOptions {
  readonly errorStream?: ErrorStream;
  readonly logRouter?: LogRouter;
}

export class ConcreteEventStream implements EventStream {
  private readonly subscriptions = new Map<
    string,
    Set<(data: unknown) => void | Promise<void>>
  >();
  private readonly allSubscribers = new Set<
    (props: PublishProps) => void | Promise<void>
  >();
  private readonly errorStream: ErrorStream;

  constructor(options?: ConcreteEventStreamOptions) {
    this.errorStream = options?.errorStream ?? new ConcreteErrorStream();
    options?.logRouter?.consume({
      name: 'events',
      subscribeForLogging: this.subscribeAll,
      serializeForLogging: serializePublishedEvent,
    });
  }

  public readonly publish = (props: PublishProps): void => {
    this.dispatch(
      this.allSubscribers,
      props,
      `all-event subscriber for topic "${props.topicName}"`,
    );
    const receivers = this.subscriptions.get(props.topicName);
    if (receivers !== undefined) {
      this.dispatch(
        receivers,
        props.data,
        `subscriber for topic "${props.topicName}"`,
      );
    }
  };

  public readonly subscribe = (props: SubscribeProps): void => {
    let receivers = this.subscriptions.get(props.topicName);
    if (receivers === undefined) {
      receivers = new Set();
      this.subscriptions.set(props.topicName, receivers);
    }
    receivers.add(props.receiver as (data: unknown) => void | Promise<void>);
  };

  public readonly subscribeAll = (
    receiver: (props: PublishProps) => void | Promise<void>,
  ): void => {
    this.allSubscribers.add(receiver);
  };

  public readonly reportError = (report: ErrorReport): void => {
    this.errorStream.publish(report);
  };

  private readonly dispatch = <Value>(
    receivers: ReadonlySet<(value: Value) => void | Promise<void>>,
    value: Value,
    description: string,
  ): void => {
    for (const receiver of receivers) {
      try {
        const result = receiver(value);
        if (result instanceof Promise) {
          void result.catch((error: unknown) => {
            this.reportError({
              source: 'EventStream',
              message: `An asynchronous ${description} rejected.`,
              error,
            });
          });
        }
      } catch (error) {
        this.reportError({
          source: 'EventStream',
          message: `A ${description} threw.`,
          error,
        });
      }
    }
  };
}

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
    default:
      return props;
  }
};
