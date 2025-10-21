export interface Message {
  readonly content: string;
}

export type InboundMessage = Message & {
  readonly fromId: string;
  readonly sentAt: Date;
};

export type OutboundMessage = Message & {
  readonly toId: string;
  readonly fromId: string;
};

export interface ReceiveMessages {
  readonly receiveMessages: () => InboundMessage[];
}

export interface DeliverMessage {
  readonly deliverMessage: (message: InboundMessage) => this;
}

export interface SendMessage {
  readonly sendMessage: (message: OutboundMessage) => this;
}
