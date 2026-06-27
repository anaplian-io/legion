import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemoryBuffer } from './working-memory-buffer.js';
import { ConcreteEventStream } from './concrete-event-stream.js';

describe('WorkingMemoryBuffer', () => {
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    eventStream = new ConcreteEventStream();
  });

  it('starts empty when no initial memory is given', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 3, eventStream });
    expect(buffer.workingMemory.messages).toEqual([]);
  });

  it('uses the provided initial working memory', () => {
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 3,
      eventStream,
      initial: { messages: [{ content: 'seed' }] },
    });
    expect(buffer.workingMemory.messages).toEqual([{ content: 'seed' }]);
  });

  it('appends messages', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 3, eventStream });
    buffer.append({ content: 'a' }, { content: 'next' });
    expect(buffer.workingMemory.messages).toEqual([{ content: 'a' }]);
  });

  it('evicts the oldest entries beyond maxMessages', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 2, eventStream });
    buffer.append({ content: 'a' }, { content: 'n' });
    buffer.append({ content: 'b' }, { content: 'n' });
    buffer.append({ content: 'c' }, { content: 'n' });
    expect(buffer.workingMemory.messages).toEqual([
      { content: 'b' },
      { content: 'c' },
    ]);
  });

  it('publishes the updated window and current broadcast on append', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 3, eventStream });
    let payload:
      | {
          workingMemory: { messages: { content: string }[] };
          broadcast: { content: string };
        }
      | undefined;
    eventStream.subscribe({
      topicName: 'orchestrator/working-memory-updated',
      receiver: (data) => {
        payload = data;
      },
    });

    buffer.append({ content: 'a' }, { content: 'broadcast' });

    expect(payload?.workingMemory.messages).toEqual([{ content: 'a' }]);
    expect(payload?.broadcast).toEqual({ content: 'broadcast' });
  });
});
