export type MessageRole =
  | 'working-memory'
  | 'broadcast'
  | 'afferent'
  | 'afferent-capability'
  | 'node-response';

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly originatingNodeId?: string;
}
