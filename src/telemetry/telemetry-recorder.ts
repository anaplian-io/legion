import {
  EpochCounts,
  EpochTelemetryContext,
  TelemetryClock,
  TelemetryEvent,
  TelemetryEventContext,
  TelemetryEventDataMap,
  TelemetryEventType,
  TelemetryIdFactory,
  TelemetryOutcome,
  TelemetrySpan,
  TelemetryStream,
  TELEMETRY_SCHEMA_VERSION,
  WaveCounts,
} from '../types/telemetry.js';

const DEFAULT_MAX_TEXT_LENGTH = 512;
const DEFAULT_REDACTED_KEYS = ['apiKey', 'authorization', 'password', 'token'];
const MAX_ERROR_CATEGORY_LENGTH = 64;
const MAX_DIAGNOSTIC_COLLECTION_LENGTH = 32;
const MAX_DIAGNOSTIC_VALUES = 256;
const MAX_DIAGNOSTIC_KEY_LENGTH = 128;

interface SanitizationState {
  readonly seen: WeakSet<object>;
  remainingValues: number;
}

export interface TelemetryRecorderOptions {
  readonly runId?: string;
  readonly clock?: TelemetryClock;
  readonly idFactory?: TelemetryIdFactory;
  readonly includeDiagnostics?: boolean;
  readonly maxTextLength?: number;
  readonly redactedKeys?: readonly string[];
}

interface EpochMetrics {
  readonly startedAtMs: number;
  inferenceCount: number;
  toolCallCount: number;
  totalProviderDurationMs: number;
}

export interface CompleteEpochData {
  readonly status: Extract<TelemetryOutcome, 'success' | 'failure'>;
  readonly counts: EpochCounts;
  readonly waveCounts: WaveCounts;
}

export class TelemetryRecorder implements TelemetryStream {
  public readonly runId: string;
  private readonly clock: TelemetryClock;
  private readonly idFactory: TelemetryIdFactory;
  private readonly includeDiagnostics: boolean;
  private readonly maxTextLength: number;
  private readonly redactedKeys: ReadonlySet<string>;
  private readonly receivers = new Set<(event: TelemetryEvent) => void>();
  private readonly runStartedAtMs: number;
  private readonly epochMetrics = new Map<string, EpochMetrics>();
  private sequence = 0;
  private activeEpochId: string | undefined;

  constructor(options: TelemetryRecorderOptions = {}) {
    this.clock =
      options.clock ??
      ({
        wallNow: () => new Date(),
        monotonicNow: () => performance.now(),
      } satisfies TelemetryClock);
    this.idFactory =
      options.idFactory ??
      ({
        create: (kind) => `${kind}-${crypto.randomUUID()}`,
      } satisfies TelemetryIdFactory);
    this.runId = options.runId ?? this.idFactory.create('run');
    this.includeDiagnostics = options.includeDiagnostics ?? false;
    this.maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    this.redactedKeys = new Set(
      (options.redactedKeys ?? DEFAULT_REDACTED_KEYS).map((key) =>
        key.toLowerCase(),
      ),
    );
    this.runStartedAtMs = this.clock.monotonicNow();
  }

  public readonly subscribe = (
    receiver: (event: TelemetryEvent) => void,
  ): (() => void) => {
    this.receivers.add(receiver);
    return () => this.receivers.delete(receiver);
  };

  public readonly createId = (kind: string): string =>
    this.idFactory.create(kind);

  public readonly monotonicNow = (): number => this.clock.monotonicNow();

  public readonly startSpan = (kind: string): TelemetrySpan => ({
    spanId: this.createId(kind),
    startedAtMs: this.monotonicNow(),
  });

  public readonly durationSince = (startedAtMs: number): number =>
    Math.max(0, this.monotonicNow() - startedAtMs);

  public readonly startRun = (): void => {
    this.record('run.started', {}, {});
  };

  public readonly completeRun = (
    status: Extract<TelemetryOutcome, 'success' | 'failure'>,
  ): void => {
    this.record('run.completed', { status }, {});
  };

  public readonly beginEpoch = (
    inputIds: readonly string[] = [],
  ): EpochTelemetryContext => {
    if (this.activeEpochId !== undefined) {
      throw new Error(
        `[TelemetryRecorder] epoch ${this.activeEpochId} is still active`,
      );
    }
    const epochId = this.createId('epoch');
    const context = { epochId };
    const startedAtMs = this.monotonicNow();
    this.activeEpochId = epochId;
    this.epochMetrics.set(epochId, {
      startedAtMs,
      inferenceCount: 0,
      toolCallCount: 0,
      totalProviderDurationMs: 0,
    });
    this.publish(
      'epoch.started',
      { inputIds },
      context,
      undefined,
      startedAtMs,
    );
    return context;
  };

  public readonly completeEpoch = (
    context: EpochTelemetryContext,
    data: CompleteEpochData,
  ): void => {
    const metrics = this.epochMetrics.get(context.epochId);
    if (metrics === undefined) {
      throw new Error(
        `[TelemetryRecorder] epoch ${context.epochId} was not started`,
      );
    }
    const completedAtMs = this.monotonicNow();
    this.publish(
      'epoch.completed',
      {
        ...data,
        inferenceCount: metrics.inferenceCount,
        toolCallCount: metrics.toolCallCount,
        totalProviderDurationMs: metrics.totalProviderDurationMs,
        criticalPathDurationMs: Math.max(
          0,
          completedAtMs - metrics.startedAtMs,
        ),
      },
      context,
      undefined,
      completedAtMs,
    );
    this.epochMetrics.delete(context.epochId);
    this.activeEpochId = undefined;
  };

  public get currentEpochContext(): EpochTelemetryContext | undefined {
    return this.activeEpochId === undefined
      ? undefined
      : { epochId: this.activeEpochId };
  }

  public readonly record = <Type extends TelemetryEventType>(
    event: Type,
    data: TelemetryEventDataMap[Type],
    context: TelemetryEventContext<Type>,
    spanId?: string,
  ): void => this.publish(event, data, context, spanId, this.monotonicNow());

  private readonly publish = <Type extends TelemetryEventType>(
    event: Type,
    data: TelemetryEventDataMap[Type],
    context: TelemetryEventContext<Type>,
    spanId: string | undefined,
    recordedAtMs: number,
  ): void => {
    const telemetryEvent = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      sequence: this.sequence,
      timestamp: this.clock.wallNow().toISOString(),
      monotonicMs: Math.max(0, recordedAtMs - this.runStartedAtMs),
      runId: this.runId,
      event,
      ...(context.epochId === undefined ? {} : { epochId: context.epochId }),
      ...(context.wave === undefined ? {} : { wave: context.wave }),
      ...(context.candidateId === undefined
        ? {}
        : { candidateId: context.candidateId }),
      ...(context.nodeId === undefined ? {} : { nodeId: context.nodeId }),
      ...(spanId === undefined ? {} : { spanId }),
      ...(context.parentSpanId === undefined
        ? {}
        : { parentSpanId: context.parentSpanId }),
      data,
    } as TelemetryEvent<Type>;
    this.sequence += 1;
    const publishedEvent = telemetryEvent as TelemetryEvent;
    this.updateMetrics(publishedEvent);
    this.receivers.forEach((receiver) => {
      try {
        receiver(publishedEvent);
      } catch {
        // Telemetry consumers must never change the observed operation.
      }
    });
  };

  public readonly sanitizeText = (value: string): string =>
    value.length <= this.maxTextLength
      ? value
      : `${value.slice(0, this.maxTextLength)}…`;

  public readonly diagnosticValue = (value: unknown): unknown =>
    this.includeDiagnostics
      ? this.sanitizeValue(value, {
          seen: new WeakSet<object>(),
          remainingValues: MAX_DIAGNOSTIC_VALUES,
        })
      : undefined;

  private readonly updateMetrics = (event: TelemetryEvent): void => {
    if (event.epochId === undefined) {
      return;
    }
    const metrics = this.epochMetrics.get(event.epochId);
    if (metrics === undefined) {
      return;
    }
    if (event.event === 'inference.completed') {
      metrics.inferenceCount += 1;
      metrics.totalProviderDurationMs += event.data.durationMs;
    } else if (event.event === 'tool.invocation-completed') {
      metrics.toolCallCount += 1;
    }
  };

  private readonly sanitizeValue = (
    value: unknown,
    state: SanitizationState,
  ): unknown => {
    if (state.remainingValues === 0) {
      return '[Truncated]';
    }
    state.remainingValues -= 1;
    if (typeof value === 'string') {
      return this.sanitizeText(value);
    }
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'undefined') {
      return undefined;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.sanitizeText(value.message),
      };
    }
    if (typeof value !== 'object') {
      return this.sanitizeText(String(value));
    }
    if (state.seen.has(value)) {
      return '[Circular]';
    }
    state.seen.add(value);
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_DIAGNOSTIC_COLLECTION_LENGTH)
        .map((entry) => this.sanitizeValue(entry, state));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(
      0,
      MAX_DIAGNOSTIC_COLLECTION_LENGTH,
    )) {
      const sanitizedKey =
        key.length <= MAX_DIAGNOSTIC_KEY_LENGTH
          ? key
          : `${key.slice(0, MAX_DIAGNOSTIC_KEY_LENGTH)}…`;
      sanitized[sanitizedKey] = this.redactedKeys.has(key.toLowerCase())
        ? '[REDACTED]'
        : this.sanitizeValue(entry, state);
    }
    return sanitized;
  };
}

export const classifyTelemetryError = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name.length > 0) {
      return error.name.slice(0, MAX_ERROR_CATEGORY_LENGTH);
    }
    return 'Error';
  }
  if (typeof error === 'string') {
    return 'string-error';
  }
  return 'unknown-error';
};
