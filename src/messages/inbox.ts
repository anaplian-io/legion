import {
  DeliverMessage,
  InboundMessage,
  ReceiveMessages,
} from '../types/message.js';

export class Inbox implements ReceiveMessages, DeliverMessage {
  private messages: InboundMessage[] = [];

  public readonly deliverMessage = (message: InboundMessage): this => {
    this.messages.push(message);
    return this;
  };

  public readonly receiveMessages = (): InboundMessage[] => {
    const allMessages = [...this.messages];
    this.messages = [];
    return allMessages;
  };
}
