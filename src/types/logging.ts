import { Unsubscribe } from './subscription.js';

/** A stream that can attach one durable consumer for every value it publishes. */
export interface LoggableStream<Entry> {
  readonly name: string;
  readonly subscribeForLogging: (
    receiver: (entry: Entry) => void,
  ) => Unsubscribe;
  readonly serializeForLogging: (entry: Entry) => unknown;
}

/**
 * Owns durable stream consumers and their drain/close lifecycle. Composition
 * roots attach loggable adapters so publishers remain storage-independent.
 */
export interface LogRouter {
  readonly consume: <Entry>(stream: LoggableStream<Entry>) => void;
  /** Wait until every record accepted so far has reached durable storage. */
  readonly flush: () => Promise<void>;
  /** Detach streams, drain accepted records, and release file handles. */
  readonly close: () => Promise<void>;
}
