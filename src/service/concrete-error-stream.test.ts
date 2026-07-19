import { describe, expect, it, vi } from 'vitest';
import { ConcreteErrorStream } from './concrete-error-stream.js';
import type { LoggableStream, LogRouter } from '../types/logging.js';
import type { ErrorReport } from '../types/error-stream.js';

describe('ConcreteErrorStream', () => {
  it('delivers reports and isolates a throwing consumer', () => {
    const errors = new ConcreteErrorStream();
    const delivered = vi.fn();
    errors.subscribe(() => {
      throw new Error('broken consumer');
    });
    errors.subscribe(delivered);

    expect(() =>
      errors.publish({ source: 'test', message: 'continued after failure' }),
    ).not.toThrow();
    expect(delivered).toHaveBeenCalledWith({
      source: 'test',
      message: 'continued after failure',
    });
  });

  it('automatically gives itself a structured log consumer', () => {
    let loggedStream: LoggableStream<ErrorReport> | undefined;
    const router: LogRouter = {
      consume: (stream) => {
        loggedStream = stream as unknown as LoggableStream<ErrorReport>;
      },
    };
    const errors = new ConcreteErrorStream({ logRouter: router });

    expect(loggedStream?.name).toBe('errors');
    const minimal = loggedStream?.serializeForLogging({
      source: 'test',
      message: 'minimal',
    });
    const detailed = loggedStream?.serializeForLogging({
      source: 'test',
      message: 'detailed',
      error: new Error('failed'),
      metadata: { operation: 'write' },
    });

    expect(minimal).toEqual({ source: 'test', message: 'minimal' });
    expect(detailed).toEqual({
      source: 'test',
      message: 'detailed',
      error: expect.any(Error),
      metadata: { operation: 'write' },
    });

    const received = vi.fn();
    loggedStream?.subscribeForLogging(received);
    errors.publish({ source: 'test', message: 'written through consumer' });
    expect(received).toHaveBeenCalledWith({
      source: 'test',
      message: 'written through consumer',
    });
  });
});
