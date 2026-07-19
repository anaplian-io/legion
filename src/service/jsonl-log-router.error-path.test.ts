import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appendFileSync, existsSync, mkdirSync, statSync } = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
}));

import { JsonlLogRouter } from './jsonl-log-router.js';
import type { LoggableStream } from '../types/logging.js';

const makeStream = (): {
  readonly stream: LoggableStream<string>;
  readonly publish: (entry: string) => void;
} => {
  let receiver: ((entry: string) => void) | undefined;
  return {
    stream: {
      name: 'events',
      subscribeForLogging: (nextReceiver) => {
        receiver = nextReceiver;
      },
      serializeForLogging: (entry) => entry,
    },
    publish: (entry) => receiver?.(entry),
  };
};

describe('JsonlLogRouter I/O failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('continues when a rotation stat races with a file deletion', () => {
    existsSync.mockReturnValue(true);
    statSync.mockImplementation(() => {
      throw new Error('raced deletion');
    });
    const { stream, publish } = makeStream();
    new JsonlLogRouter({ directory: '/tmp/logs' }).consume(stream);

    expect(() => publish('event')).not.toThrow();
    expect(appendFileSync).toHaveBeenCalledWith(
      '/tmp/logs/events.0.jsonl',
      expect.stringContaining('event'),
    );
  });

  it('does not let logging I/O failures affect the publishing stream', () => {
    mkdirSync.mockImplementation(() => {
      throw new Error('read-only disk');
    });
    const { stream, publish } = makeStream();
    new JsonlLogRouter({ directory: '/tmp/logs' }).consume(stream);

    expect(() => publish('event')).not.toThrow();
    expect(appendFileSync).not.toHaveBeenCalled();
  });
});
