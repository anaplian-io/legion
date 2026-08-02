import type { CandidateMessage } from '../types/message.js';
import type { DistillationTelemetryContext } from '../types/distiller.js';
import type {
  EpochTelemetryContext,
  InferenceContext,
} from '../types/telemetry.js';
import type { NodeTelemetryContext } from '../types/node.js';
import { TelemetryRecorder } from './telemetry-recorder.js';

export const TEST_EPOCH_TELEMETRY: EpochTelemetryContext = {
  epochId: 'epoch-test',
};

export const TEST_NODE_TELEMETRY: NodeTelemetryContext = {
  ...TEST_EPOCH_TELEMETRY,
  wave: 'cognitive',
  candidateId: 'candidate-test',
  nodeId: 'node-test',
  inputIds: [],
};

export const TEST_INFERENCE_CONTEXT: InferenceContext = {
  stage: 'provider-generate',
};

export const TEST_DISTILLATION_TELEMETRY: DistillationTelemetryContext = {
  ...TEST_EPOCH_TELEMETRY,
  attempt: 'configured',
  attemptId: 'distillation-test',
  inferenceStage: 'configured-selection',
};

export const createTestTelemetry = (): TelemetryRecorder =>
  new TelemetryRecorder({ runId: 'run-test' });

export const testCandidate = (
  content: string,
  nodeId = 'memory-test',
): CandidateMessage => ({
  role: 'node-response',
  content,
  originatingNodeId: nodeId,
  candidateId: `candidate-${nodeId}`,
});
