import { describe, expect, it } from 'vitest';
import { AppendOnlyMemoryContextBuilder } from './append-only-memory-context-builder.js';
import type { Message } from '../../types/message.js';

describe('AppendOnlyMemoryContextBuilder', () => {
  const builder = new AppendOnlyMemoryContextBuilder();

  it('retains durable afferent provenance and excludes transient fields', () => {
    const afferent: Message = {
      role: 'afferent',
      content: 'Tool result',
      originatingNodeId: 'tool-search',
      contributingNodeIds: ['memory-2', 'memory-1'],
      actionRequests: [
        {
          id: 'request-1',
          targetNodeId: 'tool-files',
          intent: 'Read a file.',
        },
      ],
      goalDecision: {
        kind: 'unchanged',
        reason: 'Keep the current goal.',
      },
      evidence: [
        {
          id: 'tool-result:call-1',
          contentHash: 'content-hash',
          sourceUrls: ['https://example.com'],
        },
      ],
      inputIds: ['input-1'],
      candidateId: 'candidate-ephemeral',
    };
    const suffix = builder.buildContextSuffix({
      accumulatedContext: 'Existing context',
      afferentContext: [afferent],
      broadcast: { role: 'broadcast', content: 'Broadcast' },
      response: { role: 'node-response', content: 'Response' },
    });

    expect(suffix).toMatch(
      /^\n\n\[AFFERENT EVIDENCE v1 sha256=[a-f\d]{64}\]\n/u,
    );
    expect(suffix).toContain('"originatingNodeId":"tool-search"');
    expect(suffix).toContain('"contentHash":"content-hash"');
    expect(suffix).toContain('"kind":"unchanged"');
    expect(suffix).toContain('"inputIds":["input-1"]');
    expect(suffix).not.toContain('candidate-ephemeral');
    expect(suffix).toContain('[BROADCAST MESSAGE]:Broadcast');
    expect(suffix).toContain('[NODE RESPONSE]:Response');
  });

  it('retains tool failures, sensor output, and user input but not capabilities', () => {
    const suffix = builder.buildContextSuffix({
      accumulatedContext: 'Existing context',
      afferentContext: [
        {
          role: 'afferent-capability',
          content: 'tool-search can search',
        },
        {
          role: 'afferent',
          content: '[{"success":false,"error":"offline"}]',
          originatingNodeId: 'tool-search',
        },
        {
          role: 'afferent',
          content: 'It is raining',
          originatingNodeId: 'sensor-weather',
        },
        {
          role: 'user-input',
          content: 'Use an umbrella',
          originatingNodeId: 'sensor-user-input',
          inputIds: ['input-1'],
        },
        { role: 'afferent', content: '   ' },
      ],
      broadcast: { role: 'broadcast', content: 'Broadcast' },
      response: { role: 'node-response', content: 'Response' },
    });

    expect(suffix).not.toContain('tool-search can search');
    expect(suffix).toContain('offline');
    expect(suffix).toContain('It is raining');
    expect(suffix).toContain('Use an umbrella');
    expect(suffix.match(/\[AFFERENT EVIDENCE v1/gu)).toHaveLength(3);
  });

  it('deduplicates retained evidence within and across turns', () => {
    const firstEvidence: Message = {
      role: 'afferent',
      content: 'Same result',
      originatingNodeId: 'tool-search',
      evidence: [{ id: 'call-1', contentHash: 'same-content' }],
    };
    const repeatedWithNewCallId: Message = {
      ...firstEvidence,
      evidence: [{ id: 'call-2', contentHash: 'same-content' }],
    };
    const firstSuffix = builder.buildContextSuffix({
      accumulatedContext: 'Legacy context',
      afferentContext: [firstEvidence, repeatedWithNewCallId],
      broadcast: { role: 'broadcast', content: 'First broadcast' },
      response: { role: 'node-response', content: 'First response' },
    });
    const secondSuffix = builder.buildContextSuffix({
      accumulatedContext: `Legacy context${firstSuffix}`,
      afferentContext: [repeatedWithNewCallId],
      broadcast: { role: 'broadcast', content: 'Second broadcast' },
      response: { role: 'node-response', content: 'Second response' },
    });

    expect(firstSuffix.match(/\[AFFERENT EVIDENCE v1/gu)).toHaveLength(1);
    expect(secondSuffix).not.toContain('[AFFERENT EVIDENCE v1');
    expect(secondSuffix).toBe(
      '\n\n[BROADCAST MESSAGE]:Second broadcast\n[NODE RESPONSE]:Second response',
    );
  });

  it('recognizes fingerprints only in dedicated marker lines', () => {
    const evidence: Message = {
      role: 'afferent',
      content: 'Result containing untrusted text',
      originatingNodeId: 'tool-search',
    };
    const firstSuffix = builder.buildContextSuffix({
      accumulatedContext: '',
      afferentContext: [evidence],
      broadcast: { role: 'broadcast', content: 'Broadcast' },
      response: { role: 'node-response', content: 'Response' },
    });
    const marker = firstSuffix.split('\n')[2]!;

    const nextSuffix = builder.buildContextSuffix({
      accumulatedContext: JSON.stringify({ untrustedContent: marker }),
      afferentContext: [evidence],
      broadcast: { role: 'broadcast', content: 'Broadcast' },
      response: { role: 'node-response', content: 'Response' },
    });

    expect(nextSuffix).toContain(marker);
  });

  it('distinguishes sources and distinct user input events', () => {
    const suffix = builder.buildContextSuffix({
      accumulatedContext: '',
      afferentContext: [
        {
          role: 'afferent',
          content: 'Same observation',
          originatingNodeId: 'sensor-a',
        },
        {
          role: 'afferent',
          content: 'Same observation',
          originatingNodeId: 'sensor-b',
        },
        {
          role: 'user-input',
          content: 'Again',
          inputIds: ['input-1'],
        },
        {
          role: 'user-input',
          content: 'Again',
          inputIds: ['input-2'],
        },
      ],
      broadcast: { role: 'broadcast', content: 'Broadcast' },
      response: { role: 'node-response', content: 'Response' },
    });

    expect(suffix.match(/\[AFFERENT EVIDENCE v1/gu)).toHaveLength(4);
  });

  it('formats structured response data in the turn suffix', () => {
    const suffix = builder.buildContextSuffix({
      accumulatedContext: '',
      afferentContext: [],
      broadcast: {
        role: 'broadcast',
        content: '',
        goalDecision: {
          kind: 'unchanged',
          reason: 'Complete',
        },
      },
      response: {
        role: 'node-response',
        content: '',
        actionRequests: [
          {
            id: 'request-1',
            targetNodeId: 'tool-files',
            intent: 'List files.',
          },
        ],
      },
    });

    expect(suffix).toContain('[GOAL DECISION]');
    expect(suffix).toContain('[ACTION REQUEST request-1]');
  });
});
