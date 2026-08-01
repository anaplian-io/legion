import { Provider } from '../types/provider.js';
import {
  DistillationProps,
  DistillationResult,
  Distiller,
} from '../types/distiller.js';
import { Message, MessageRole } from '../types/message.js';
import { ToolCall, ToolDefinition } from '../types/tool.js';
import { formatMessagePayload } from '../utilities/action-request.js';
import { ActiveGoal, GoalDecision, GoalOrigin } from '../types/goal.js';
import type { EvidenceReference } from '../types/evidence.js';
import {
  isDefined,
  isRecord,
  isUniqueIntegerArray,
  isUniqueStringArray,
} from '../utilities/type-guards.js';

export interface LlmDistillerProps {
  readonly provider: Provider;
}

const SYNTHESIZE_BROADCAST_TOOL_NAME = 'publish_synthesized_broadcast';

const SYNTHESIZE_BROADCAST_TOOL: ToolDefinition = {
  name: SYNTHESIZE_BROADCAST_TOOL_NAME,
  description:
    'Publish one synthesized global-workspace broadcast from the surviving candidates.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        minLength: 1,
        description: 'Concise prose for the next collective broadcast.',
      },
      contributingCandidateIndices: {
        type: 'array',
        items: { type: 'integer' },
        minItems: 1,
        uniqueItems: true,
        description:
          'Indices of candidates whose information materially contributes to the synthesis.',
      },
      includedActionRequestIds: {
        type: 'array',
        items: { type: 'string' },
        uniqueItems: true,
        description:
          'Exact IDs of original action requests that should execute next; use an empty array when none should execute.',
      },
      supportingAfferentIndices: {
        type: 'array',
        items: { type: 'integer' },
        uniqueItems: true,
        description:
          'Indices of current afferent messages that support facts or decisions retained in the broadcast.',
      },
      actionDisposition: {
        type: 'string',
        description:
          'Use "scheduled" when one or more included action IDs should execute; otherwise use "none".',
      },
      actionSummary: {
        type: 'string',
        description:
          'A concise description of the scheduled action, or an empty string when actionDisposition is "none".',
      },
      goalDecision: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description:
              'One of unchanged, activate, revise, supersede, complete, or abandon.',
          },
          objective: {
            type: 'string',
            description:
              'Goal objective for activate, revise, or supersede; otherwise empty.',
          },
          successCriteria: {
            type: 'string',
            description:
              'Observable success criteria for activate, revise, or supersede; otherwise empty.',
          },
          origin: {
            type: 'string',
            description:
              'user or autonomous for activate, revise, or supersede; otherwise empty.',
          },
          goalId: {
            type: 'string',
            description:
              'Exact active goal ID for revise, supersede, complete, or abandon; otherwise empty.',
          },
          reason: {
            type: 'string',
            description: 'A concise reason for this goal decision.',
          },
          supportingCandidateIndices: {
            type: 'array',
            items: { type: 'integer' },
            uniqueItems: true,
            description:
              'Contributing candidate indices that support the goal decision.',
          },
          supportingAfferentIndices: {
            type: 'array',
            items: { type: 'integer' },
            uniqueItems: true,
            description:
              'Current afferent indices that support the goal decision.',
          },
        },
        required: [
          'kind',
          'objective',
          'successCriteria',
          'origin',
          'goalId',
          'reason',
          'supportingCandidateIndices',
          'supportingAfferentIndices',
        ],
        additionalProperties: false,
      },
    },
    required: [
      'content',
      'contributingCandidateIndices',
      'includedActionRequestIds',
      'supportingAfferentIndices',
      'actionDisposition',
      'actionSummary',
      'goalDecision',
    ],
    additionalProperties: false,
  },
};

/** Synthesizes a bounded winning coalition without allowing control-data edits. */
export class LlmDistiller implements Distiller {
  constructor(private readonly props: LlmDistillerProps) {}

  public readonly distill = async (
    props: DistillationProps,
  ): Promise<DistillationResult | undefined> => {
    const {
      workingMemory,
      broadcasts,
      afferentContext = [],
      activeGoal,
    } = props;
    if (broadcasts.length === 0) {
      return undefined;
    }

    const generated = await this.props.provider.generateWithTools({
      systemPrompt: `You consolidate a bounded winning coalition into the next global-workspace broadcast. Capture only supported new facts, decisions, constraints, open questions, and concrete next actions. Address current user input when present. Resolve contradictions instead of blending them.

Use only candidate indices, afferent indices, and action-request IDs shown below. Include an action request only when it remains the correct next operation and the prose announces that same action. When no action should execute, use actionDisposition "none", an empty actionSummary, and do not imply that an action is scheduled. Never rewrite, invent, or copy an action's target, operation, or arguments; Legion will recover the original structured request by ID.

Always make an explicit goal decision. Use "activate" for a bounded intention that should guide multiple epochs, "revise" for a compatible change to the current goal, "supersede" for a replacement, "complete" only when cited evidence satisfies the success criteria, "abandon" only with a concrete reason, and "unchanged" otherwise. A sustained external request is user-origin; ordinary one-step questions should remain unchanged. Autonomous goals must be bounded, observable, and supported by contributing cognitive evidence.

Authoritative goal state:
${formatActiveGoal(activeGoal)}`,
      messages: [
        {
          role: 'node-response',
          content: formatDistillationContext(
            workingMemory.messages,
            afferentContext,
            broadcasts,
          ),
        },
      ],
      tools: [SYNTHESIZE_BROADCAST_TOOL],
      toolChoice: 'required',
    });

    return resultFromToolCall(
      exactlyOneSynthesisCall(generated.toolCalls),
      broadcasts,
      afferentContext,
      activeGoal,
    );
  };
}

const formatDistillationContext = (
  workingMemory: readonly Message[],
  afferentContext: readonly Message[],
  broadcasts: readonly Message[],
): string => `Working memory:
${workingMemory.map((message, index) => formatMessage(message, index)).join('\n')}

This step's afferent context:
${afferentContext.map((message, index) => formatMessage(message, index)).join('\n')}

This step's surviving candidates:
${broadcasts
  .map(
    (broadcast, index) =>
      `[CANDIDATE ${index}${broadcast.originatingNodeId === undefined ? '' : ` from ${broadcast.originatingNodeId}`}]: ${formatMessagePayload(broadcast)}`,
  )
  .join('\n')}`;

const formatMessage = (message: Message, index: number): string => {
  const origin =
    message.originatingNodeId === undefined
      ? ''
      : ` from ${message.originatingNodeId}`;
  return `[${MESSAGE_ROLE_LABEL[message.role]} ${index}${origin}]: ${formatMessagePayload(message)}`;
};

const exactlyOneSynthesisCall = (
  calls: readonly ToolCall[] | undefined,
): ToolCall => {
  if (calls?.length !== 1) {
    throw new Error(
      `[LlmDistiller] expected exactly one ${SYNTHESIZE_BROADCAST_TOOL_NAME} call`,
    );
  }
  const call = calls[0]!;
  if (call.function.name !== SYNTHESIZE_BROADCAST_TOOL_NAME) {
    throw new Error(
      `[LlmDistiller] received unsupported tool ${call.function.name}`,
    );
  }
  return call;
};

const resultFromToolCall = (
  call: ToolCall,
  broadcasts: readonly Message[],
  afferentContext: readonly Message[],
  activeGoal: ActiveGoal | undefined,
): DistillationResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments) as unknown;
  } catch {
    throw new Error('[LlmDistiller] synthesis arguments must be valid JSON');
  }
  if (!isRecord(parsed)) {
    throw new Error('[LlmDistiller] synthesis arguments must be an object');
  }

  const content = parsed['content'];
  const contributorIndices = parsed['contributingCandidateIndices'];
  const includedActionIds = parsed['includedActionRequestIds'];
  const afferentIndices = parsed['supportingAfferentIndices'];
  const actionDisposition = parsed['actionDisposition'];
  const actionSummary = parsed['actionSummary'];
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('[LlmDistiller] synthesis content must not be empty');
  }
  if (
    !isUniqueIntegerArray(contributorIndices) ||
    contributorIndices.length === 0 ||
    contributorIndices.some((index) => index < 0 || index >= broadcasts.length)
  ) {
    throw new Error(
      '[LlmDistiller] contributing candidate indices must be unique and in range',
    );
  }
  if (!isUniqueStringArray(includedActionIds)) {
    throw new Error(
      '[LlmDistiller] included action request IDs must be unique strings',
    );
  }
  if (
    !isUniqueIntegerArray(afferentIndices) ||
    afferentIndices.some(
      (index) => index < 0 || index >= afferentContext.length,
    )
  ) {
    throw new Error(
      '[LlmDistiller] supporting afferent indices must be unique and in range',
    );
  }
  validateActionDisposition(
    actionDisposition,
    actionSummary,
    includedActionIds,
  );

  const requestsById = new Map<
    string,
    {
      readonly request: NonNullable<Message['actionRequests']>[number];
      readonly candidateIndex: number;
    }
  >();
  broadcasts.forEach((broadcast, candidateIndex) => {
    broadcast.actionRequests?.forEach((request) => {
      if (requestsById.has(request.id)) {
        throw new Error(
          `[LlmDistiller] duplicate action request ID ${request.id}`,
        );
      }
      requestsById.set(request.id, { request, candidateIndex });
    });
  });

  const contributorSet = new Set(contributorIndices);
  const actionRequests = includedActionIds.map((id) => {
    const entry = requestsById.get(id);
    if (entry === undefined) {
      throw new Error(`[LlmDistiller] unknown action request ID ${id}`);
    }
    if (!contributorSet.has(entry.candidateIndex)) {
      throw new Error(
        `[LlmDistiller] action request ${id} came from a non-contributing candidate`,
      );
    }
    return entry.request;
  });

  const contributingNodeIds = Array.from(
    new Set(
      contributorIndices
        .map((index) => broadcasts[index]?.originatingNodeId)
        .filter(isDefined),
    ),
  );

  const supportingEvidence: EvidenceReference[] = [
    ...contributorIndices.map((index) => ({
      source: 'candidate' as const,
      index,
    })),
    ...afferentIndices.map((index) => ({
      source: 'afferent' as const,
      index,
    })),
  ];
  const goalDecision = parseGoalDecision({
    value: parsed['goalDecision'],
    callId: call.id,
    contributorIndices,
    broadcasts,
    afferentContext,
    activeGoal,
  });

  return {
    broadcast: {
      role: 'broadcast',
      content: content.trim(),
      ...(contributingNodeIds.length === 0 ? {} : { contributingNodeIds }),
      ...(actionRequests.length === 0 ? {} : { actionRequests }),
    },
    supportingEvidence,
    goalDecision,
  };
};

const formatActiveGoal = (activeGoal: ActiveGoal | undefined): string =>
  activeGoal === undefined
    ? 'none'
    : `ID: ${activeGoal.id}
Revision: ${activeGoal.revision}
Origin: ${activeGoal.origin}
Objective: ${activeGoal.objective}
Success criteria: ${activeGoal.successCriteria}`;

const validateActionDisposition = (
  disposition: unknown,
  summary: unknown,
  includedActionIds: readonly string[],
): void => {
  if (disposition !== 'scheduled' && disposition !== 'none') {
    throw new Error(
      '[LlmDistiller] action disposition must be scheduled or none',
    );
  }
  if (typeof summary !== 'string') {
    throw new Error('[LlmDistiller] action summary must be a string');
  }
  if (disposition === 'scheduled') {
    if (includedActionIds.length === 0 || summary.trim().length === 0) {
      throw new Error(
        '[LlmDistiller] scheduled action requires an action ID and summary',
      );
    }
    return;
  }
  if (includedActionIds.length > 0 || summary.trim().length > 0) {
    throw new Error(
      '[LlmDistiller] no-action disposition cannot include actions or a summary',
    );
  }
};

interface ParseGoalDecisionProps {
  readonly value: unknown;
  readonly callId: string;
  readonly contributorIndices: readonly number[];
  readonly broadcasts: readonly Message[];
  readonly afferentContext: readonly Message[];
  readonly activeGoal: ActiveGoal | undefined;
}

const parseGoalDecision = ({
  value,
  callId,
  contributorIndices,
  broadcasts,
  afferentContext,
  activeGoal,
}: ParseGoalDecisionProps): GoalDecision => {
  if (!isRecord(value)) {
    throw new Error('[LlmDistiller] goal decision must be an object');
  }
  const kind = value['kind'];
  const reason = requiredDecisionString(value, 'reason');
  if (kind === 'unchanged') {
    return { kind, reason };
  }
  if (
    kind !== 'activate' &&
    kind !== 'revise' &&
    kind !== 'supersede' &&
    kind !== 'complete' &&
    kind !== 'abandon'
  ) {
    throw new Error(`[LlmDistiller] unsupported goal decision ${String(kind)}`);
  }

  const evidence = parseGoalEvidence({
    value,
    contributorIndices,
    broadcasts,
    afferentContext,
  });
  const id = `${callId}:goal`;

  if (kind === 'complete' || kind === 'abandon') {
    const goalId = requiredDecisionString(value, 'goalId');
    requireMatchingActiveGoal(kind, goalId, activeGoal);
    return {
      id,
      kind,
      goalId,
      reason,
      supportingEvidence: evidence,
    };
  }

  const objective = requiredDecisionString(value, 'objective');
  const successCriteria = requiredDecisionString(value, 'successCriteria');
  const origin = requiredGoalOrigin(value);
  validateGoalOriginEvidence(origin, evidence, afferentContext);

  if (kind === 'activate') {
    if (activeGoal !== undefined) {
      throw new Error(
        '[LlmDistiller] cannot activate a new goal while one is active',
      );
    }
    return {
      id,
      kind,
      objective,
      successCriteria,
      origin,
      reason,
      supportingEvidence: evidence,
    };
  }

  const goalId = requiredDecisionString(value, 'goalId');
  requireMatchingActiveGoal(kind, goalId, activeGoal);
  return {
    id,
    kind,
    goalId,
    objective,
    successCriteria,
    origin,
    reason,
    supportingEvidence: evidence,
  };
};

interface ParseGoalEvidenceProps {
  readonly value: Readonly<Record<string, unknown>>;
  readonly contributorIndices: readonly number[];
  readonly broadcasts: readonly Message[];
  readonly afferentContext: readonly Message[];
}

const parseGoalEvidence = ({
  value,
  contributorIndices,
  broadcasts,
  afferentContext,
}: ParseGoalEvidenceProps): readonly EvidenceReference[] => {
  const candidateIndices = value['supportingCandidateIndices'];
  const afferentIndices = value['supportingAfferentIndices'];
  const contributorSet = new Set(contributorIndices);
  if (
    !isUniqueIntegerArray(candidateIndices) ||
    candidateIndices.some(
      (index) =>
        index < 0 || index >= broadcasts.length || !contributorSet.has(index),
    )
  ) {
    throw new Error(
      '[LlmDistiller] goal candidate evidence must reference contributing candidates',
    );
  }
  if (
    !isUniqueIntegerArray(afferentIndices) ||
    afferentIndices.some(
      (index) => index < 0 || index >= afferentContext.length,
    )
  ) {
    throw new Error(
      '[LlmDistiller] goal afferent evidence must be unique and in range',
    );
  }
  if (candidateIndices.length === 0 && afferentIndices.length === 0) {
    throw new Error('[LlmDistiller] goal transition requires evidence');
  }
  return [
    ...candidateIndices.map((index) => ({
      source: 'candidate' as const,
      index,
    })),
    ...afferentIndices.map((index) => ({
      source: 'afferent' as const,
      index,
    })),
  ];
};

const requiredDecisionString = (
  value: Readonly<Record<string, unknown>>,
  field: string,
): string => {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error(
      `[LlmDistiller] goal decision requires a non-empty ${field}`,
    );
  }
  return candidate.trim();
};

const requiredGoalOrigin = (
  value: Readonly<Record<string, unknown>>,
): GoalOrigin => {
  const origin = value['origin'];
  if (origin !== 'user' && origin !== 'autonomous') {
    throw new Error(
      '[LlmDistiller] goal decision origin must be user or autonomous',
    );
  }
  return origin;
};

const validateGoalOriginEvidence = (
  origin: GoalOrigin,
  evidence: readonly EvidenceReference[],
  afferentContext: readonly Message[],
): void => {
  if (
    origin === 'user' &&
    !evidence.some(
      (reference) =>
        reference.source === 'afferent' &&
        afferentContext[reference.index]?.role === 'user-input',
    )
  ) {
    throw new Error(
      '[LlmDistiller] user-origin goal requires current user-input evidence',
    );
  }
  if (
    origin === 'autonomous' &&
    !evidence.some((reference) => reference.source === 'candidate')
  ) {
    throw new Error(
      '[LlmDistiller] autonomous goal requires cognitive candidate evidence',
    );
  }
};

const requireMatchingActiveGoal = (
  kind: Exclude<GoalDecision['kind'], 'unchanged' | 'activate'>,
  goalId: string,
  activeGoal: ActiveGoal | undefined,
): void => {
  if (activeGoal?.id !== goalId) {
    throw new Error(`[LlmDistiller] ${kind} requires the exact active goal ID`);
  }
};

const MESSAGE_ROLE_LABEL: Record<MessageRole, string> = {
  'working-memory': 'WORKING MEMORY',
  broadcast: 'BROADCAST',
  'user-input': 'USER INPUT',
  afferent: 'AFFERENT',
  'afferent-capability': 'AFFERENT CAPABILITY',
  'node-response': 'NODE RESPONSE',
};
