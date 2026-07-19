import { describe, expect, it } from 'vitest';
import { TargetedActionRequestRelevanceGate } from './targeted-action-request-relevance-gate.js';
import type { RelevanceGateProps } from '../types/relevance-gate.js';
import type { ActionRequest } from '../types/message.js';

const request = (targetNodeId: string): ActionRequest => ({
  id: 'request-1',
  targetNodeId,
  operation: 'search',
  arguments: { query: 'weather' },
});

const props = (
  nodeId: string,
  actionRequests?: readonly ActionRequest[],
): RelevanceGateProps => ({
  nodeId,
  epochsAlive: 0,
  broadcastMessage: {
    workingMemory: {
      messages: [
        {
          role: 'working-memory',
          content: 'Earlier prose mentioned tool-search.',
        },
      ],
    },
    broadcast: {
      role: 'broadcast',
      content: 'Current prose also mentions @tool-search.',
      ...(actionRequests === undefined ? {} : { actionRequests }),
    },
  },
});

describe('TargetedActionRequestRelevanceGate', () => {
  it('matches a structured request addressed to the exact node ID', async () => {
    const gate = new TargetedActionRequestRelevanceGate();

    await expect(
      gate.isRelevant(props('tool-search', [request('tool-search')])),
    ).resolves.toBe(true);
  });

  it('ignores prose mentions and requests for other nodes', async () => {
    const gate = new TargetedActionRequestRelevanceGate();

    await expect(gate.isRelevant(props('tool-search'))).resolves.toBe(false);
    await expect(
      gate.isRelevant(props('tool-search', [request('tool-search-extra')])),
    ).resolves.toBe(false);
  });

  it('does not match an empty node ID', async () => {
    const gate = new TargetedActionRequestRelevanceGate();

    await expect(
      gate.isRelevant(props('', [request('tool-search')])),
    ).resolves.toBe(false);
  });
});
