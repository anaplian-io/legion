import { WorkingMemory } from '../types/working-memory.js';
import { Message } from '../types/message.js';
import { EventStream } from '../types/event-stream.js';

export interface WorkingMemoryBufferProps {
  readonly maxMessages: number;
  readonly eventStream: EventStream;
  readonly initialBroadcast: Message;
  readonly initial?: WorkingMemory | undefined;
}

/**
 * A rolling window of recent broadcasts. Appending a message evicts the oldest
 * entries beyond `maxMessages` and publishes the updated window.
 */
export class WorkingMemoryBuffer {
  private readonly _workingMemory: WorkingMemory;
  private _currentBroadcast: Message;
  private _currentBroadcastCommitted: boolean;

  constructor(private readonly props: WorkingMemoryBufferProps) {
    // Clone so the caller's initial object (and its messages array) is not
    // mutated in place as the window rolls.
    this._workingMemory = { messages: [...(props.initial?.messages ?? [])] };
    this._currentBroadcast = props.initialBroadcast;
    this._currentBroadcastCommitted = this.isCurrentBroadcastLastMemory();
  }

  public get workingMemory(): WorkingMemory {
    return this._workingMemory;
  }

  public get currentBroadcast(): Message {
    return this._currentBroadcast;
  }

  public append(broadcast: Message): void {
    if (!this._currentBroadcastCommitted) {
      this._workingMemory.messages.push({
        role: 'working-memory',
        content: this._currentBroadcast.content,
      });
    }

    while (this._workingMemory.messages.length > this.props.maxMessages) {
      this._workingMemory.messages.shift();
    }
    this._currentBroadcast = broadcast;
    this._currentBroadcastCommitted = false;
    this.props.eventStream.publish({
      topicName: 'orchestrator/working-memory-updated',
      data: {
        workingMemory: this._workingMemory,
        broadcast: this._currentBroadcast,
      },
    });
  }

  private readonly isCurrentBroadcastLastMemory = (): boolean => {
    const lastMessage =
      this._workingMemory.messages[this._workingMemory.messages.length - 1];
    return lastMessage?.content === this._currentBroadcast.content;
  };
}
