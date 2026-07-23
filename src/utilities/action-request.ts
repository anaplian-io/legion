import { ActionRequest, Message } from '../types/message.js';
import { ToolCall, ToolDefinition } from '../types/tool.js';
import { isRecord } from './type-guards.js';

export const ACTION_REQUEST_TOOL_NAME = 'request_node_action';

export const ACTION_REQUEST_TOOL: ToolDefinition = {
  name: ACTION_REQUEST_TOOL_NAME,
  description:
    'Attach a machine-readable operation request to this cognitive response. Use only when a specific available afferent node must act.',
  parameters: {
    type: 'object',
    properties: {
      targetNodeId: {
        type: 'string',
        description: 'Exact node ID copied from available capabilities.',
      },
      operation: {
        type: 'string',
        description: 'Operation requested from the target node.',
      },
      arguments: {
        type: 'object',
        description: 'Structured arguments for the requested operation.',
        additionalProperties: true,
      },
    },
    required: ['targetNodeId', 'operation', 'arguments'],
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
    typeof parsed['operation'] !== 'string' ||
    parsed['operation'].trim().length === 0 ||
    !isRecord(parsed['arguments'])
  ) {
    return undefined;
  }
  return {
    id: call.id,
    targetNodeId: parsed['targetNodeId'].trim(),
    operation: parsed['operation'].trim(),
    arguments: parsed['arguments'],
  };
};

export const formatActionRequests = (
  requests: readonly ActionRequest[] | undefined,
): string => {
  if (requests === undefined || requests.length === 0) {
    return '';
  }
  return requests
    .map(
      (request) =>
        `[ACTION REQUEST ${request.id}] target=${request.targetNodeId} operation=${request.operation} arguments=${JSON.stringify(request.arguments)}`,
    )
    .join('\n');
};

/** Renders prose and structured control data as one model-visible payload. */
export const formatMessagePayload = (
  message: Pick<Message, 'content' | 'actionRequests'>,
): string =>
  [message.content, formatActionRequests(message.actionRequests)]
    .filter((part) => part.length > 0)
    .join('\n');
