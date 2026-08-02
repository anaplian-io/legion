import type {
  DistillationProps,
  DistillationResult,
  DistillationTelemetryContext,
  Distiller,
} from '../types/distiller.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import { DistillationValidator } from './distillation-validator.js';
import {
  type DistillationFailureCategory,
  failedDistillationData,
  strategyFailureCategory,
  successfulDistillationData,
} from './distillation-telemetry.js';

export interface InstrumentedDistillerProps {
  readonly delegate: Distiller;
  readonly validator: DistillationValidator;
  readonly telemetry: TelemetryRecorder;
  readonly strategy: 'synthesize' | 'select-best';
}

/** Observes one configured strategy without providing fallback behavior. */
export class InstrumentedDistiller implements Distiller {
  constructor(private readonly props: InstrumentedDistillerProps) {}

  public readonly distill = async (
    input: DistillationProps,
    context: DistillationTelemetryContext,
  ): Promise<DistillationResult | undefined> => {
    const { attempt, attemptId } = context;
    const startedAtMs = this.props.telemetry.monotonicNow();
    let errorCategory = strategyFailureCategory(this.props.strategy);
    try {
      const result = await this.props.delegate.distill(input, {
        ...context,
        parentSpanId: attemptId,
      });
      if (result === undefined) {
        this.recordFailure(
          input,
          context,
          attempt,
          attemptId,
          startedAtMs,
          'undefined-result',
        );
        return undefined;
      }
      errorCategory = 'validation-failure';
      this.props.validator.validate(input, result);
      this.props.telemetry.record(
        'distillation.attempt-completed',
        successfulDistillationData(
          attemptId,
          attempt,
          this.props.strategy,
          this.props.telemetry.durationSince(startedAtMs),
          input,
          result,
        ),
        context,
        attemptId,
      );
      return result;
    } catch (error) {
      this.recordFailure(
        input,
        context,
        attempt,
        attemptId,
        startedAtMs,
        errorCategory,
      );
      throw error;
    }
  };

  private readonly recordFailure = (
    input: DistillationProps,
    context: DistillationTelemetryContext,
    attempt: 'primary' | 'fallback' | 'configured',
    attemptId: string,
    startedAtMs: number,
    errorCategory: DistillationFailureCategory,
  ): void => {
    this.props.telemetry.record(
      'distillation.attempt-completed',
      failedDistillationData(
        attemptId,
        attempt,
        this.props.strategy,
        this.props.telemetry.durationSince(startedAtMs),
        input,
        errorCategory,
      ),
      context,
      attemptId,
    );
  };
}
