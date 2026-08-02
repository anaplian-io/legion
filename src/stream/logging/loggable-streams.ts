import type { ErrorReport, ErrorStream } from '../../types/error-stream.js';
import type { ObservableEventStream } from '../../types/event-stream.js';
import type { LoggableStream } from '../../types/logging.js';
import type { TelemetryEvent } from '../../types/telemetry.js';
import {
  classifyTelemetryError,
  TelemetryRecorder,
} from '../../telemetry/telemetry-recorder.js';

/** The sole durable application log contract. Records are already flat JSON. */
export const telemetryLogStream = (
  telemetry: TelemetryRecorder,
): LoggableStream<TelemetryEvent> => ({
  name: 'telemetry',
  subscribeForLogging: telemetry.subscribe,
  serializeForLogging: (event) => event,
});

/** Converts recoverable application errors into the unified telemetry stream. */
export const connectErrorTelemetry = (
  errorStream: ErrorStream,
  telemetry: TelemetryRecorder,
): (() => void) =>
  errorStream.subscribe((report) => {
    const diagnostics = telemetry.diagnosticValue(errorDetails(report));
    telemetry.record(
      'error.reported',
      {
        source: report.source,
        message: telemetry.sanitizeText(report.message),
        errorCategory: classifyTelemetryError(report.error),
        ...(diagnostics === undefined ? {} : { diagnostics }),
      },
      report.telemetry ?? telemetry.currentEpochContext ?? {},
    );
  });

/** Correlates explicit system notices without serializing every domain event. */
export const connectNoticeTelemetry = (
  eventStream: ObservableEventStream,
  telemetry: TelemetryRecorder,
): (() => void) =>
  eventStream.subscribe({
    topicName: 'system/notice',
    receiver: ({ message, metadata }) => {
      const sanitizedMetadata = telemetry.diagnosticValue(metadata);
      telemetry.record(
        'system.notice',
        {
          message: telemetry.sanitizeText(message),
          ...(sanitizedMetadata === undefined
            ? {}
            : {
                metadata: sanitizedMetadata as Readonly<
                  Record<string, unknown>
                >,
              }),
        },
        telemetry.currentEpochContext ?? {},
      );
    },
  });

const errorDetails = (report: ErrorReport): unknown => ({
  error: report.error,
  metadata: report.metadata,
});
