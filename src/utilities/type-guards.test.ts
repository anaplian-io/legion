import { describe, expect, it } from 'vitest';
import {
  hasDefinedProperty,
  hasErrorCode,
  isDefined,
  isMemoryNode,
  isRecord,
  isToolCall,
  isUniqueIntegerArray,
  isUniqueStringArray,
} from './type-guards.js';
import type { Node } from '../types/node.js';

const node = (kind: string): Node<string> => ({
  id: `${kind}-node`,
  kind,
  status: 'idle',
  context: '',
  sendMessage: async () => undefined,
});

describe('type guards', () => {
  it('narrows defined values without discarding other falsy values', () => {
    expect([undefined, 0, '', false].filter(isDefined)).toEqual([0, '', false]);
  });

  it('recognizes records but rejects null, arrays, and primitives', () => {
    expect(isRecord({ key: 'value' })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('value')).toBe(false);
  });

  it('recognizes unique integer arrays', () => {
    expect(isUniqueIntegerArray([1, 2])).toBe(true);
    expect(isUniqueIntegerArray([1, 1])).toBe(false);
    expect(isUniqueIntegerArray([1, 1.5])).toBe(false);
    expect(isUniqueIntegerArray('1,2')).toBe(false);
  });

  it('recognizes unique string arrays', () => {
    expect(isUniqueStringArray(['a', 'b'])).toBe(true);
    expect(isUniqueStringArray(['a', 'a'])).toBe(false);
    expect(isUniqueStringArray(['a', 1])).toBe(false);
    expect(isUniqueStringArray('a,b')).toBe(false);
  });

  it('narrows nodes by their discriminator', () => {
    const memoryNodes = [node('memory'), node('tool')].filter(isMemoryNode);

    expect(memoryNodes.map(({ id }) => id)).toEqual(['memory-node']);
  });

  it('recognizes only complete function tool calls', () => {
    expect(
      isToolCall({
        id: 'call-1',
        type: 'function',
        function: { name: 'search', arguments: '{}' },
      }),
    ).toBe(true);
    expect(isToolCall(null)).toBe(false);
    expect(
      isToolCall({
        id: '',
        type: 'function',
        function: { name: 'search', arguments: '{}' },
      }),
    ).toBe(false);
    expect(
      isToolCall({
        id: 'call-1',
        type: 'custom',
        function: { name: 'search', arguments: '{}' },
      }),
    ).toBe(false);
    expect(isToolCall({ id: 'call-1', type: 'function' })).toBe(false);
    expect(
      isToolCall({
        id: 'call-1',
        type: 'function',
        function: { name: '', arguments: '{}' },
      }),
    ).toBe(false);
    expect(
      isToolCall({
        id: 'call-1',
        type: 'function',
        function: { name: 'search', arguments: {} },
      }),
    ).toBe(false);
  });

  it('narrows objects with defined properties', () => {
    const entries = [{ value: 1 }, { value: undefined }].filter(
      hasDefinedProperty('value'),
    );

    expect(entries).toEqual([{ value: 1 }]);
  });

  it('recognizes matching structured error codes', () => {
    expect(hasErrorCode({ code: 'ENOENT' }, 'ENOENT')).toBe(true);
    expect(hasErrorCode({ code: 'EACCES' }, 'ENOENT')).toBe(false);
    expect(hasErrorCode('ENOENT', 'ENOENT')).toBe(false);
  });
});
