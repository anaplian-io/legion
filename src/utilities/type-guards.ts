import type { MemoryNode } from '../node/memory-node.js';
import type { Node } from '../types/node.js';
import type { ToolCall } from '../types/tool.js';

/** Narrows an optional value without discarding other falsy values. */
export const isDefined = <T>(value: T | undefined): value is T =>
  value !== undefined;

/** Narrows an unknown value to a non-null, non-array object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Narrows an unknown value to an array of unique integers. */
export const isUniqueIntegerArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((entry) => Number.isInteger(entry)) &&
  new Set(value).size === value.length;

/** Narrows an unknown value to an array of unique strings. */
export const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === 'string') &&
  new Set(value).size === value.length;

/** Narrows a polymorphic node to the cognitive MemoryNode implementation. */
export const isMemoryNode = (node: Node<string>): node is MemoryNode =>
  node.kind === 'memory';

/** Narrows untrusted provider output to Legion's complete function-call shape. */
export const isToolCall = (value: unknown): value is ToolCall => {
  if (!isRecord(value)) {
    return false;
  }
  const functionCall = value['function'];
  return (
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    value['type'] === 'function' &&
    isRecord(functionCall) &&
    typeof functionCall['name'] === 'string' &&
    functionCall['name'].length > 0 &&
    typeof functionCall['arguments'] === 'string'
  );
};

/** Creates a guard for objects whose selected property is not undefined. */
export const hasDefinedProperty =
  <K extends PropertyKey>(property: K) =>
  <T extends Record<K, unknown>>(
    value: T,
  ): value is T & { [P in K]-?: Exclude<T[P], undefined> } =>
    value[property] !== undefined;

/** Narrows an unknown thrown value to an object with a specific error code. */
export const hasErrorCode = (
  value: unknown,
  code: string,
): value is { readonly code: string } =>
  isRecord(value) && value['code'] === code;
