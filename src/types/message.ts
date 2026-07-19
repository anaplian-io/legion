export type MessageRole =
  | 'working-memory'
  | 'broadcast'
  | 'user-input'
  | 'afferent'
  | 'afferent-capability'
  | 'node-response';

/** A machine-readable request for one afferent node to perform an operation. */
export interface ActionRequest {
  /** Stable request ID, normally inherited from the model's tool-call ID. */
  readonly id: string;
  readonly targetNodeId: string;
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly originatingNodeId?: string;
  /** Memory nodes credited when a distiller synthesizes several candidates. */
  readonly contributingNodeIds?: readonly string[];
  /** Control data is kept separate from prose and survives candidate selection. */
  readonly actionRequests?: readonly ActionRequest[];
}
