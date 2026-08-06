import type { Message } from './message.js';

export interface BuildMemoryContextSuffixProps {
  readonly accumulatedContext: string;
  readonly afferentContext: readonly Message[];
  readonly broadcast: Message;
  readonly response: Message;
}

/** Builds durable append-only node experience. */
export interface MemoryContextBuilder {
  /** Returns only new material; callers append it without rewriting history. */
  readonly buildContextSuffix: (props: BuildMemoryContextSuffixProps) => string;
}
