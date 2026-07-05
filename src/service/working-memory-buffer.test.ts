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
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 3,
      eventStream,
      initialBroadcast: { role: 'broadcast', content: 'initial' },
    });
    expect(buffer.workingMemory.messages).toEqual([]);
    expect(buffer.currentBroadcast).toEqual({
      role: 'broadcast',
      content: 'initial',
    });
  });

  it('uses the provided initial working memory', () => {
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 3,
      eventStream,
      initialBroadcast: { role: 'broadcast', content: 'current' },
      initial: {
        messages: [{ role: 'working-memory', content: 'seed' }],
      },
    });
    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'seed' },
    ]);
  });

  it('rolls the current broadcast into working memory when appending a new broadcast', () => {
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 3,
      eventStream,
      initialBroadcast: { role: 'broadcast', content: 'a' },
    });
    buffer.append({ role: 'broadcast', content: 'next' });
    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'a' },
    ]);
    expect(buffer.currentBroadcast).toEqual({
      role: 'broadcast',
      content: 'next',
    });
  });

  it('evicts the oldest entries beyond maxMessages', () => {
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 2,
      eventStream,
      initialBroadcast: { role: 'broadcast', content: 'a' },
    });
    buffer.append({ role: 'broadcast', content: 'b' });
    buffer.append({ role: 'broadcast', content: 'c' });
    buffer.append({ role: 'broadcast', content: 'd' });
    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'b' },
      { role: 'working-memory', content: 'c' },
    ]);
  });

  it('does not duplicate a restored current broadcast already in memory', () => {
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 3,
      eventStream,
      initialBroadcast: { role: 'broadcast', content: 'restored current' },
      initial: {
        messages: [
          { role: 'working-memory', content: 'older' },
          { role: 'working-memory', content: 'restored current' },
        ],
      },
    });

    buffer.append({ role: 'broadcast', content: 'next' });

    expect(buffer.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'older' },
      { role: 'working-memory', content: 'restored current' },
    ]);
    expect(buffer.currentBroadcast).toEqual({
      role: 'broadcast',
      content: 'next',
    });
  });

  it('publishes the updated window and current broadcast on append', () => {
    const buffer = new WorkingMemoryBuffer({
      maxMessages: 3,
      eventStream,
      initialBroadcast: { role: 'broadcast', content: 'a' },
    });
    let payload: WorkingMemoryUpdatedData | undefined;
    eventStream.subscribe({
      topicName: 'orchestrator/working-memory-updated',
      receiver: (data) => {
        payload = data;
      },
    });

    buffer.append({ role: 'broadcast', content: 'broadcast' });

    expect(payload?.workingMemory.messages).toEqual([
      { role: 'working-memory', content: 'a' },
    ]);
    expect(payload?.broadcast).toEqual({
      role: 'broadcast',
      content: 'broadcast',
    });
  });
});
