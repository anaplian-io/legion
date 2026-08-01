import { ActionRequest, Message } from '../types/message.js';
import { ToolCall, ToolDefinition } from '../types/tool.js';
import { isRecord } from './type-guards.js';

export const ACTION_REQUEST_TOOL_NAME = 'request_node_action';

export const ACTION_REQUEST_TOOL: ToolDefinition = {
  name: ACTION_REQUEST_TOOL_NAME,
  description:
    'Attach a machine-readable intent to this cognitive response. Use only when a specific available afferent node must act.',
  parameters: {
    type: 'object',
    properties: {
      targetNodeId: {
        type: 'string',
        description: 'Exact node ID copied from available capabilities.',
      },
      intent: {
        type: 'string',
        description:
          'The outcome the target node should accomplish, including relevant constraints.',
      },
      operation: {
        type: 'string',
        description:
          'Optional non-authoritative operation hint. Omit it unless the capability explicitly provides one.',
      },
      arguments: {
        type: 'object',
        description:
          'Optional non-authoritative structured hints. The target may repair or ignore them.',
        additionalProperties: true,
      },
    },
    required: ['targetNodeId', 'intent'],
    additionalProperties: false,
  },
};

export const actionRequestFromToolCall = (
  call: ToolCall,
): ActionRequest | undefined => {
  if (call.function.name !== ACTION_REQUEST_TOOL_NAME) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed['targetNodeId'] !== 'string' ||
    parsed['targetNodeId'].trim().length === 0 ||
    typeof parsed['intent'] !== 'string' ||
    parsed['intent'].trim().length === 0 ||
    (parsed['operation'] !== undefined &&
      (typeof parsed['operation'] !== 'string' ||
        parsed['operation'].trim().length === 0)) ||
    (parsed['arguments'] !== undefined && !isRecord(parsed['arguments']))
  ) {
    return undefined;
  }
  return {
    id: call.id,
    targetNodeId: parsed['targetNodeId'].trim(),
    intent: parsed['intent'].trim(),
    ...(typeof parsed['operation'] === 'string'
      ? { operation: parsed['operation'].trim() }
      : {}),
    ...(isRecord(parsed['arguments'])
      ? { arguments: parsed['arguments'] }
      : {}),
  };
};

export const formatActionRequests = (
  requests: readonly ActionRequest[] | undefined,
): string => {
  if (requests === undefined || requests.length === 0) {
    return '';
  }
  return requests
    .map((request) =>
      [
        `[ACTION REQUEST ${request.id}] target=${request.targetNodeId} intent=${JSON.stringify(request.intent)}`,
        request.operation === undefined
          ? ''
          : `operationHint=${request.operation}`,
        request.arguments === undefined
          ? ''
          : `argumentsHint=${JSON.stringify(request.arguments)}`,
      ]
        .filter((part) => part.length > 0)
        .join(' '),
    )
    .join('\n');
};

/** Renders prose and structured control data as one model-visible payload. */
export const formatMessagePayload = (
  message: Pick<Message, 'content' | 'actionRequests' | 'goalDecision'>,
): string =>
  [
    message.content,
    formatActionRequests(message.actionRequests),
    message.goalDecision === undefined
      ? ''
      : `[GOAL DECISION] ${JSON.stringify(message.goalDecision)}`,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
