import {
  DistillationProps,
  DistillationResult,
  Distiller,
} from '../types/distiller.js';
import { DistillationValidator } from './distillation-validator.js';
import type { DistillationTelemetryContext } from '../types/distiller.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import {
  type DistillationFailureCategory,
  failedDistillationData,
  strategyFailureCategory,
  successfulDistillationData,
} from './distillation-telemetry.js';

export interface ValidatedDistillerProps {
  readonly primary: Distiller;
  readonly fallback: Distiller;
  readonly validator: DistillationValidator;
  readonly telemetry: TelemetryRecorder;
}

type ObservedAttempt =
  | {
      readonly outcome: 'completed';
      readonly result: DistillationResult | undefined;
    }
  | {
      readonly outcome: 'failure';
      readonly error: unknown;
      readonly errorCategory: DistillationFailureCategory;
    };

/** Validates a primary strategy and uses a structure-preserving fallback. */
export class ValidatedDistiller implements Distiller {
  constructor(private readonly props: ValidatedDistillerProps) {}

  public readonly distill = async (
    input: DistillationProps,
    context: DistillationTelemetryContext,
  ): Promise<DistillationResult | undefined> => {
    const primaryAttemptId = this.props.telemetry.createId('distillation');
    const primaryAttempt = await this.observeAttempt(
      input,
      context,
      'primary',
      'synthesize',
      primaryAttemptId,
      this.props.primary,
    );
    if (primaryAttempt.outcome === 'completed') {
      return primaryAttempt.result;
    }

    this.props.telemetry.record(
      'distillation.fallback-activated',
      {
        failedAttemptId: primaryAttemptId,
        errorCategory: primaryAttempt.errorCategory,
      },
      context,
    );
    const fallbackAttempt = await this.observeAttempt(
      input,
      context,
      'fallback',
      'select-best',
      this.props.telemetry.createId('distillation'),
      this.props.fallback,
    );
    if (fallbackAttempt.outcome === 'failure') {
      throw fallbackAttempt.error;
    }
    return fallbackAttempt.result;
  };

  private readonly observeAttempt = async (
    input: DistillationProps,
    context: DistillationTelemetryContext,
    attempt: 'primary' | 'fallback',
    strategy: 'synthesize' | 'select-best',
    attemptId: string,
    distiller: Distiller,
  ): Promise<ObservedAttempt> => {
    const telemetry = this.props.telemetry;
    const startedAtMs = telemetry.monotonicNow();
    let errorCategory = strategyFailureCategory(strategy);
    try {
      const result = await distiller.distill(input, {
        ...context,
        attempt,
        attemptId,
        parentSpanId: attemptId,
        inferenceStage:
          attempt === 'primary' ? 'primary-distillation' : 'fallback-selection',
      });
      if (result === undefined) {
        telemetry.record(
          'distillation.attempt-completed',
          failedDistillationData(
            attemptId,
            attempt,
            strategy,
            telemetry.durationSince(startedAtMs),
            input,
            'undefined-result',
          ),
          context,
          attemptId,
        );
        return { outcome: 'completed', result: undefined };
      }
      errorCategory = 'validation-failure';
      this.props.validator.validate(input, result);
      telemetry.record(
        'distillation.attempt-completed',
        successfulDistillationData(
          attemptId,
          attempt,
          strategy,
          telemetry.durationSince(startedAtMs),
          input,
          result,
        ),
        context,
        attemptId,
      );
      return { outcome: 'completed', result };
    } catch (error) {
      telemetry.record(
        'distillation.attempt-completed',
        failedDistillationData(
          attemptId,
          attempt,
          strategy,
          telemetry.durationSince(startedAtMs),
          input,
          errorCategory,
        ),
        context,
        attemptId,
      );
      return { outcome: 'failure', error, errorCategory };
    }
  };
}
