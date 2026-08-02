import { describe, expect, it, vi } from 'vitest';
import { TelemetryRecorder } from '../../telemetry/telemetry-recorder.js';
import { ConcreteErrorStream } from '../concrete-error-stream.js';
import { ConcreteEventStream } from '../concrete-event-stream.js';
import {
  connectErrorTelemetry,
  connectNoticeTelemetry,
  telemetryLogStream,
} from './loggable-streams.js';

describe('telemetry logging adapters', () => {
  it('exposes telemetry as the sole flat durable stream', () => {
    const telemetry = new TelemetryRecorder({ runId: 'run-1' });
    const stream = telemetryLogStream(telemetry);
    const received = vi.fn();
    const unsubscribe = stream.subscribeForLogging(received);
    telemetry.startRun();
    unsubscribe();
    telemetry.completeRun('success');

    expect(stream.name).toBe('telemetry');
    expect(received).toHaveBeenCalledTimes(1);
    const event = received.mock.calls[0]![0];
    expect(stream.serializeForLogging(event)).toBe(event);
  });

  it('bridges errors and notices with cleanup', () => {
    const telemetry = new TelemetryRecorder({ runId: 'run-1' });
    const errors = new ConcreteErrorStream();
    const events = new ConcreteEventStream();
    const received: string[] = [];
    telemetry.subscribe((event) => received.push(event.event));
    const disconnectErrors = connectErrorTelemetry(errors, telemetry);
    const disconnectNotices = connectNoticeTelemetry(events, telemetry);

    errors.publish({ source: 'test', message: 'failed', error: 'bad' });
    events.publish({ topicName: 'system/notice', data: { message: 'ready' } });
    disconnectErrors();
    disconnectNotices();
    errors.publish({ source: 'test', message: 'ignored' });
    events.publish({
      topicName: 'system/notice',
      data: { message: 'ignored' },
    });

    expect(received).toEqual(['error.reported', 'system.notice']);
  });

  it('includes opt-in diagnostics and preserves explicit correlation', () => {
    const telemetry = new TelemetryRecorder({
      runId: 'run-1',
      includeDiagnostics: true,
    });
    const errors = new ConcreteErrorStream();
    const events = new ConcreteEventStream();
    const received: import('../../types/telemetry.js').TelemetryEvent[] = [];
    telemetry.subscribe((event) => received.push(event));
    connectErrorTelemetry(errors, telemetry);
    connectNoticeTelemetry(events, telemetry);

    const epoch = telemetry.beginEpoch();
    errors.publish({
      source: 'test',
      message: 'failed',
      error: new TypeError('bad'),
      metadata: { operation: 'rank' },
      telemetry: { ...epoch, candidateId: 'candidate-1' },
    });
    events.publish({
      topicName: 'system/notice',
      data: { message: 'ready', metadata: { nodeCount: 2 } },
    });

    expect(received[1]).toMatchObject({
      event: 'error.reported',
      epochId: epoch.epochId,
      candidateId: 'candidate-1',
      data: {
        diagnostics: {
          error: { name: 'TypeError', message: 'bad' },
          metadata: { operation: 'rank' },
        },
      },
    });
    expect(received[2]).toMatchObject({
      event: 'system.notice',
      epochId: epoch.epochId,
      data: { metadata: { nodeCount: 2 } },
    });
  });
});
