import { Message } from './message.js';
import { NodeStats } from './node-stats.js';
import { WorkingMemory } from './working-memory.js';
import type { CandidateTelemetryContext } from './telemetry.js';

export type NodeResponse = Message | undefined;

export interface NodeTelemetryContext extends CandidateTelemetryContext {
  readonly inputIds: readonly string[];
}

export interface BroadcastMessage {
  readonly workingMemory: WorkingMemory;
  readonly broadcast: Message;
  readonly recipientNodeStats?: NodeStats;
  /**
   * Outputs produced by afferent nodes (tools, sensors) earlier in the same
   * epoch, supplied to cognitive (memory) nodes as additional context. Afferent
   * nodes themselves ignore this field.
   */
  readonly afferentContext?: readonly Message[] | undefined;
  /** Explicit async-safe correlation for work performed by this node call. */
  readonly telemetry: NodeTelemetryContext;
}

export type NodeStatus = 'idle' | 'generating' | 'evaluating-relevance';

export type CandidateExperienceOutcome = 'selected' | 'rejected';

export interface Node<T extends string> {
  readonly id: string;
  readonly status: NodeStatus;
  readonly kind: T;
  readonly context: string;
  readonly capabilityDescription?: string;
  readonly sendMessage: (
    broadcastMessage: BroadcastMessage,
  ) => Promise<NodeResponse>;
  /**
   * Memory nodes keep generated experience pending until the orchestrator
   * resolves the candidate's epoch outcome. Afferent nodes do not implement
   * this operation.
   */
  readonly resolveCandidate?: (
    candidateId: string,
    outcome: CandidateExperienceOutcome,
  ) => void;
}
