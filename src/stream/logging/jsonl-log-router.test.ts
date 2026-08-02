import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonlLogRouter } from './jsonl-log-router.js';
import type { LoggableStream } from '../../types/logging.js';

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
        return () => {
          receiver = undefined;
        };
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
  it('writes safe, structured JSONL records for arbitrary stream entries', async () => {
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
    await router.flush();

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
    await router.close();
  });

  it('appends to the current file and rotates once it reaches the byte limit', async () => {
    const directory = makeDirectory();
    const appendingRouter = new JsonlLogRouter({ directory });
    const appending = makeStream<string>('appending');
    appendingRouter.consume(appending.stream);
    appending.publish('first');
    appending.publish('second');
    await appendingRouter.flush();
    const appendedEntries = fs
      .readFileSync(path.join(directory, 'appending.0.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { entry: string })
      .map(({ entry }) => entry);
    expect(appendedEntries).toEqual(['first', 'second']);

    const rotatingRouter = new JsonlLogRouter({
      directory,
      maxFileBytes: 1,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });
    const rotating = makeStream<string>('rotating');
    rotatingRouter.consume(rotating.stream);
    rotating.publish('first');
    rotating.publish('second');
    await rotatingRouter.flush();

    expect(fs.existsSync(path.join(directory, 'rotating.0.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(directory, 'rotating.1.jsonl'))).toBe(true);
    await appendingRouter.close();
    await rotatingRouter.close();
  });

  it('reopens the latest sequence file when it still has capacity', async () => {
    const directory = makeDirectory();
    const firstRouter = new JsonlLogRouter({ directory });
    const first = makeStream<string>('events');
    firstRouter.consume(first.stream);
    first.publish('first process');
    await firstRouter.close();

    const secondRouter = new JsonlLogRouter({ directory });
    const second = makeStream<string>('events');
    secondRouter.consume(second.stream);
    second.publish('second process');
    await secondRouter.close();

    const entries = fs
      .readFileSync(path.join(directory, 'events.0.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { entry: string })
      .map(({ entry }) => entry);
    expect(entries).toEqual(['first process', 'second process']);
  });

  it('skips pre-existing sequence files that are already full', async () => {
    const directory = makeDirectory();
    fs.writeFileSync(path.join(directory, 'events.0.jsonl'), 'full');
    const router = new JsonlLogRouter({
      directory,
      maxFileBytes: 1,
    });
    const events = makeStream<string>('events');
    router.consume(events.stream);

    events.publish('next');
    await router.close();

    expect(fs.existsSync(path.join(directory, 'events.1.jsonl'))).toBe(true);
  });

  it('detaches streams and safely supports repeated close calls', async () => {
    const directory = makeDirectory();
    const router = new JsonlLogRouter({ directory });
    const attached = makeStream<string>('attached');
    router.consume(attached.stream);
    attached.publish('before close');

    await router.close();
    attached.publish('after close');
    router.consume(makeStream<string>('ignored').stream);
    await router.close();

    const contents = fs.readFileSync(
      path.join(directory, 'attached.0.jsonl'),
      'utf8',
    );
    expect(contents).toContain('before close');
    expect(contents).not.toContain('after close');
    expect(fs.existsSync(path.join(directory, 'ignored.0.jsonl'))).toBe(false);
  });
});
