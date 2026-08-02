import { describe, expect, it, vi } from 'vitest';
import type {
  TelemetryClock,
  TelemetryEvent,
  TelemetryIdFactory,
} from '../types/telemetry.js';
import {
  classifyTelemetryError,
  TelemetryRecorder,
} from './telemetry-recorder.js';

const fixture = (diagnostics = false) => {
  let monotonic = 10;
  let id = 0;
  const clock: TelemetryClock = {
    wallNow: () => new Date('2026-08-02T12:00:00.000Z'),
    monotonicNow: () => monotonic,
  };
  const idFactory: TelemetryIdFactory = {
    create: (kind) => `${kind}-${++id}`,
  };
  const recorder = new TelemetryRecorder({
    runId: 'run-1',
    clock,
    idFactory,
    includeDiagnostics: diagnostics,
    maxTextLength: 5,
    redactedKeys: ['secret'],
  });
  return {
    recorder,
    advance: (milliseconds: number) => {
      monotonic += milliseconds;
    },
  };
};

describe('TelemetryRecorder', () => {
  it('adds a stable flat envelope and supports subscription cleanup', () => {
    const { recorder, advance } = fixture();
    const events: TelemetryEvent[] = [];
    const unsubscribe = recorder.subscribe((event) => events.push(event));

    recorder.startRun();
    advance(2);
    const span = recorder.startSpan('work');
    advance(3);
    recorder.record(
      'system.notice',
      { message: 'ready' },
      {
        epochId: 'epoch-1',
        wave: 'cognitive',
        candidateId: 'candidate-1',
        nodeId: 'node-1',
        parentSpanId: 'parent-1',
      },
      span.spanId,
    );
    unsubscribe();
    recorder.completeRun('success');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      sequence: 0,
      runId: 'run-1',
      event: 'run.started',
      monotonicMs: 0,
    });
    expect(events[1]).toMatchObject({
      sequence: 1,
      epochId: 'epoch-1',
      wave: 'cognitive',
      candidateId: 'candidate-1',
      nodeId: 'node-1',
      spanId: 'work-1',
      parentSpanId: 'parent-1',
      monotonicMs: 5,
    });
    expect(recorder.durationSince(span.startedAtMs)).toBe(3);
    expect(recorder.createId('candidate')).toBe('candidate-2');
  });

  it('isolates telemetry consumers from observed operations', () => {
    const { recorder } = fixture();
    const received: TelemetryEvent[] = [];
    recorder.subscribe(() => {
      throw new Error('sink failed');
    });
    recorder.subscribe((event) => received.push(event));

    expect(() => recorder.startRun()).not.toThrow();
    expect(received).toHaveLength(1);
  });

  it('derives epoch provider and tool metrics from completion records', () => {
    const { recorder, advance } = fixture();
    const events: TelemetryEvent[] = [];
    recorder.subscribe((event) => events.push(event));
    const epoch = recorder.beginEpoch(['input-1']);
    expect(recorder.currentEpochContext).toEqual(epoch);
    advance(4);
    recorder.record(
      'inference.completed',
      {
        inferenceId: 'inference-1',
        stage: 'node-generation',
        durationMs: 4,
        outcome: 'success',
      },
      epoch,
    );
    recorder.record(
      'tool.invocation-completed',
      {
        requestId: 'request-1',
        callId: 'call-1',
        toolName: 'search',
        durationMs: 2,
        outcome: 'success',
      },
      {
        ...epoch,
        wave: 'cognitive',
        candidateId: 'candidate-tool',
        nodeId: 'tool-node',
      },
    );
    advance(6);
    const zero = { generated: 0, attentionPassed: 0, selected: 0 };
    recorder.completeEpoch(epoch, {
      status: 'success',
      counts: zero,
      waveCounts: { afferent: zero, cognitive: zero },
    });

    const completed = events.find(
      (event): event is TelemetryEvent<'epoch.completed'> =>
        event.event === 'epoch.completed',
    );
    expect(completed?.data).toMatchObject({
      inferenceCount: 1,
      toolCallCount: 1,
      totalProviderDurationMs: 4,
      criticalPathDurationMs: 10,
    });
    expect(recorder.currentEpochContext).toBeUndefined();
  });

  it('rejects overlapping and unknown epoch completion', () => {
    const { recorder } = fixture();
    const epoch = recorder.beginEpoch();
    expect(() => recorder.beginEpoch()).toThrow('is still active');
    const zero = { generated: 0, attentionPassed: 0, selected: 0 };
    expect(() =>
      recorder.completeEpoch(
        { epochId: 'missing' },
        {
          status: 'failure',
          counts: zero,
          waveCounts: { afferent: zero, cognitive: zero },
        },
      ),
    ).toThrow('was not started');
    recorder.completeEpoch(epoch, {
      status: 'failure',
      counts: zero,
      waveCounts: { afferent: zero, cognitive: zero },
    });
  });

  it('bounds and redacts diagnostics while omitting them by default', () => {
    const hidden = fixture().recorder;
    expect(hidden.diagnosticValue({ value: 'payload' })).toBeUndefined();

    const { recorder } = fixture(true);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const error = new Error('failure-message');
    expect(
      recorder.diagnosticValue({
        secret: 'token',
        text: 'long-value',
        number: 2,
        boolean: true,
        nil: null,
        missing: undefined,
        error,
        array: ['long-value'],
        circular,
        symbol: Symbol('x'),
      }),
    ).toEqual({
      secret: '[REDACTED]',
      text: 'long-…',
      number: 2,
      boolean: true,
      nil: null,
      missing: undefined,
      error: { name: 'Error', message: 'failu…' },
      array: ['long-…'],
      circular: { self: '[Circular]' },
      symbol: 'Symbo…',
    });
    expect(recorder.sanitizeText('short')).toBe('short');
    expect(
      recorder.diagnosticValue(
        Array.from({ length: 100 }, (_, index) => index),
      ),
    ).toHaveLength(32);
    expect(
      JSON.stringify(
        recorder.diagnosticValue(
          Array.from({ length: 32 }, () =>
            Array.from({ length: 32 }, () => 'value'),
          ),
        ),
      ),
    ).toContain('[Truncated]');
    const longKey = 'x'.repeat(200);
    expect(recorder.diagnosticValue({ [longKey]: 'value' })).toHaveProperty(
      `${'x'.repeat(128)}…`,
    );
  });

  it('classifies bounded error categories', () => {
    const unnamed = new Error('unnamed');
    unnamed.name = '';
    expect(classifyTelemetryError(new TypeError('bad'))).toBe('TypeError');
    expect(classifyTelemetryError(unnamed)).toBe('Error');
    expect(classifyTelemetryError('bad')).toBe('string-error');
    expect(classifyTelemetryError(undefined)).toBe('unknown-error');
    const longName = new Error('bad');
    longName.name = 'x'.repeat(100);
    expect(classifyTelemetryError(longName)).toHaveLength(64);
  });

  it('uses default clocks and IDs when none are injected', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid' });
    const recorder = new TelemetryRecorder();
    expect(recorder.runId).toBe('run-uuid');
    expect(recorder.monotonicNow()).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });
});
