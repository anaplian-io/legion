import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonlLogRouter } from './jsonl-log-router.js';
import type { LoggableStream } from '../types/logging.js';

const temporaryDirectories: string[] = [];

const makeDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legion-logs-'));
  temporaryDirectories.push(directory);
  return directory;
};

const makeStream = <Entry>(
  name: string,
): {
  readonly stream: LoggableStream<Entry>;
  readonly publish: (entry: Entry) => void;
} => {
  let receiver: ((entry: Entry) => void) | undefined;
  return {
    stream: {
      name,
      subscribeForLogging: (nextReceiver) => {
        receiver = nextReceiver;
      },
      serializeForLogging: (entry) => entry,
    },
    publish: (entry) => receiver?.(entry),
  };
};

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  vi.restoreAllMocks();
});

describe('JsonlLogRouter', () => {
  it('writes safe, structured JSONL records for arbitrary stream entries', () => {
    const directory = makeDirectory();
    const router = new JsonlLogRouter({
      directory,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });
    const { stream, publish } = makeStream<Record<string, unknown>>('events');
    router.consume(stream);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    const nameless = function (): void {};
    Object.defineProperty(nameless, 'name', { value: '' });
    const errorWithCause = new Error('outer', { cause: new Error('inner') });
    const errorWithoutStack = new Error('no stack');
    Object.defineProperty(errorWithoutStack, 'stack', { value: undefined });

    publish({
      nil: null,
      text: 'hello',
      bool: true,
      finite: 3,
      infinite: Infinity,
      big: 9n,
      missing: undefined,
      named: function named(): void {},
      nameless,
      symbol: Symbol('stream'),
      errorWithCause,
      errorWithoutStack,
      date: new Date('2026-07-19T00:00:00.000Z'),
      circular,
      array: ['item'],
      map: new Map([['key', 'value']]),
      set: new Set(['value']),
    });

    const [line] = fs
      .readFileSync(path.join(directory, 'events.0.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(line ?? '')).toEqual({
      timestamp: '2026-07-19T12:00:00.000Z',
      stream: 'events',
      entry: {
        nil: null,
        text: 'hello',
        bool: true,
        finite: 3,
        infinite: 'Infinity',
        big: '9',
        missing: '[undefined]',
        named: '[Function named]',
        nameless: '[Function anonymous]',
        symbol: 'Symbol(stream)',
        errorWithCause: {
          name: 'Error',
          message: 'outer',
          stack: expect.any(String),
          cause: {
            name: 'Error',
            message: 'inner',
            stack: expect.any(String),
          },
        },
        errorWithoutStack: { name: 'Error', message: 'no stack' },
        date: '2026-07-19T00:00:00.000Z',
        circular: { self: '[Circular]' },
        array: ['item'],
        map: { key: 'value' },
        set: ['value'],
      },
    });
  });

  it('appends to the current file and rotates once it reaches the byte limit', () => {
    const directory = makeDirectory();
    const appendingRouter = new JsonlLogRouter({ directory });
    const appending = makeStream<string>('appending');
    appendingRouter.consume(appending.stream);
    appending.publish('first');
    appending.publish('second');
    expect(
      fs
        .readFileSync(path.join(directory, 'appending.0.jsonl'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(2);

    const rotatingRouter = new JsonlLogRouter({
      directory,
      maxFileBytes: 1,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });
    const rotating = makeStream<string>('rotating');
    rotatingRouter.consume(rotating.stream);
    rotating.publish('first');
    rotating.publish('second');

    expect(fs.existsSync(path.join(directory, 'rotating.0.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(directory, 'rotating.1.jsonl'))).toBe(true);
  });
});
