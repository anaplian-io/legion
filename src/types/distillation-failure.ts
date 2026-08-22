export const DISTILLATION_FAILURE_REASONS = [
  'provider-failure',
  'invalid-synthesis-tool-call',
  'invalid-synthesis-json',
  'invalid-synthesis-content',
  'invalid-candidate-evidence',
  'invalid-afferent-evidence',
  'invalid-action-selection',
  'invalid-goal-decision',
  'invalid-selection-output',
  'post-distillation-validation',
] as const;

export type DistillationFailureReason =
  (typeof DISTILLATION_FAILURE_REASONS)[number];

/** A bounded, telemetry-safe explanation of a strategy output failure. */
export class DistillationStrategyError extends Error {
  constructor(
    public readonly reason: DistillationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'DistillationStrategyError';
  }
}
