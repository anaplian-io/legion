import { describe, it, expect } from 'vitest';
import { isStrictEligible } from './is-strict-eligible.js';

describe('isStrictEligible', () => {
  it('returns false for non-object schemas', () => {
    expect(isStrictEligible(null)).toBe(false);
    expect(isStrictEligible(undefined)).toBe(false);
    expect(isStrictEligible('string')).toBe(false);
    expect(isStrictEligible(42)).toBe(false);
    expect(isStrictEligible([])).toBe(false);
  });

  it('rejects schemas carrying unvalidated composition/reference keywords', () => {
    for (const keyword of [
      'anyOf',
      'oneOf',
      'allOf',
      'not',
      '$ref',
      'enum',
      'const',
    ]) {
      expect(
        isStrictEligible({
          type: 'object',
          additionalProperties: false,
          properties: {},
          [keyword]: [],
        }),
      ).toBe(false);
    }
  });

  it('returns true for a fully compliant object schema', () => {
    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: false,
        properties: {
          location: { type: 'string' },
          unit: { type: 'string' },
        },
        required: ['location', 'unit'],
      }),
    ).toBe(true);
  });

  it('returns false when additionalProperties is not false', () => {
    expect(
      isStrictEligible({
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      }),
    ).toBe(false);

    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: true,
        properties: { location: { type: 'string' } },
        required: ['location'],
      }),
    ).toBe(false);
  });

  it('returns false when a property is missing from required', () => {
    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: false,
        properties: {
          location: { type: 'string' },
          unit: { type: 'string' },
        },
        required: ['location'],
      }),
    ).toBe(false);
  });

  it('treats a node with properties but no explicit type as an object node', () => {
    expect(
      isStrictEligible({
        properties: { a: { type: 'string' } },
        additionalProperties: false,
        required: ['a'],
      }),
    ).toBe(true);

    expect(
      isStrictEligible({
        properties: { a: { type: 'string' } },
        required: ['a'],
      }),
    ).toBe(false);
  });

  it('recurses into nested object properties', () => {
    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: false,
        properties: {
          nested: {
            type: 'object',
            additionalProperties: false,
            properties: { value: { type: 'number' } },
            required: ['value'],
          },
        },
        required: ['nested'],
      }),
    ).toBe(true);

    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: false,
        properties: {
          nested: {
            type: 'object',
            // missing additionalProperties: false
            properties: { value: { type: 'number' } },
            required: ['value'],
          },
        },
        required: ['nested'],
      }),
    ).toBe(false);
  });

  it('recurses into array item schemas', () => {
    expect(
      isStrictEligible({
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      }),
    ).toBe(true);

    expect(
      isStrictEligible({
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      }),
    ).toBe(false);
  });

  it('treats an object node with no properties field as eligible', () => {
    // type:'object' marks it an object node, but there is no properties map,
    // so the property-key checks operate over an empty set.
    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: false,
      }),
    ).toBe(true);
  });

  it('treats an empty-object schema as eligible', () => {
    expect(
      isStrictEligible({
        type: 'object',
        additionalProperties: false,
        properties: {},
      }),
    ).toBe(true);
  });

  it('treats primitive leaf schemas as eligible', () => {
    expect(isStrictEligible({ type: 'string' })).toBe(true);
    expect(isStrictEligible({ type: 'number' })).toBe(true);
  });
});
