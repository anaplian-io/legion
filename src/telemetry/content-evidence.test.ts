import { describe, expect, it } from 'vitest';
import {
  contentHash,
  evidenceDescriptor,
  messageContentHash,
} from './content-evidence.js';

describe('content evidence', () => {
  it('hashes equivalent object keys deterministically', () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(contentHash([1, undefined, 3n])).not.toBe(contentHash([1, 3]));
    expect(contentHash(() => undefined)).toHaveLength(64);
    expect(contentHash(Symbol('x'))).toHaveLength(64);
  });

  it('excludes run-local message correlation from semantic content hashes', () => {
    const first = {
      role: 'node-response' as const,
      content: 'Search first.',
      candidateId: 'candidate-1',
      inputIds: ['input-1'],
    };
    const second = {
      ...first,
      candidateId: 'candidate-2',
      inputIds: ['input-2'],
    };

    expect(messageContentHash(first)).toBe(messageContentHash(second));
    expect(
      messageContentHash({
        ...second,
        actionRequests: [
          { id: 'request-1', targetNodeId: 'tool-search', intent: 'Search.' },
        ],
      }),
    ).not.toBe(messageContentHash(second));
  });

  it('retains bounded source and artifact references where available', () => {
    const descriptor = evidenceDescriptor('evidence-1', {
      url: 'https://example.com/source',
      nested: [{ uri: 'artifact://result' }, { path: '/tmp/result.txt' }],
      ignored: null,
    });
    expect(descriptor).toMatchObject({
      id: 'evidence-1',
      contentHash: expect.any(String),
      sourceUrls: ['https://example.com/source'],
      artifactReferences: ['artifact://result', '/tmp/result.txt'],
    });
  });

  it('omits missing references and caps collected references', () => {
    expect(evidenceDescriptor('plain', { value: 1 })).toEqual({
      id: 'plain',
      contentHash: expect.any(String),
    });
    const urls = Array.from(
      { length: 12 },
      (_, index) => `https://example.com/${index}`,
    );
    expect(evidenceDescriptor('bounded', urls).sourceUrls).toHaveLength(8);
  });

  it('bounds source URLs and redacts credentials and sensitive parameters', () => {
    const descriptor = evidenceDescriptor('redacted', {
      url: `https://user:password@example.com/result?token=secret&q=${'x'.repeat(600)}#private`,
    });
    const [sourceUrl] = descriptor.sourceUrls ?? [];

    expect(sourceUrl).not.toContain('user:password');
    expect(sourceUrl).not.toContain('secret');
    expect(sourceUrl).not.toContain('#private');
    expect(sourceUrl).toContain('token=%5BREDACTED%5D');
    expect(sourceUrl?.length).toBeLessThanOrEqual(512);
    expect(
      evidenceDescriptor('malformed', { url: 'http://[' }).sourceUrls,
    ).toEqual(['http://[']);
  });
});
