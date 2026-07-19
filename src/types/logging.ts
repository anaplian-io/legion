/** A stream that can attach one durable consumer for every value it publishes. */
export interface LoggableStream<Entry> {
  readonly name: string;
  readonly subscribeForLogging: (receiver: (entry: Entry) => void) => void;
  readonly serializeForLogging: (entry: Entry) => unknown;
}

/**
 * Owns durable stream consumers. Streams register themselves here at creation
 * time, so adding a stream does not require remembering a separate log setup.
 */
export interface LogRouter {
  readonly consume: <Entry>(stream: LoggableStream<Entry>) => void;
}
