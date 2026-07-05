import { describe, expect, it } from 'vitest';
import { ExplicitNodeMentionRelevanceGate } from './explicit-node-mention-relevance-gate.js';
import type { RelevanceGateProps } from '../types/relevance-gate.js';

interface PropsOptions {
  readonly nodeId?: string;
  readonly workingMemoryContent?: string;
}

const props = (
  broadcastContent: string,
  options: PropsOptions = {},
): RelevanceGateProps => ({
  nodeId: options.nodeId ?? 'tool-search',
  epochsAlive: 0,
  broadcastMessage: {
    workingMemory: {
      messages:
        options.workingMemoryContent === undefined
          ? []
          : [
              {
                role: 'working-memory',
                content: options.workingMemoryContent,
              },
            ],
    },
    broadcast: { role: 'broadcast', content: broadcastContent },
  },
});

describe('ExplicitNodeMentionRelevanceGate', () => {
  it('matches a standalone node ID in the current broadcast', async () => {
    const gate = new ExplicitNodeMentionRelevanceGate();

    await expect(
      gate.isRelevant(props('Ask tool-search to search for current weather.')),
    ).resolves.toBe(true);
  });

  it('matches an @nodeId mention in the current broadcast', async () => {
    const gate = new ExplicitNodeMentionRelevanceGate();

    await expect(
      gate.isRelevant(props('@tool-search search for current weather.')),
    ).resolves.toBe(true);
  });

  it('does not match partial node IDs', async () => {
    const gate = new ExplicitNodeMentionRelevanceGate();

    await expect(
      gate.isRelevant(props('Ask tool-search-extra for current weather.')),
    ).resolves.toBe(false);
    await expect(
      gate.isRelevant(props('Ask pretool-search for current weather.')),
    ).resolves.toBe(false);
  });

  it('ignores stale node mentions in working memory', async () => {
    const gate = new ExplicitNodeMentionRelevanceGate();

    await expect(
      gate.isRelevant(
        props('Continue the current inquiry.', {
          workingMemoryContent: 'Earlier request: ask tool-search to search.',
        }),
      ),
    ).resolves.toBe(false);
  });

  it('escapes node IDs before matching', async () => {
    const gate = new ExplicitNodeMentionRelevanceGate();

    await expect(
      gate.isRelevant(
        props('Ask @tool.search+1 to search.', { nodeId: 'tool.search+1' }),
      ),
    ).resolves.toBe(true);
  });

  it('does not match an empty node ID', async () => {
    const gate = new ExplicitNodeMentionRelevanceGate();

    await expect(
      gate.isRelevant(
        props('Any broadcast would contain an empty string.', {
          nodeId: '',
        }),
      ),
    ).resolves.toBe(false);
  });
});
