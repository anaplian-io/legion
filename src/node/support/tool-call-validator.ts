import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { ToolCall, ToolDefinition } from '../../types/tool.js';
import { errorMessage } from '../../utilities/error-message.js';
import { createToolOutputPreview } from '../../utilities/tool-output-preview.js';
import { isRecord, isToolCall } from '../../utilities/type-guards.js';

export type ToolCallValidation =
  | { readonly outcome: 'success'; readonly calls: readonly ToolCall[] }
  | {
      readonly outcome: 'structural-failure' | 'semantic-mismatch';
      readonly calls: readonly ToolCall[];
      readonly error: string;
    };

/** Validates provider calls before any arguments cross the MCP boundary. */
export const validateGeneratedCalls = (
  generatedCalls: readonly unknown[],
  advertisedTools: readonly ToolDefinition[],
  resolvedOperation: string,
): ToolCallValidation => {
  const calls = generatedCalls.filter(isToolCall);
  if (calls.length !== generatedCalls.length) {
    const malformedCall = generatedCalls.find((call) => !isToolCall(call));
    return structuralFailure(
      calls,
      `Provider returned a malformed tool call: ${createToolOutputPreview(malformedCall)}`,
    );
  }
  if (calls.length === 0) {
    return structuralFailure([], 'Provider returned no tool calls.');
  }

  for (const call of calls) {
    const structuralError = validateStructure(call, advertisedTools);
    if (structuralError !== undefined) {
      return structuralFailure(calls, structuralError);
    }
  }

  const incompatibleOperations = selectedOperations(calls).filter(
    (operation) => operation !== resolvedOperation,
  );
  if (incompatibleOperations.length > 0) {
    return {
      outcome: 'semantic-mismatch',
      calls,
      error: `Resolved operation ${resolvedOperation}, but the provider selected incompatible operation(s) ${incompatibleOperations.join(', ')}.`,
    };
  }
  return { outcome: 'success', calls };
};

const validateStructure = (
  call: ToolCall,
  advertisedTools: readonly ToolDefinition[],
): string | undefined => {
  const { name, arguments: argumentsStr } = call.function;
  const tool = advertisedTools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    return `Tool ${name} was not advertised by this ToolNode.`;
  }

  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(argumentsStr) as unknown;
  } catch {
    return `Tool ${name} arguments are not valid JSON.`;
  }
  if (!isRecord(argumentsValue)) {
    return `Tool ${name} arguments must be a JSON object.`;
  }

  try {
    const validation = new AjvJsonSchemaValidator().getValidator(
      tool.parameters,
    )(argumentsValue);
    return validation.valid
      ? undefined
      : `Tool ${name} arguments do not match its advertised schema: ${validation.errorMessage}.`;
  } catch (error) {
    return `Tool ${name} has an invalid advertised schema: ${errorMessage(error)}.`;
  }
};

const selectedOperations = (calls: readonly ToolCall[]): string[] => [
  ...new Set(calls.map((call) => call.function.name)),
];

const structuralFailure = (
  calls: readonly ToolCall[],
  error: string,
): ToolCallValidation => ({ outcome: 'structural-failure', calls, error });
