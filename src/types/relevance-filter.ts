import { CandidateMessage } from './message.js';
import { WorkingMemory } from './working-memory.js';
import type { EpochTelemetryContext } from './telemetry.js';

export interface RelevanceFilter {
  readonly filter: (
    workingMemory: WorkingMemory,
    candidateMessages: CandidateMessage[],
    telemetry: EpochTelemetryContext,
  ) => Promise<CandidateMessage[]>;
}
