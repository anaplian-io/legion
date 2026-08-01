import { DistillationProps, DistillationResult } from '../types/distiller.js';
import type { EvidenceReference } from '../types/evidence.js';
import type { GoalDecision, GoalOrigin } from '../types/goal.js';
import type { ActionRequest } from '../types/message.js';

/** Fail-closed structural validation shared by every distillation strategy. */
export class DistillationValidator {
  public readonly validate = (
    props: DistillationProps,
    result: DistillationResult,
  ): void => {
    validateEvidenceReferences(props, result.supportingEvidence);
    if (
      !result.supportingEvidence.some(
        (reference) => reference.source === 'candidate',
      )
    ) {
      throw new Error(
        '[DistillationValidator] broadcast requires candidate evidence',
      );
    }
    validateActions(props, result);
    validateGoalDecision(props, result);
  };
}

const validateEvidenceReferences = (
  props: DistillationProps,
  references: readonly EvidenceReference[],
): void => {
  const seen = new Set<string>();
  for (const reference of references) {
    if (!Number.isInteger(reference.index) || reference.index < 0) {
      throw new Error(
        '[DistillationValidator] evidence index must be a non-negative integer',
      );
    }
    const limit =
      reference.source === 'candidate'
        ? props.broadcasts.length
        : (props.afferentContext?.length ?? 0);
    if (reference.index >= limit) {
      throw new Error('[DistillationValidator] evidence index is out of range');
    }
    const key = `${reference.source}:${reference.index}`;
    if (seen.has(key)) {
      throw new Error(
        '[DistillationValidator] evidence references must be unique',
      );
    }
    seen.add(key);
  }
};

const validateActions = (
  props: DistillationProps,
  result: DistillationResult,
): void => {
  const candidateEvidence = new Set(
    result.supportingEvidence
      .filter((reference) => reference.source === 'candidate')
      .map((reference) => reference.index),
  );
  const requestsById = new Map<
    string,
    { readonly request: ActionRequest; readonly candidateIndex: number }
  >();
  props.broadcasts.forEach((broadcast, candidateIndex) => {
    broadcast.actionRequests?.forEach((request) => {
      if (requestsById.has(request.id)) {
        throw new Error(
          `[DistillationValidator] duplicate source action ID ${request.id}`,
        );
      }
      requestsById.set(request.id, { request, candidateIndex });
    });
  });

  result.broadcast.actionRequests?.forEach((request) => {
    const source = requestsById.get(request.id);
    if (source === undefined || !sameActionRequest(source.request, request)) {
      throw new Error(
        `[DistillationValidator] action ${request.id} was not preserved exactly`,
      );
    }
    if (!candidateEvidence.has(source.candidateIndex)) {
      throw new Error(
        `[DistillationValidator] action ${request.id} lacks candidate evidence`,
      );
    }
  });
};

const sameActionRequest = (
  left: ActionRequest,
  right: ActionRequest,
): boolean =>
  left.targetNodeId === right.targetNodeId &&
  left.intent === right.intent &&
  left.operation === right.operation &&
  JSON.stringify(left.arguments) === JSON.stringify(right.arguments);

const validateGoalDecision = (
  props: DistillationProps,
  result: DistillationResult,
): void => {
  const decision = result.goalDecision;
  if (decision.kind === 'unchanged') {
    if (decision.reason.trim().length === 0) {
      throw new Error(
        '[DistillationValidator] unchanged goal decision requires a reason',
      );
    }
    return;
  }

  validateEvidenceReferences(props, decision.supportingEvidence);
  if (decision.supportingEvidence.length === 0) {
    throw new Error(
      '[DistillationValidator] goal transition requires evidence',
    );
  }
  const retainedEvidence = new Set(
    result.supportingEvidence.map(
      (reference) => `${reference.source}:${reference.index}`,
    ),
  );
  if (
    decision.supportingEvidence.some(
      (reference) =>
        !retainedEvidence.has(`${reference.source}:${reference.index}`),
    )
  ) {
    throw new Error(
      '[DistillationValidator] goal evidence must support the retained broadcast',
    );
  }
  if (decision.reason.trim().length === 0) {
    throw new Error(
      '[DistillationValidator] goal transition requires a reason',
    );
  }

  if (decision.kind === 'complete' || decision.kind === 'abandon') {
    requireMatchingGoal(props, decision);
    return;
  }

  validateProposedGoal(decision);
  validateOriginEvidence(props, decision.origin, decision.supportingEvidence);
  if (decision.kind === 'activate') {
    if (props.activeGoal !== undefined) {
      throw new Error(
        '[DistillationValidator] activate requires no active goal',
      );
    }
    return;
  }
  requireMatchingGoal(props, decision);
};

const validateProposedGoal = (
  decision: Extract<
    GoalDecision,
    { readonly kind: 'activate' | 'revise' | 'supersede' }
  >,
): void => {
  if (
    decision.objective.trim().length === 0 ||
    decision.successCriteria.trim().length === 0
  ) {
    throw new Error(
      '[DistillationValidator] proposed goal requires objective and success criteria',
    );
  }
};

const validateOriginEvidence = (
  props: DistillationProps,
  origin: GoalOrigin,
  evidence: readonly EvidenceReference[],
): void => {
  if (
    origin === 'user' &&
    !evidence.some(
      (reference) =>
        reference.source === 'afferent' &&
        props.afferentContext?.[reference.index]?.role === 'user-input',
    )
  ) {
    throw new Error(
      '[DistillationValidator] user goal requires user-input evidence',
    );
  }
  if (
    origin === 'autonomous' &&
    !evidence.some((reference) => reference.source === 'candidate')
  ) {
    throw new Error(
      '[DistillationValidator] autonomous goal requires candidate evidence',
    );
  }
};

const requireMatchingGoal = (
  props: DistillationProps,
  decision: Exclude<GoalDecision, { readonly kind: 'unchanged' | 'activate' }>,
): void => {
  if (props.activeGoal?.id !== decision.goalId) {
    throw new Error(
      `[DistillationValidator] ${decision.kind} requires the active goal ID`,
    );
  }
};
