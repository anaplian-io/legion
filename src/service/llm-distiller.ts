import { Provider } from '../types/provider.js';
import { DistillationProps, Distiller } from '../types/distiller.js';
import { Message, MessageRole } from '../types/message.js';
import { ToolCall, ToolDefinition } from '../types/tool.js';
import { formatMessagePayload } from '../utilities/action-request.js';
import { isDefined } from '../utilities/is-defined.js';

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
    },
    required: [
      'content',
      'contributingCandidateIndices',
      'includedActionRequestIds',
    ],
    additionalProperties: false,
  },
};

/** Synthesizes a bounded winning coalition without allowing control-data edits. */
export class LlmDistiller implements Distiller {
  constructor(private readonly props: LlmDistillerProps) {}

  public readonly distill = async (
    props: DistillationProps,
  ): Promise<Message | undefined> => {
    const { workingMemory, broadcasts, afferentContext = [] } = props;
    if (broadcasts.length === 0) {
      return undefined;
    }
    if (broadcasts.length === 1) {
      return broadcasts[0];
    }

    const generated = await this.props.provider.generateWithTools({
      systemPrompt: `You consolidate a bounded winning coalition into the next global-workspace broadcast. Capture only supported new facts, decisions, constraints, open questions, and concrete next actions. Address current user input when present. Resolve contradictions instead of blending them.

Use only candidate indices and action-request IDs shown below. Include an action request only when it remains the correct next operation. Never rewrite, invent, or copy its target, operation, or arguments; Legion will recover the original structured request by ID.`,
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

    return synthesisFromToolCall(
      exactlyOneSynthesisCall(generated.toolCalls),
      broadcasts,
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

const synthesisFromToolCall = (
  call: ToolCall,
  broadcasts: readonly Message[],
): Message => {
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

  return {
    role: 'broadcast',
    content: content.trim(),
    ...(contributingNodeIds.length === 0 ? {} : { contributingNodeIds }),
    ...(actionRequests.length === 0 ? {} : { actionRequests }),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUniqueIntegerArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((entry) => Number.isInteger(entry)) &&
  new Set(value).size === value.length;

const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === 'string') &&
  new Set(value).size === value.length;

const MESSAGE_ROLE_LABEL: Record<MessageRole, string> = {
  'working-memory': 'WORKING MEMORY',
  broadcast: 'BROADCAST',
  'user-input': 'USER INPUT',
  afferent: 'AFFERENT',
  'afferent-capability': 'AFFERENT CAPABILITY',
  'node-response': 'NODE RESPONSE',
};
