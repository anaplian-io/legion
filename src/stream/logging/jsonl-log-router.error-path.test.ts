import { beforeEach, describe, expect, it, vi } from 'vitest';

const { close, mkdir, open, stat, write } = vi.hoisted(() => ({
  close: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  stat: vi.fn(),
  write: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: { mkdir, open, stat },
}));

import { JsonlLogRouter } from './jsonl-log-router.js';
import type { LoggableStream } from '../../types/logging.js';

const makeStream = (
  serializeForLogging: (entry: string) => unknown = (entry) => entry,
): {
  readonly stream: LoggableStream<string>;
  readonly publish: (entry: string) => void;
} => {
  let receiver: ((entry: string) => void) | undefined;
  return {
    stream: {
      name: 'events',
      subscribeForLogging: (nextReceiver) => {
        receiver = nextReceiver;
        return () => {
          receiver = undefined;
        };
      },
      serializeForLogging,
    },
    publish: (entry) => receiver?.(entry),
  };
};

describe('JsonlLogRouter I/O failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    stat.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    write.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
    open.mockResolvedValue({ close, write });
  });

  it('does not let an inaccessible rotation file affect the publishing stream', async () => {
    stat.mockRejectedValue(
      Object.assign(new Error('inaccessible'), { code: 'EACCES' }),
    );
    const { stream, publish } = makeStream();
    const router = new JsonlLogRouter({ directory: '/tmp/logs' });
    router.consume(stream);

    expect(() => publish('event')).not.toThrow();
    await router.flush();

    expect(open).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await router.close();
  });

  it('isolates a failed write without poisoning later queued writes', async () => {
    mkdir.mockRejectedValueOnce(new Error('read-only disk'));
    const { stream, publish } = makeStream();
    const router = new JsonlLogRouter({ directory: '/tmp/logs' });
    router.consume(stream);

    publish('first');
    publish('second');
    await router.flush();

    expect(write).toHaveBeenCalledTimes(1);
    await router.close();
  });

  it('isolates serialization failures from publishers', async () => {
    const brokenSerialization = makeStream(() => {
      throw new Error('bad serializer');
    });
    const serializerRouter = new JsonlLogRouter({ directory: '/tmp/logs' });
    serializerRouter.consume(brokenSerialization.stream);

    expect(() => brokenSerialization.publish('event')).not.toThrow();
    await serializerRouter.close();

    expect(write).not.toHaveBeenCalled();
  });

  it('does not let file-handle close failures affect teardown', async () => {
    close.mockRejectedValue(new Error('close failed'));
    const { stream, publish } = makeStream();
    const router = new JsonlLogRouter({ directory: '/tmp/logs' });
    router.consume(stream);
    publish('event');
    await router.flush();

    await expect(router.close()).resolves.toBeUndefined();
  });

  it('ignores late publication from a stream that fails to detach', async () => {
    let receiver: ((entry: string) => void) | undefined;
    const stream: LoggableStream<string> = {
      name: 'events',
      subscribeForLogging: (nextReceiver) => {
        receiver = nextReceiver;
        return () => undefined;
      },
      serializeForLogging: (entry) => entry,
    };
    const router = new JsonlLogRouter({ directory: '/tmp/logs' });
    router.consume(stream);
    await router.close();

    expect(() => receiver?.('late')).not.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
