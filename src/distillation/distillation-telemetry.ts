import type {
  DistillationProps,
  DistillationResult,
} from '../types/distiller.js';
import type { TelemetryEventDataMap } from '../types/telemetry.js';
import { messageContentHash } from '../telemetry/content-evidence.js';

export type DistillationFailureCategory =
  | 'undefined-result'
  | 'synthesis-failure'
  | 'selection-failure'
  | 'validation-failure';

export const strategyFailureCategory = (
  strategy: 'synthesize' | 'select-best',
): DistillationFailureCategory =>
  strategy === 'synthesize' ? 'synthesis-failure' : 'selection-failure';

export const successfulDistillationData = (
  attemptId: string,
  attempt: 'primary' | 'fallback' | 'configured',
  strategy: 'synthesize' | 'select-best',
  durationMs: number,
  props: DistillationProps,
  result: DistillationResult,
): TelemetryEventDataMap['distillation.attempt-completed'] => {
  const evidence = result.supportingEvidence.map((reference) => {
    const message =
      reference.source === 'candidate'
        ? props.broadcasts[reference.index]
        : props.afferentContext?.[reference.index];
    // DistillationValidator has already established that this reference exists.
    const resolvedMessage = message!;
    const hash = messageContentHash(resolvedMessage);
    return {
      ...reference,
      id: resolvedMessage.candidateId ?? `afferent:${hash}`,
      contentHash: hash,
    };
  });
  return {
    attemptId,
    attempt,
    strategy,
    durationMs,
    outcome: 'success',
    candidateIds: props.broadcasts.map(({ candidateId }) => candidateId),
    selectedCandidateIds: evidence.flatMap((reference) =>
      reference.source === 'candidate' ? [reference.id] : [],
    ),
    evidence,
    actionDisposition:
      (result.broadcast.actionRequests?.length ?? 0) > 0 ? 'scheduled' : 'none',
  };
};

export const failedDistillationData = (
  attemptId: string,
  attempt: 'primary' | 'fallback' | 'configured',
  strategy: 'synthesize' | 'select-best',
  durationMs: number,
  props: DistillationProps,
  errorCategory: DistillationFailureCategory,
): TelemetryEventDataMap['distillation.attempt-completed'] => ({
  attemptId,
  attempt,
  strategy,
  durationMs,
  outcome: 'failure',
  candidateIds: props.broadcasts.map(({ candidateId }) => candidateId),
  selectedCandidateIds: [],
  evidence: [],
  actionDisposition: 'none',
  errorCategory,
});
