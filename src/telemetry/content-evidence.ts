import { createHash } from 'node:crypto';
import type { EvidenceDescriptor } from '../types/evidence.js';
import type { Message } from '../types/message.js';

const MAX_REFERENCES = 8;
const MAX_REFERENCE_LENGTH = 512;
const SENSITIVE_URL_KEY =
  /^(api[-_]?key|auth|authorization|password|secret|signature|token)$/iu;

export const contentHash = (value: unknown): string =>
  createHash('sha256').update(stableString(value)).digest('hex');

/** Hashes semantic message payload without run-local correlation fields. */
export const messageContentHash = (message: Message): string =>
  contentHash({
    role: message.role,
    content: message.content,
    actionRequests: message.actionRequests,
    contributingNodeIds: message.contributingNodeIds,
    goalDecision: message.goalDecision,
    evidence: message.evidence,
  });

export const evidenceDescriptor = (
  id: string,
  value: unknown,
): EvidenceDescriptor => {
  const references = collectReferences(value);
  return {
    id,
    contentHash: contentHash(value),
    ...(references.sourceUrls.length === 0
      ? {}
      : { sourceUrls: references.sourceUrls }),
    ...(references.artifactReferences.length === 0
      ? {}
      : { artifactReferences: references.artifactReferences }),
  };
};

const stableString = (value: unknown): string => {
  if (value === undefined) {
    return '[undefined]';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return String(value);
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableString).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableString(entry)}`)
    .join(',')}}`;
};

const collectReferences = (
  value: unknown,
): {
  readonly sourceUrls: string[];
  readonly artifactReferences: string[];
} => {
  const sourceUrls = new Set<string>();
  const artifactReferences = new Set<string>();
  const visit = (entry: unknown, key?: string): void => {
    if (sourceUrls.size + artifactReferences.size >= MAX_REFERENCES) {
      return;
    }
    if (typeof entry === 'string') {
      const bounded = entry.slice(0, MAX_REFERENCE_LENGTH);
      if (/^https?:\/\//u.test(bounded)) {
        sourceUrls.add(redactSourceUrl(entry));
      } else if (
        key !== undefined &&
        /^(artifact|artifactId|artifactRef|file|path|uri)$/iu.test(key)
      ) {
        artifactReferences.add(bounded);
      }
      return;
    }
    if (entry === null || typeof entry !== 'object') {
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, key));
      return;
    }
    Object.entries(entry).forEach(([childKey, child]) =>
      visit(child, childKey),
    );
  };
  visit(value);
  return {
    sourceUrls: [...sourceUrls].slice(0, MAX_REFERENCES),
    artifactReferences: [...artifactReferences].slice(0, MAX_REFERENCES),
  };
};

const redactSourceUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_URL_KEY.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString().slice(0, MAX_REFERENCE_LENGTH);
  } catch {
    return value.slice(0, MAX_REFERENCE_LENGTH);
  }
};
