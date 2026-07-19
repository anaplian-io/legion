import * as fs from 'node:fs';
import path from 'node:path';
import { LoggableStream, LogRouter } from '../types/logging.js';

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

/**
 * A synchronous JSON Lines sink. It appends while a file is below its size
 * limit, then continues in `stream.1.jsonl`, `stream.2.jsonl`, and so on.
 * JSONL is intentionally easy to tail, query, and recover after a crash.
 */
export class JsonlLogRouter implements LogRouter {
  private readonly directory: string;
  private readonly maxFileBytes: number;
  private readonly now: () => Date;

  constructor(options: JsonlLogRouterOptions) {
    this.directory = path.normalize(options.directory);
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  public readonly consume = <Entry>(stream: LoggableStream<Entry>): void => {
    stream.subscribeForLogging((entry) => {
      this.write({
        timestamp: this.now().toISOString(),
        stream: stream.name,
        entry: stream.serializeForLogging(entry),
      });
    });
  };

  private readonly write = (record: DurableLogRecord): void => {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const line = `${JSON.stringify(toJsonSafe(record))}\n`;
      const file = this.fileFor(record.stream, Buffer.byteLength(line));
      fs.appendFileSync(file, line);
    } catch {
      // Logging must never change the result of the operation being logged.
      // There is no safer durable destination to report a logging I/O failure.
    }
  };

  private readonly fileFor = (
    streamName: string,
    nextLineBytes: number,
  ): string => {
    let index = 0;
    let file = path.join(this.directory, `${streamName}.${index}.jsonl`);
    while (fs.existsSync(file)) {
      try {
        if (fs.statSync(file).size + nextLineBytes <= this.maxFileBytes) {
          return file;
        }
      } catch {
        // A raced deletion or inaccessible file is retried as the current file.
        return file;
      }
      index += 1;
      file = path.join(this.directory, `${streamName}.${index}.jsonl`);
    }
    return file;
  };
}

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
