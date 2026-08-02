import { ErrorReport, ErrorStream } from '../types/error-stream.js';

/**
 * A failure-isolated stream for recoverable errors. Durable routing is attached
 * separately so diagnostics and application error handling remain independent.
 */
export class ConcreteErrorStream implements ErrorStream {
  private readonly receivers = new Set<(report: ErrorReport) => void>();

  public readonly publish = (report: ErrorReport): void => {
    for (const receiver of this.receivers) {
      try {
        receiver(report);
      } catch {
        // An error handler must never make application error handling throw.
        // The durable log sink is the first subscriber in production.
      }
    }
  };

  public readonly subscribe = (
    receiver: (report: ErrorReport) => void,
  ): (() => void) => {
    this.receivers.add(receiver);
    return () => {
      this.receivers.delete(receiver);
    };
  };
}
