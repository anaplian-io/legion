import { describe, expect, it, vi } from 'vitest';
import { ConcreteErrorStream } from './concrete-error-stream.js';

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

  it('stops delivering reports after unsubscribe', () => {
    const errors = new ConcreteErrorStream();
    const received = vi.fn();
    const unsubscribe = errors.subscribe(received);

    unsubscribe();
    unsubscribe();
    errors.publish({ source: 'test', message: 'detached' });

    expect(received).not.toHaveBeenCalled();
  });
});
