const MAX_TOOL_OUTPUT_PREVIEW_LENGTH = 240;

/** Turns arbitrary tool output into a bounded, single-line Activity preview. */
export const createToolOutputPreview = (output: unknown): string => {
  const serialized = serializeToolOutput(output);
  const singleLine = serialized.replace(/\s+/g, ' ').trim();
  return singleLine.length <= MAX_TOOL_OUTPUT_PREVIEW_LENGTH
    ? singleLine
    : `${singleLine.slice(0, MAX_TOOL_OUTPUT_PREVIEW_LENGTH - 1)}…`;
};

const serializeToolOutput = (output: unknown): string => {
  if (output === undefined) {
    return '';
  }
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return '[unserializable tool output]';
  }
};
