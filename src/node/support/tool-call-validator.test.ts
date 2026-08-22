import { describe, expect, it } from 'vitest';
import type { ToolCall, ToolDefinition } from '../../types/tool.js';
import { validateGeneratedCalls } from './tool-call-validator.js';

const tools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Return web result listings.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description: 'Return webpage content.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

const call = (name: string, argumentsStr: string, id = 'call-1'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: argumentsStr },
});

describe('validateGeneratedCalls', () => {
  it('accepts one or more schema-valid calls to the resolved operation', () => {
    const calls = [
      call('fetch', '{"url":"https://example.com/a"}', 'call-a'),
      call('fetch', '{"url":"https://example.com/b"}', 'call-b'),
    ];

    expect(validateGeneratedCalls(calls, tools, 'fetch')).toEqual({
      outcome: 'success',
      calls,
    });
  });

  it('distinguishes a semantic operation mismatch from structural failures', () => {
    const calls = [call('search', '{"query":"https://example.com"}')];

    expect(validateGeneratedCalls(calls, tools, 'fetch')).toEqual({
      outcome: 'semantic-mismatch',
      calls,
      error:
        'Resolved operation fetch, but the provider selected incompatible operation(s) search.',
    });
  });

  it.each([
    {
      description: 'no calls',
      calls: [],
      expected: 'Provider returned no tool calls.',
    },
    {
      description: 'a malformed call',
      calls: [{ id: '', type: 'function' }],
      expected: 'Provider returned a malformed tool call',
    },
    {
      description: 'an unknown operation',
      calls: [call('unknown', '{}')],
      expected: 'Tool unknown was not advertised',
    },
    {
      description: 'malformed JSON',
      calls: [call('search', '{bad')],
      expected: 'arguments are not valid JSON',
    },
    {
      description: 'non-object arguments',
      calls: [call('search', '[]')],
      expected: 'arguments must be a JSON object',
    },
    {
      description: 'schema-invalid arguments',
      calls: [call('search', '{"query":4}')],
      expected: 'arguments do not match its advertised schema',
    },
  ])('rejects $description structurally', ({ calls, expected }) => {
    const result = validateGeneratedCalls(calls, tools, 'search');

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'structural-failure',
        error: expect.stringContaining(expected),
      }),
    );
  });

  it('rejects an invalid advertised schema structurally', () => {
    const invalidTools: ToolDefinition[] = [
      {
        name: 'broken',
        parameters: { type: 'not-a-json-schema-type' },
      },
    ];

    const result = validateGeneratedCalls(
      [call('broken', '{}')],
      invalidTools,
      'broken',
    );

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'structural-failure',
        error: expect.stringContaining('invalid advertised schema'),
      }),
    );
  });
});
