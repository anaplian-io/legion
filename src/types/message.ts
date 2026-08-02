import type { GoalDecision } from './goal.js';
import type { EvidenceDescriptor } from './evidence.js';

export type MessageRole =
  | 'working-memory'
  | 'broadcast'
  | 'tool-intent'
  | 'user-input'
  | 'afferent'
  | 'afferent-capability'
  | 'node-response';

/** A machine-readable intent for one afferent node to fulfill. */
export interface ActionRequest {
  /** Stable request ID, normally inherited from the model's tool-call ID. */
  readonly id: string;
  readonly targetNodeId: string;
  /** Desired outcome stated without requiring knowledge of the target's schema. */
  readonly intent: string;
  /** Optional, non-authoritative hint that the target may repair or ignore. */
  readonly operation?: string;
  /** Optional, non-authoritative structured hints for fulfilling the intent. */
  readonly arguments?: Readonly<Record<string, unknown>>;
}

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly originatingNodeId?: string;
  /** Memory nodes credited when a distiller synthesizes several candidates. */
  readonly contributingNodeIds?: readonly string[];
  /** Control data is kept separate from prose and survives candidate selection. */
  readonly actionRequests?: readonly ActionRequest[];
  /** A proposed goal transition for GoalNode to validate on the next wave. */
  readonly goalDecision?: GoalDecision;
  /** Stable ID while this message participates as an epoch candidate. */
  readonly candidateId?: string;
  /** Bounded external provenance carried by afferent tool output. */
  readonly evidence?: readonly EvidenceDescriptor[];
  /** User inputs whose first post-input epoch produced this message. */
  readonly inputIds?: readonly string[];
}

/** A node response with the stable identity assigned before epoch work begins. */
export interface CandidateMessage extends Message {
  readonly originatingNodeId: string;
  readonly candidateId: string;
}
