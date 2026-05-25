/**
 * EventStream - A simple publish/subscribe system for decoupled event handling.
 *
 * Events are fired and forgotten (fire-and-forget) to avoid blocking publishers
 * when subscribers throw errors or are slow. Subscribers should handle their own
 * error cases.
 */

import {
  PublishProps,
  SubscribeProps,
  EventStream,
} from '../types/event-stream.js';

export class ConcreteEventStream implements EventStream {
  private readonly subscriptions = new Map<
    string,
    Set<(data: unknown) => void | Promise<void>>
  >();

  public publish = (props: PublishProps): void => {
    const receivers = this.subscriptions.get(props.topicName);
    if (!receivers) return;
    for (const receiver of receivers) {
      try {
        receiver(props.data);
      } catch (e) {
        console.error(
          `[EventStream] Subscriber threw error on topic "${props.topicName}":`,
          e,
        );
      }
    }
  };

  public subscribe = (props: SubscribeProps): void => {
    let receivers = this.subscriptions.get(props.topicName);
    if (!receivers) {
      receivers = new Set();
      this.subscriptions.set(props.topicName, receivers);
    }
    // Cast receiver to match the Map's Set type
    receivers.add(props.receiver as (data: unknown) => void | Promise<void>);
  };
}
