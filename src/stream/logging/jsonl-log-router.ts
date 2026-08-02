import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { LoggableStream, LogRouter } from '../../types/logging.js';
import { Unsubscribe } from '../../types/subscription.js';

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface JsonlLogRouterOptions {
  /** Directory in which one rotated JSONL sequence is kept per stream. */
  readonly directory: string;
  /** Maximum size of one sequence file before a new numbered file is used. */
  readonly maxFileBytes?: number;
  /** Injectable clock keeps timestamps deterministic in tests. */
  readonly now?: () => Date;
}

interface DurableLogRecord {
  readonly timestamp: string;
  readonly stream: string;
  readonly entry: unknown;
}

interface StreamFileState {
  readonly index: number;
  readonly file: string;
  readonly handle: FileHandle;
  bytes: number;
}

/**
 * An ordered, buffered JSON Lines sink. Records are serialized when accepted,
 * then written in publication order without blocking the publisher. Callers
 * must close the router during graceful shutdown to drain writes and release
 * file handles.
 */
export class JsonlLogRouter implements LogRouter {
  private readonly directory: string;
  private readonly maxFileBytes: number;
  private readonly now: () => Date;
  private readonly states = new Map<string, StreamFileState>();
  private readonly unsubscribers = new Set<Unsubscribe>();
  private pendingWrites: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: JsonlLogRouterOptions) {
    this.directory = path.normalize(options.directory);
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  public readonly consume = <Entry>(stream: LoggableStream<Entry>): void => {
    if (this.closed) {
      return;
    }
    const unsubscribe = stream.subscribeForLogging((entry) => {
      if (this.closed) {
        return;
      }
      try {
        const record: DurableLogRecord = {
          timestamp: this.now().toISOString(),
          stream: stream.name,
          entry: stream.serializeForLogging(entry),
        };
        const line = `${JSON.stringify(toJsonSafe(record))}\n`;
        this.enqueue(stream.name, line);
      } catch {
        // Logging must never change the result of the operation being logged.
      }
    });
    this.unsubscribers.add(unsubscribe);
  };

  public readonly flush = async (): Promise<void> => {
    await this.pendingWrites;
  };

  public readonly close = async (): Promise<void> => {
    if (this.closed) {
      await this.flush();
      return;
    }
    this.closed = true;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.clear();
    await this.flush();
    await Promise.all(
      [...this.states.values()].map(async ({ handle }) => {
        try {
          await handle.close();
        } catch {
          // Closing diagnostics must never make application teardown fail.
        }
      }),
    );
    this.states.clear();
  };

  private readonly enqueue = (streamName: string, line: string): void => {
    this.pendingWrites = this.pendingWrites
      .then(() => this.append(streamName, line))
      .catch(() => {
        // A failed write is isolated and does not poison later queued writes.
      });
  };

  private readonly append = async (
    streamName: string,
    line: string,
  ): Promise<void> => {
    const nextLineBytes = Buffer.byteLength(line);
    let state = this.states.get(streamName);
    if (state === undefined) {
      await fs.mkdir(this.directory, { recursive: true });
      state = await this.openAvailableFile(streamName, 0, nextLineBytes);
      this.states.set(streamName, state);
    } else if (
      state.bytes > 0 &&
      state.bytes + nextLineBytes > this.maxFileBytes
    ) {
      await state.handle.close();
      state = await this.openAvailableFile(
        streamName,
        state.index + 1,
        nextLineBytes,
      );
      this.states.set(streamName, state);
    }
    await state.handle.write(line);
    state.bytes += nextLineBytes;
  };

  private readonly openAvailableFile = async (
    streamName: string,
    startingIndex: number,
    nextLineBytes: number,
  ): Promise<StreamFileState> => {
    let index = startingIndex;
    while (true) {
      const file = path.join(this.directory, `${streamName}.${index}.jsonl`);
      try {
        const { size } = await fs.stat(file);
        if (size + nextLineBytes <= this.maxFileBytes) {
          return {
            index,
            file,
            handle: await fs.open(file, 'a'),
            bytes: size,
          };
        }
      } catch (error) {
        if (isMissingFile(error)) {
          return {
            index,
            file,
            handle: await fs.open(file, 'a'),
            bytes: 0,
          };
        }
        throw error;
      }
      index += 1;
    }
  };
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';

const toJsonSafe = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'undefined') {
    return '[undefined]';
  }
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
      ...('cause' in value ? { cause: toJsonSafe(value.cause, seen) } : {}),
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item, seen));
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [
        String(key),
        toJsonSafe(item, seen),
      ]),
    );
  }
  if (value instanceof Set) {
    return [...value].map((item) => toJsonSafe(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toJsonSafe(item, seen);
  }
  return result;
};
