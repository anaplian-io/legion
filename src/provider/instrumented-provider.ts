import type {
  AskYesNoQuestionProps,
  GenerateProps,
  GenerateWithToolsProps,
  Provider,
  SelectBestProps,
} from '../types/provider.js';
import type { InferenceContext } from '../types/telemetry.js';
import {
  classifyTelemetryError,
  TelemetryRecorder,
} from '../telemetry/telemetry-recorder.js';

export interface InstrumentedProviderProps {
  readonly provider: Provider;
  readonly telemetry: TelemetryRecorder;
}

/** Emits exactly one completion record for every delegated provider call. */
export class InstrumentedProvider implements Provider {
  constructor(private readonly props: InstrumentedProviderProps) {}

  public readonly generate = (
    props: GenerateProps,
    inference: InferenceContext,
  ): Promise<string> =>
    this.measure(inference, () =>
      this.props.provider.generate(props, inference),
    );

  public readonly selectBest = (
    props: SelectBestProps,
    inference: InferenceContext,
  ): Promise<number> =>
    this.measure(inference, () =>
      this.props.provider.selectBest(props, inference),
    );

  public readonly rankByRelevance = (
    concept: string,
    items: string[],
    inference: InferenceContext,
  ): Promise<number[]> =>
    this.measure(inference, () =>
      this.props.provider.rankByRelevance(concept, items, inference),
    );

  public readonly askYesNoQuestion = (
    props: AskYesNoQuestionProps,
    inference: InferenceContext,
  ): Promise<boolean> =>
    this.measure(inference, () =>
      this.props.provider.askYesNoQuestion(props, inference),
    );

  public readonly splitString = (
    content: string,
    inference: InferenceContext,
  ): Promise<[string, string]> =>
    this.measure(inference, () =>
      this.props.provider.splitString(content, inference),
    );

  public readonly generateWithTools = (
    props: GenerateWithToolsProps,
    inference: InferenceContext,
  ): ReturnType<Provider['generateWithTools']> =>
    this.measure(inference, () =>
      this.props.provider.generateWithTools(props, inference),
    );

  private readonly measure = async <Result>(
    context: InferenceContext,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const { telemetry } = this.props;
    const inferenceId = telemetry.createId('inference');
    const startedAtMs = telemetry.monotonicNow();
    try {
      const result = await operation();
      telemetry.record(
        'inference.completed',
        {
          inferenceId,
          stage: context.stage,
          durationMs: telemetry.durationSince(startedAtMs),
          outcome: 'success',
        },
        context,
        inferenceId,
      );
      return result;
    } catch (error) {
      telemetry.record(
        'inference.completed',
        {
          inferenceId,
          stage: context.stage,
          durationMs: telemetry.durationSince(startedAtMs),
          outcome: 'failure',
          errorCategory: classifyTelemetryError(error),
        },
        context,
        inferenceId,
      );
      throw error;
    }
  };
}
