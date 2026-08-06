import { describe, expect, it } from 'vitest';
import { DeduplicatingMemoryPromptBuilder } from './deduplicating-memory-prompt-builder.js';
import type { BroadcastMessage } from '../../types/node.js';
import type { Message } from '../../types/message.js';
import { TEST_NODE_TELEMETRY } from '../../telemetry/test-context.fixture.js';

describe('DeduplicatingMemoryPromptBuilder', () => {
  const builder = new DeduplicatingMemoryPromptBuilder();

  it('orders working memory, unique afferent context, and the broadcast', () => {
    const workingMemoryMessage: Message = {
      role: 'working-memory',
      content: 'Known result',
    };
    const capability: Message = {
      role: 'afferent-capability',
      content: 'tool-search is available',
    };
    const observation: Message = {
      role: 'afferent',
      content: 'Fresh result',
      originatingNodeId: 'tool-search',
    };
    const duplicate: Message = {
      role: 'afferent',
      content: 'Known result',
      originatingNodeId: 'tool-search',
    };
    const broadcast: Message = { role: 'broadcast', content: 'Continue' };

    expect(
      builder.buildMessages(
        message({
          workingMemory: { messages: [workingMemoryMessage] },
          afferentContext: [
            capability,
            capability,
            observation,
            duplicate,
            observation,
          ],
          broadcast,
        }),
      ),
    ).toEqual([workingMemoryMessage, capability, observation, broadcast]);
  });

  it('keeps identical user inputs with different input IDs', () => {
    const first: Message = {
      role: 'user-input',
      content: 'Repeat this',
      inputIds: ['input-1'],
    };
    const second: Message = {
      role: 'user-input',
      content: 'Repeat this',
      inputIds: ['input-2'],
    };
    const withoutInputIds: Message = {
      role: 'user-input',
      content: 'No correlation ID',
    };

    expect(
      builder.buildMessages(
        message({
          afferentContext: [
            first,
            first,
            second,
            withoutInputIds,
            withoutInputIds,
          ],
        }),
      ),
    ).toEqual([
      first,
      second,
      withoutInputIds,
      { role: 'broadcast', content: 'Broadcast' },
    ]);
  });

  const message = (
    overrides: Partial<BroadcastMessage> = {},
  ): BroadcastMessage => ({
    telemetry: TEST_NODE_TELEMETRY,
    workingMemory: { messages: [] },
    broadcast: { role: 'broadcast', content: 'Broadcast' },
    ...overrides,
  });
});
