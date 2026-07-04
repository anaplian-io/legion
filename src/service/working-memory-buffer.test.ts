import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemoryBuffer } from './working-memory-buffer.js';
import { ConcreteEventStream } from './concrete-event-stream.js';
import type { WorkingMemoryUpdatedData } from '../types/event-stream.js';

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
      initial: {
        messages: [{ role: 'working-memory', content: 'seed' }],
      },
    });
    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'seed' },
    ]);
  });

  it('appends messages', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 3, eventStream });
    buffer.append(
      { role: 'working-memory', content: 'a' },
      { role: 'broadcast', content: 'next' },
    );
    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'a' },
    ]);
  });

  it('evicts the oldest entries beyond maxMessages', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 2, eventStream });
    buffer.append(
      { role: 'working-memory', content: 'a' },
      { role: 'broadcast', content: 'n' },
    );
    buffer.append(
      { role: 'working-memory', content: 'b' },
      { role: 'broadcast', content: 'n' },
    );
    buffer.append(
      { role: 'working-memory', content: 'c' },
      { role: 'broadcast', content: 'n' },
    );
    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'b' },
      { role: 'working-memory', content: 'c' },
    ]);
  });

  it('publishes the updated window and current broadcast on append', () => {
    const buffer = new WorkingMemoryBuffer({ maxMessages: 3, eventStream });
    let payload: WorkingMemoryUpdatedData | undefined;
    eventStream.subscribe({
      topicName: 'orchestrator/working-memory-updated',
      receiver: (data) => {
        payload = data;
      },
    });

    buffer.append(
      { role: 'working-memory', content: 'a' },
      { role: 'broadcast', content: 'broadcast' },
    );

    expect(payload?.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'a' },
    ]);
    expect(payload?.broadcast).toEqual({
      role: 'broadcast',
      content: 'broadcast',
    });
  });
});
