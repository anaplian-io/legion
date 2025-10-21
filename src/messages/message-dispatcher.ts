import {
  DeliverMessage,
  OutboundMessage,
  SendMessage,
} from '../types/message.js';

export interface MessageDispatcherProps {
  readonly recipients: Record<string, DeliverMessage>;
}

export class MessageDispatcher implements SendMessage {
  constructor(private readonly props: MessageDispatcherProps) {}

  public readonly sendMessage = (message: OutboundMessage): this => {
    this.props.recipients[message.toId]?.deliverMessage({
      fromId: message.fromId,
      content: message.content,
      sentAt: new Date(),
    });
    return this;
  };
}
