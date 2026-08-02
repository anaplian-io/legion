import { describe, expect, it } from 'vitest';
import { DistillationValidator } from './distillation-validator.js';
import type {
  DistillationProps,
  DistillationResult,
} from '../types/distiller.js';
import type { GoalDecision } from '../types/goal.js';

const action = {
  id: 'request-1',
  targetNodeId: 'tool-files',
  intent: 'Read the README.',
  operation: 'read_file',
  arguments: { path: 'README.md' },
} as const;

const activeGoal = {
  id: 'goal-1',
  objective: 'Understand the workspace',
  successCriteria: 'Publish a supported summary',
  origin: 'user' as const,
  revision: 1,
};

const props = (
  overrides: Partial<DistillationProps> = {},
): DistillationProps => ({
  workingMemory: { messages: [] },
  broadcasts: [
    {
      role: 'node-response',
      originatingNodeId: 'memory-test',
      candidateId: 'candidate-test',
      content: 'Inspect the README.',
      actionRequests: [action],
    },
    {
      role: 'node-response',
      originatingNodeId: 'memory-test',
      candidateId: 'candidate-test',
      content: 'Summarize the architecture.',
    },
  ],
  afferentContext: [
    { role: 'user-input', content: 'Learn how this workspace works.' },
    { role: 'afferent', content: 'README exists.' },
  ],
  ...overrides,
});

const unchangedResult = (
  overrides: Partial<DistillationResult> = {},
): DistillationResult => ({
  broadcast: {
    role: 'broadcast',
    content: 'Inspect the README.',
    actionRequests: [action],
  },
  supportingEvidence: [{ source: 'candidate', index: 0 }],
  goalDecision: { kind: 'unchanged', reason: 'No goal change is needed.' },
  ...overrides,
});

const proposedDecision = (
  overrides: Partial<Extract<GoalDecision, { kind: 'activate' }>> = {},
): Extract<GoalDecision, { kind: 'activate' }> => ({
  id: 'decision-1',
  kind: 'activate',
  objective: 'Understand the workspace',
  successCriteria: 'Publish a supported summary',
  origin: 'user',
  reason: 'The user requested a sustained investigation.',
  supportingEvidence: [{ source: 'afferent', index: 0 }],
  ...overrides,
});

describe('DistillationValidator', () => {
  const validator = new DistillationValidator();

  it('accepts preserved actions and supported goal transitions', () => {
    expect(() => validator.validate(props(), unchangedResult())).not.toThrow();
    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          supportingEvidence: [
            { source: 'candidate', index: 0 },
            { source: 'afferent', index: 0 },
          ],
          goalDecision: proposedDecision(),
        }),
      ),
    ).not.toThrow();

    for (const kind of ['revise', 'supersede'] as const) {
      expect(() =>
        validator.validate(
          props({ activeGoal }),
          unchangedResult({
            supportingEvidence: [{ source: 'candidate', index: 0 }],
            goalDecision: {
              ...proposedDecision({
                origin: 'autonomous',
                supportingEvidence: [{ source: 'candidate', index: 0 }],
              }),
              kind,
              goalId: 'goal-1',
            },
          }),
        ),
      ).not.toThrow();
    }

    for (const kind of ['complete', 'abandon'] as const) {
      expect(() =>
        validator.validate(
          props({ activeGoal }),
          unchangedResult({
            goalDecision: {
              id: `decision-${kind}`,
              kind,
              goalId: 'goal-1',
              reason: `${kind} is supported.`,
              supportingEvidence: [{ source: 'candidate', index: 0 }],
            },
          }),
        ),
      ).not.toThrow();
    }
  });

  it.each([
    {
      evidence: [{ source: 'candidate', index: -1 }],
      error: 'non-negative integer',
    },
    {
      evidence: [{ source: 'candidate', index: 0.5 }],
      error: 'non-negative integer',
    },
    {
      evidence: [{ source: 'candidate', index: 2 }],
      error: 'out of range',
    },
    {
      evidence: [{ source: 'afferent', index: 2 }],
      error: 'out of range',
    },
    {
      evidence: [
        { source: 'candidate', index: 0 },
        { source: 'candidate', index: 0 },
      ],
      error: 'must be unique',
    },
    {
      evidence: [{ source: 'afferent', index: 0 }],
      error: 'requires candidate evidence',
    },
  ] as const)('rejects invalid retained evidence', ({ evidence, error }) => {
    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          supportingEvidence: evidence,
        }),
      ),
    ).toThrow(error);
  });

  it('treats afferent evidence as out of range when no context was supplied', () => {
    expect(() =>
      validator.validate(
        props({ afferentContext: undefined }),
        unchangedResult({
          supportingEvidence: [
            { source: 'candidate', index: 0 },
            { source: 'afferent', index: 0 },
          ],
        }),
      ),
    ).toThrow('evidence index is out of range');
  });

  it('rejects duplicate, rewritten, invented, and unsupported actions', () => {
    expect(() =>
      validator.validate(
        props({
          broadcasts: [
            {
              role: 'node-response',
              originatingNodeId: 'memory-test',
              candidateId: 'candidate-test',
              content: 'A',
              actionRequests: [action],
            },
            {
              role: 'node-response',
              originatingNodeId: 'memory-test',
              candidateId: 'candidate-test',
              content: 'B',
              actionRequests: [action],
            },
          ],
        }),
        unchangedResult(),
      ),
    ).toThrow('duplicate source action ID request-1');

    for (const changedAction of [
      { ...action, targetNodeId: 'other-tool' },
      { ...action, intent: 'Read another file.' },
      { ...action, operation: 'other-operation' },
      { ...action, arguments: { path: 'other' } },
      { ...action, id: 'invented' },
    ]) {
      expect(() =>
        validator.validate(
          props(),
          unchangedResult({
            broadcast: {
              role: 'broadcast',
              content: 'Changed action.',
              actionRequests: [changedAction],
            },
          }),
        ),
      ).toThrow('was not preserved exactly');
    }

    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          supportingEvidence: [{ source: 'candidate', index: 1 }],
        }),
      ),
    ).toThrow('lacks candidate evidence');
  });

  it('rejects unsupported or malformed goal decisions', () => {
    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          goalDecision: { kind: 'unchanged', reason: ' ' },
        }),
      ),
    ).toThrow('unchanged goal decision requires a reason');

    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          goalDecision: proposedDecision({ supportingEvidence: [] }),
        }),
      ),
    ).toThrow('goal transition requires evidence');

    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          goalDecision: proposedDecision({
            supportingEvidence: [{ source: 'afferent', index: 1 }],
          }),
        }),
      ),
    ).toThrow('goal evidence must support the retained broadcast');

    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          supportingEvidence: [
            { source: 'candidate', index: 0 },
            { source: 'afferent', index: 0 },
          ],
          goalDecision: proposedDecision({ reason: ' ' }),
        }),
      ),
    ).toThrow('goal transition requires a reason');

    for (const overrides of [{ objective: ' ' }, { successCriteria: ' ' }]) {
      expect(() =>
        validator.validate(
          props(),
          unchangedResult({
            supportingEvidence: [
              { source: 'candidate', index: 0 },
              { source: 'afferent', index: 0 },
            ],
            goalDecision: proposedDecision(overrides),
          }),
        ),
      ).toThrow('requires objective and success criteria');
    }
  });

  it('enforces goal provenance and authoritative state', () => {
    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          goalDecision: proposedDecision({
            supportingEvidence: [{ source: 'candidate', index: 0 }],
          }),
        }),
      ),
    ).toThrow('user goal requires user-input evidence');

    expect(() =>
      validator.validate(
        props(),
        unchangedResult({
          supportingEvidence: [
            { source: 'candidate', index: 0 },
            { source: 'afferent', index: 1 },
          ],
          goalDecision: proposedDecision({
            origin: 'autonomous',
            supportingEvidence: [{ source: 'afferent', index: 1 }],
          }),
        }),
      ),
    ).toThrow('autonomous goal requires candidate evidence');

    expect(() =>
      validator.validate(
        props({ activeGoal }),
        unchangedResult({
          supportingEvidence: [
            { source: 'candidate', index: 0 },
            { source: 'afferent', index: 0 },
          ],
          goalDecision: proposedDecision(),
        }),
      ),
    ).toThrow('activate requires no active goal');

    expect(() =>
      validator.validate(
        props({ activeGoal }),
        unchangedResult({
          goalDecision: {
            id: 'complete',
            kind: 'complete',
            goalId: 'stale',
            reason: 'Done.',
            supportingEvidence: [{ source: 'candidate', index: 0 }],
          },
        }),
      ),
    ).toThrow('complete requires the active goal ID');
  });
});
