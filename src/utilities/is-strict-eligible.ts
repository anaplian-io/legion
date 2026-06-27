/**
 * Determines whether a JSON Schema can safely be sent to the OpenAI Responses
 * API with `strict: true`.
 *
 * OpenAI strict mode requires that *every* object node in the schema sets
 * `additionalProperties: false` and lists all of its `properties` keys in
 * `required`. MCP servers rarely emit schemas that satisfy this, and enabling
 * strict mode on a non-compliant schema causes the API to reject the tool
 * outright.
 *
 * The check is deliberately conservative: anything it does not recognise as
 * provably compliant returns `false`. A false negative merely forgoes the
 * strict-mode optimisation; a false positive would break a real tool call, so
 * we never risk one.
 */
// JSON Schema keywords whose strict-mode constraints this checker does not
// validate. A node carrying any of them is treated as not provably compliant.
const UNSUPPORTED_KEYWORDS = [
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  '$ref',
  'enum',
  'const',
] as const;

export const isStrictEligible = (schema: unknown): boolean => {
  if (!isRecord(schema)) {
    return false;
  }

  // Conservatively reject composition/reference keywords we don't recurse into,
  // so we never green-light a schema OpenAI strict mode would reject.
  if (UNSUPPORTED_KEYWORDS.some((keyword) => keyword in schema)) {
    return false;
  }

  const declaredType = schema['type'];
  const hasProperties = isRecord(schema['properties']);
  const isObjectNode = declaredType === 'object' || hasProperties;

  if (isObjectNode) {
    if (schema['additionalProperties'] !== false) {
      return false;
    }
    const properties = isRecord(schema['properties'])
      ? schema['properties']
      : {};
    const propertyKeys = Object.keys(properties);
    const required = Array.isArray(schema['required'])
      ? schema['required']
      : [];
    const everyPropertyRequired = propertyKeys.every((key) =>
      required.includes(key),
    );
    if (!everyPropertyRequired) {
      return false;
    }
    // Recurse into each property's schema.
    return propertyKeys.every((key) => isStrictEligible(properties[key]));
  }

  // Array node: every item must itself be eligible.
  if (declaredType === 'array') {
    return isStrictEligible(schema['items']);
  }

  // Primitive/leaf node (string, number, boolean, etc.) imposes no further
  // strict requirements.
  return true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
