import { describe, expect, it } from 'vitest';
import { createToolOutputPreview } from './tool-output-preview.js';

describe('createToolOutputPreview', () => {
  it('preserves short string output and omits absent output', () => {
    expect(createToolOutputPreview('windy\nand warm')).toBe('windy and warm');
    expect(createToolOutputPreview(undefined)).toBe('');
  });

  it('serializes structured output and falls back when JSON has no value', () => {
    expect(createToolOutputPreview({ temperature: 72 })).toBe(
      '{"temperature":72}',
    );
    expect(createToolOutputPreview(() => undefined)).toContain('undefined');
  });

  it('marks output that cannot be serialized', () => {
    expect(createToolOutputPreview(1n)).toBe('[unserializable tool output]');
  });

  it('bounds long output with an ellipsis', () => {
    const output = createToolOutputPreview(`  ${'a'.repeat(300)}  `);

    expect(output).toHaveLength(240);
    expect(output.endsWith('…')).toBe(true);
  });
});
