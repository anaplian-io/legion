import { WorkingMemory } from '../types/working-memory.js';
import { Message } from '../types/message.js';
import { EventStream } from '../types/event-stream.js';

export interface WorkingMemoryBufferProps {
  readonly maxMessages: number;
  readonly eventStream: EventStream;
  readonly initial?: WorkingMemory | undefined;
}

/**
 * A rolling window of recent broadcasts. Appending a message evicts the oldest
 * entries beyond `maxMessages` and publishes the updated window.
 */
export class WorkingMemoryBuffer {
  private readonly _workingMemory: WorkingMemory;

  constructor(private readonly props: WorkingMemoryBufferProps) {
    this._workingMemory = props.initial ?? { messages: [] };
  }

  public get workingMemory(): WorkingMemory {
    return this._workingMemory;
  }

  public append(message: Message, broadcast: Message): void {
    this._workingMemory.messages.push(message);
    while (this._workingMemory.messages.length > this.props.maxMessages) {
      this._workingMemory.messages.shift();
    }
    this.props.eventStream.publish({
      topicName: 'orchestrator/working-memory-updated',
      data: {
        workingMemory: this._workingMemory,
        broadcast,
      },
    });
  }
}
