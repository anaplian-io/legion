import type { EvidenceDescriptor } from './evidence.js';

/** Bounded details of the candidate selected before argument generation. */
export interface ToolOperationSelection {
  readonly candidateIndex: number;
  readonly operation: string;
}

export interface ToolNodeOutcome {
  readonly requestId: string;
  readonly intent?: string;
  readonly selectedOperations?: readonly string[];
  readonly stage: 'elaboration' | 'mcp';
  readonly success: boolean;
  readonly callId?: string;
  readonly name?: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly evidence?: EvidenceDescriptor;
}
