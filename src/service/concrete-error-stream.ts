import { ErrorReport, ErrorStream } from '../types/error-stream.js';
import { LogRouter } from '../types/logging.js';

export interface ConcreteErrorStreamOptions {
  readonly logRouter?: LogRouter;
}

/**
 * A failure-isolated stream for recoverable errors. Its optional LogRouter is
 * attached during construction, which gives every production error stream a
 * durable consumer without a separate setup step.
 */
export class ConcreteErrorStream implements ErrorStream {
  private readonly receivers = new Set<(report: ErrorReport) => void>();

  constructor(options?: ConcreteErrorStreamOptions) {
    options?.logRouter?.consume({
      name: 'errors',
      subscribeForLogging: this.subscribe,
      serializeForLogging: (report) => ({
        source: report.source,
        message: report.message,
        ...(report.error === undefined ? {} : { error: report.error }),
        ...(report.metadata === undefined ? {} : { metadata: report.metadata }),
      }),
    });
  }

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
  ): void => {
    this.receivers.add(receiver);
  };
}
