import { RelevanceFilter } from '../../types/relevance-filter.js';
import { Provider } from '../../types/provider.js';
import { AttentionGate } from '../../types/attention-gate.js';
import { CandidateMessage } from '../../types/message.js';
import { WorkingMemory } from '../../types/working-memory.js';
import { isDefined } from '../../utilities/type-guards.js';
import { formatMessagePayload } from '../../utilities/action-request.js';
import type {
  EpochTelemetryContext,
  TelemetrySpan,
} from '../../types/telemetry.js';
import {
  classifyTelemetryError,
  TelemetryRecorder,
} from '../../telemetry/telemetry-recorder.js';
import { requireCompleteRanking } from '../../utilities/complete-ranking.js';

export interface LlmRelevanceFilterProps {
  readonly provider: Provider;
  readonly attentionGate: AttentionGate;
  readonly telemetry: TelemetryRecorder;
}

export class LlmRelevanceFilter implements RelevanceFilter {
  constructor(private readonly props: LlmRelevanceFilterProps) {}

  public readonly filter = async (
    workingMemory: WorkingMemory,
    candidateMessages: CandidateMessage[],
    telemetryContext: EpochTelemetryContext,
  ): Promise<CandidateMessage[]> => {
    const { provider, attentionGate } = this.props;
    const span = this.props.telemetry.startSpan('relevance');
    let attentionGateValue: number | 'all' = 'all';
    if (candidateMessages.length === 0) {
      this.recordCompletion(
        telemetryContext,
        span,
        attentionGateValue,
        [],
        [],
        'success',
      );
      return [];
    }
    const concatenatedConcept = workingMemory.messages
      .map(
        (message, index) =>
          `[MESSAGE ${index}]:${formatMessagePayload(message)}\n`,
      )
      .join('');
    try {
      attentionGateValue = await attentionGate.getTopN({ workingMemory });
      if (
        attentionGateValue === 'all' ||
        attentionGateValue >= candidateMessages.length
      ) {
        const ids = candidateMessages.map(candidateId);
        this.recordCompletion(
          telemetryContext,
          span,
          attentionGateValue,
          ids,
          ids,
          'success',
        );
        return candidateMessages;
      }
      const items = candidateMessages.map(formatMessagePayload);
      const rankedIndices = requireCompleteRanking(
        await provider.rankByRelevance(concatenatedConcept, items, {
          stage: 'attention-ranking',
          ...telemetryContext,
          parentSpanId: span.spanId,
        }),
        candidateMessages.length,
        'LlmRelevanceFilter',
      );
      const ranked = rankedIndices
        .map((messageIndex) => candidateMessages[messageIndex])
        .filter(isDefined);
      const survivors = ranked.slice(0, attentionGateValue);
      this.recordCompletion(
        telemetryContext,
        span,
        attentionGateValue,
        ranked.map(candidateId),
        survivors.map(candidateId),
        'success',
      );
      return survivors;
    } catch (error) {
      this.recordCompletion(
        telemetryContext,
        span,
        attentionGateValue,
        [],
        [],
        'failure',
        classifyTelemetryError(error),
      );
      throw error;
    }
  };

  private readonly recordCompletion = (
    context: EpochTelemetryContext,
    span: TelemetrySpan,
    topN: number | 'all',
    rankedCandidateIds: readonly string[],
    survivorCandidateIds: readonly string[],
    outcome: 'success' | 'failure',
    errorCategory?: string,
  ): void => {
    this.props.telemetry.record(
      'relevance.completed',
      {
        durationMs: this.props.telemetry.durationSince(span.startedAtMs),
        outcome,
        topN,
        rankedCandidateIds,
        survivorCandidateIds,
        ...(errorCategory === undefined ? {} : { errorCategory }),
      },
      context,
      span.spanId,
    );
  };
}

const candidateId = (message: CandidateMessage): string => message.candidateId;
