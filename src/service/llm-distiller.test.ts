import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmDistiller } from './llm-distiller.js';
import type { Provider } from '../types/provider.js';
import type { Message } from '../types/message.js';
import type { ToolCall } from '../types/tool.js';

const candidate = (content: string, nodeId?: string): Message => ({
  role: 'node-response',
  content,
  ...(nodeId === undefined ? {} : { originatingNodeId: nodeId }),
});

const synthesisCall = (argumentsValue: unknown): ToolCall => ({
  id: 'synthesis-1',
  type: 'function',
  function: {
    name: 'publish_synthesized_broadcast',
    arguments:
      typeof argumentsValue === 'string'
        ? argumentsValue
        : JSON.stringify(withSynthesisDefaults(argumentsValue)),
  },
});

const withSynthesisDefaults = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const partial = value as Readonly<Record<string, unknown>>;
  const actionIds = partial['includedActionRequestIds'];
  const scheduled = Array.isArray(actionIds) && actionIds.length > 0;
  return {
    supportingAfferentIndices: [],
    actionDisposition: scheduled ? 'scheduled' : 'none',
    actionSummary: scheduled ? 'Execute the selected action.' : '',
    goalDecision: {
      kind: 'unchanged',
      objective: '',
      successCriteria: '',
      origin: '',
      goalId: '',
      reason: 'No goal transition is supported.',
      supportingCandidateIndices: [],
      supportingAfferentIndices: [],
    },
    ...partial,
  };
};

const rawGoalDecision = (
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  kind: 'unchanged',
  objective: '',
  successCriteria: '',
  origin: '',
  goalId: '',
  reason: 'No goal transition is supported.',
  supportingCandidateIndices: [],
  supportingAfferentIndices: [],
  ...overrides,
});

describe('LlmDistiller', () => {
  let provider: Provider;

  beforeEach(() => {
    provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      generateWithTools: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
    };
  });

  it('returns undefined when no candidates survive', async () => {
    const distiller = new LlmDistiller({ provider });

    await expect(
      distiller.distill({ workingMemory: { messages: [] }, broadcasts: [] }),
    ).resolves.toBeUndefined();
    expect(provider.generateWithTools).not.toHaveBeenCalled();
  });

  it('requires an explicit goal decision even for a sole action-only candidate', async () => {
    const broadcast = {
      ...candidate('', 'memory-1'),
      actionRequests: [
        {
          id: 'request-1',
          targetNodeId: 'clock',
          operation: 'read',
          arguments: {},
        },
      ],
    };
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Read the clock.',
          contributingCandidateIndices: [0],
          includedActionRequestIds: ['request-1'],
        }),
      ],
    });
    const distiller = new LlmDistiller({ provider });

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [broadcast],
      }),
    ).resolves.toEqual({
      broadcast: {
        role: 'broadcast',
        content: 'Read the clock.',
        contributingNodeIds: ['memory-1'],
        actionRequests: broadcast.actionRequests,
      },
      supportingEvidence: [{ source: 'candidate', index: 0 }],
      goalDecision: {
        kind: 'unchanged',
        reason: 'No goal transition is supported.',
      },
    });
    expect(provider.generateWithTools).toHaveBeenCalledOnce();
  });

  it('synthesizes two candidates and copies original selected actions by ID', async () => {
    const originalRequest = {
      id: 'request-1',
      targetNodeId: 'tool-files',
      operation: 'list_directory',
      arguments: { path: '.' },
    };
    const broadcasts: Message[] = [
      candidate('The user wants a workspace summary.', 'memory-a'),
      {
        ...candidate('', 'memory-b'),
        actionRequests: [originalRequest],
      },
    ];
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Inspect the workspace, then summarize it for the user.',
          contributingCandidateIndices: [0, 1],
          includedActionRequestIds: ['request-1'],
          supportingAfferentIndices: [0],
        }),
      ],
    });
    const distiller = new LlmDistiller({ provider });

    await expect(
      distiller.distill({
        workingMemory: {
          messages: [
            {
              role: 'working-memory',
              content: '',
              actionRequests: [
                {
                  id: 'historical-request',
                  targetNodeId: 'clock',
                  operation: 'read',
                  arguments: {},
                },
              ],
            },
          ],
        },
        afferentContext: [
          {
            role: 'user-input',
            content: 'What is in the workspace?',
            originatingNodeId: 'sensor-user-input',
          },
        ],
        broadcasts,
      }),
    ).resolves.toEqual({
      broadcast: {
        role: 'broadcast',
        content: 'Inspect the workspace, then summarize it for the user.',
        contributingNodeIds: ['memory-a', 'memory-b'],
        actionRequests: [originalRequest],
      },
      supportingEvidence: [
        { source: 'candidate', index: 0 },
        { source: 'candidate', index: 1 },
        { source: 'afferent', index: 0 },
      ],
      goalDecision: {
        kind: 'unchanged',
        reason: 'No goal transition is supported.',
      },
    });

    expect(provider.generateWithTools).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining(
        "Never rewrite, invent, or copy an action's target",
      ),
      messages: [
        {
          role: 'node-response',
          content: expect.stringMatching(
            /historical-request[\s\S]*USER INPUT 0 from sensor-user-input[\s\S]*CANDIDATE 0 from memory-a[\s\S]*CANDIDATE 1 from memory-b[\s\S]*request-1/,
          ),
        },
      ],
      tools: [
        expect.objectContaining({ name: 'publish_synthesized_broadcast' }),
      ],
      toolChoice: 'required',
    });
  });

  it('deduplicates contributor node attribution', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Combined.',
          contributingCandidateIndices: [0, 1],
          includedActionRequestIds: [],
        }),
      ],
    });
    const distiller = new LlmDistiller({ provider });

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [candidate('A', 'same-node'), candidate('B', 'same-node')],
      }),
    ).resolves.toEqual({
      broadcast: {
        role: 'broadcast',
        content: 'Combined.',
        contributingNodeIds: ['same-node'],
      },
      supportingEvidence: [
        { source: 'candidate', index: 0 },
        { source: 'candidate', index: 1 },
      ],
      goalDecision: {
        kind: 'unchanged',
        reason: 'No goal transition is supported.',
      },
    });
  });

  it('omits node attribution when contributing candidates have no origin', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Combined.',
          contributingCandidateIndices: [0],
          includedActionRequestIds: [],
        }),
      ],
    });
    const distiller = new LlmDistiller({ provider });

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [candidate('A'), candidate('B')],
      }),
    ).resolves.toEqual({
      broadcast: { role: 'broadcast', content: 'Combined.' },
      supportingEvidence: [{ source: 'candidate', index: 0 }],
      goalDecision: {
        kind: 'unchanged',
        reason: 'No goal transition is supported.',
      },
    });
  });

  it.each([
    { toolCalls: undefined, error: 'expected exactly one' },
    { toolCalls: [], error: 'expected exactly one' },
    {
      toolCalls: [synthesisCall({}), synthesisCall({})],
      error: 'expected exactly one',
    },
    {
      toolCalls: [
        {
          ...synthesisCall({}),
          function: { name: 'other', arguments: '{}' },
        },
      ],
      error: 'unsupported tool other',
    },
  ])(
    'rejects an invalid synthesis call shape',
    async ({ toolCalls, error }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls,
      });
      const distiller = new LlmDistiller({ provider });

      await expect(
        distiller.distill({
          workingMemory: { messages: [] },
          broadcasts: [candidate('A'), candidate('B')],
        }),
      ).rejects.toThrow(error);
    },
  );

  it.each([
    { argumentsValue: '{bad', error: 'must be valid JSON' },
    { argumentsValue: [], error: 'must be an object' },
    {
      argumentsValue: {
        content: ' ',
        contributingCandidateIndices: [0],
        includedActionRequestIds: [],
      },
      error: 'content must not be empty',
    },
    {
      argumentsValue: {
        content: 'Result',
        contributingCandidateIndices: [],
        includedActionRequestIds: [],
      },
      error: 'indices must be unique and in range',
    },
    {
      argumentsValue: {
        content: 'Result',
        contributingCandidateIndices: [2],
        includedActionRequestIds: [],
      },
      error: 'indices must be unique and in range',
    },
    {
      argumentsValue: {
        content: 'Result',
        contributingCandidateIndices: [0, 0],
        includedActionRequestIds: [],
      },
      error: 'indices must be unique and in range',
    },
    {
      argumentsValue: {
        content: 'Result',
        contributingCandidateIndices: [0],
        includedActionRequestIds: [1],
      },
      error: 'IDs must be unique strings',
    },
    {
      argumentsValue: {
        content: 'Result',
        contributingCandidateIndices: [0],
        includedActionRequestIds: ['missing'],
      },
      error: 'unknown action request ID missing',
    },
  ])(
    'rejects malformed synthesis arguments',
    async ({ argumentsValue, error }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls: [synthesisCall(argumentsValue)],
      });
      const distiller = new LlmDistiller({ provider });

      await expect(
        distiller.distill({
          workingMemory: { messages: [] },
          broadcasts: [candidate('A'), candidate('B')],
        }),
      ).rejects.toThrow(error);
    },
  );

  it('rejects duplicate actions and actions from non-contributing candidates', async () => {
    const duplicate = {
      id: 'same-id',
      targetNodeId: 'clock',
      operation: 'read',
      arguments: {},
    };
    const distiller = new LlmDistiller({ provider });
    vi.mocked(provider.generateWithTools).mockResolvedValueOnce({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Result',
          contributingCandidateIndices: [0, 1],
          includedActionRequestIds: [],
        }),
      ],
    });

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [
          { ...candidate('A'), actionRequests: [duplicate] },
          { ...candidate('B'), actionRequests: [duplicate] },
        ],
      }),
    ).rejects.toThrow('duplicate action request ID same-id');

    vi.mocked(provider.generateWithTools).mockResolvedValueOnce({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Result',
          contributingCandidateIndices: [0],
          includedActionRequestIds: ['request-b'],
        }),
      ],
    });
    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [
          candidate('A'),
          {
            ...candidate('B'),
            actionRequests: [
              {
                id: 'request-b',
                targetNodeId: 'clock',
                operation: 'read',
                arguments: {},
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('came from a non-contributing candidate');
  });

  it('rejects supporting afferent indices that are not present this epoch', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Result',
          contributingCandidateIndices: [0],
          includedActionRequestIds: [],
          supportingAfferentIndices: [0],
        }),
      ],
    });

    await expect(
      new LlmDistiller({ provider }).distill({
        workingMemory: { messages: [] },
        broadcasts: [candidate('A'), candidate('B')],
      }),
    ).rejects.toThrow(
      'supporting afferent indices must be unique and in range',
    );
  });

  it('synthesizes a sole user-directed candidate into an evidence-backed goal', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Inspect the repository and report how it works.',
          contributingCandidateIndices: [0],
          includedActionRequestIds: [],
          supportingAfferentIndices: [0],
          goalDecision: rawGoalDecision({
            kind: 'activate',
            objective: 'Understand how the repository works',
            successCriteria:
              'Publish an evidence-backed architecture explanation',
            origin: 'user',
            reason: 'The request requires a sustained investigation.',
            supportingAfferentIndices: [0],
          }),
        }),
      ],
    });

    await expect(
      new LlmDistiller({ provider }).distill({
        workingMemory: { messages: [] },
        afferentContext: [
          {
            role: 'user-input',
            content: 'Inspect this repository and explain how it works.',
          },
        ],
        broadcasts: [candidate('Start by reading the README.', 'memory-a')],
      }),
    ).resolves.toEqual({
      broadcast: {
        role: 'broadcast',
        content: 'Inspect the repository and report how it works.',
        contributingNodeIds: ['memory-a'],
      },
      supportingEvidence: [
        { source: 'candidate', index: 0 },
        { source: 'afferent', index: 0 },
      ],
      goalDecision: {
        id: 'synthesis-1:goal',
        kind: 'activate',
        objective: 'Understand how the repository works',
        successCriteria: 'Publish an evidence-backed architecture explanation',
        origin: 'user',
        reason: 'The request requires a sustained investigation.',
        supportingEvidence: [{ source: 'afferent', index: 0 }],
      },
    });
    expect(provider.generateWithTools).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'Authoritative goal state:\nnone',
        ),
      }),
    );
  });

  it('can activate an autonomous goal from a sole cognitive candidate', async () => {
    vi.mocked(provider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        synthesisCall({
          content: 'Investigate the unresolved inconsistency.',
          contributingCandidateIndices: [0],
          includedActionRequestIds: [],
          goalDecision: rawGoalDecision({
            kind: 'activate',
            objective: 'Resolve the detected inconsistency',
            successCriteria: 'Identify its cause and publish a supported fix',
            origin: 'autonomous',
            reason:
              'The cognitive response identified a bounded unresolved problem.',
            supportingCandidateIndices: [0],
          }),
        }),
      ],
    });

    await expect(
      new LlmDistiller({ provider }).distill({
        workingMemory: { messages: [] },
        broadcasts: [
          candidate(
            'A configuration inconsistency needs investigation.',
            'memory-a',
          ),
        ],
      }),
    ).resolves.toEqual({
      broadcast: {
        role: 'broadcast',
        content: 'Investigate the unresolved inconsistency.',
        contributingNodeIds: ['memory-a'],
      },
      supportingEvidence: [{ source: 'candidate', index: 0 }],
      goalDecision: {
        id: 'synthesis-1:goal',
        kind: 'activate',
        objective: 'Resolve the detected inconsistency',
        successCriteria: 'Identify its cause and publish a supported fix',
        origin: 'autonomous',
        reason:
          'The cognitive response identified a bounded unresolved problem.',
        supportingEvidence: [{ source: 'candidate', index: 0 }],
      },
    });
  });

  it.each(['revise', 'supersede', 'complete', 'abandon'] as const)(
    'supports a %s decision for the exact active goal',
    async (kind) => {
      const definition =
        kind === 'revise' || kind === 'supersede'
          ? {
              objective: 'Refined objective',
              successCriteria: 'Publish the refined result',
              origin: 'autonomous',
            }
          : {};
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls: [
          synthesisCall({
            content: `Goal decision: ${kind}.`,
            contributingCandidateIndices: [0],
            includedActionRequestIds: [],
            goalDecision: rawGoalDecision({
              kind,
              goalId: 'goal-1',
              reason: `${kind} is supported by the candidate.`,
              supportingCandidateIndices: [0],
              ...definition,
            }),
          }),
        ],
      });

      const result = await new LlmDistiller({ provider }).distill({
        workingMemory: { messages: [] },
        broadcasts: [candidate('Supported goal evidence.')],
        activeGoal: {
          id: 'goal-1',
          objective: 'Original objective',
          successCriteria: 'Publish a result',
          origin: 'autonomous',
          revision: 1,
        },
      });

      expect(result?.goalDecision.kind).toBe(kind);
      expect(provider.generateWithTools).toHaveBeenLastCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('ID: goal-1'),
        }),
      );
    },
  );

  it.each([
    {
      overrides: { actionDisposition: 'later' },
      error: 'action disposition must be scheduled or none',
    },
    {
      overrides: { actionSummary: 1 },
      error: 'action summary must be a string',
    },
    {
      overrides: { actionDisposition: 'scheduled' },
      error: 'scheduled action requires an action ID and summary',
    },
    {
      overrides: {
        actionDisposition: 'scheduled',
        includedActionRequestIds: [],
        actionSummary: 'Run it.',
      },
      error: 'scheduled action requires an action ID and summary',
    },
    {
      overrides: { actionDisposition: 'none', actionSummary: 'Run it.' },
      error: 'no-action disposition cannot include actions or a summary',
    },
  ])(
    'rejects inconsistent action declarations',
    async ({ overrides, error }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls: [
          synthesisCall({
            content: 'Result',
            contributingCandidateIndices: [0, 1],
            includedActionRequestIds: [],
            ...overrides,
          }),
        ],
      });

      await expect(
        new LlmDistiller({ provider }).distill({
          workingMemory: { messages: [] },
          broadcasts: [candidate('A'), candidate('B')],
        }),
      ).rejects.toThrow(error);
    },
  );

  it.each([
    {
      goalDecision: null,
      error: 'goal decision must be an object',
    },
    {
      goalDecision: rawGoalDecision({ reason: '' }),
      error: 'requires a non-empty reason',
    },
    {
      goalDecision: rawGoalDecision({ kind: 'pause' }),
      error: 'unsupported goal decision pause',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: 'Goal',
        successCriteria: 'Done',
        origin: 'autonomous',
        reason: 'Supported.',
        supportingCandidateIndices: [1],
      }),
      error: 'must reference contributing candidates',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: 'Goal',
        successCriteria: 'Done',
        origin: 'user',
        reason: 'Supported.',
        supportingAfferentIndices: [2],
      }),
      error: 'goal afferent evidence must be unique and in range',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: 'Goal',
        successCriteria: 'Done',
        origin: 'autonomous',
        reason: 'Unsupported.',
      }),
      error: 'goal transition requires evidence',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: '',
        successCriteria: 'Done',
        origin: 'autonomous',
        reason: 'Supported.',
        supportingCandidateIndices: [0],
      }),
      error: 'requires a non-empty objective',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: 'Goal',
        successCriteria: '',
        origin: 'autonomous',
        reason: 'Supported.',
        supportingCandidateIndices: [0],
      }),
      error: 'requires a non-empty successCriteria',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: 'Goal',
        successCriteria: 'Done',
        origin: 'external',
        reason: 'Supported.',
        supportingCandidateIndices: [0],
      }),
      error: 'origin must be user or autonomous',
    },
    {
      goalDecision: rawGoalDecision({
        kind: 'activate',
        objective: 'Goal',
        successCriteria: 'Done',
        origin: 'user',
        reason: 'Supported.',
        supportingCandidateIndices: [0],
      }),
      error: 'user-origin goal requires current user-input evidence',
    },
  ])(
    'rejects malformed or unsupported goal decisions',
    async ({ goalDecision, error }) => {
      vi.mocked(provider.generateWithTools).mockResolvedValue({
        content: '',
        toolCalls: [
          synthesisCall({
            content: 'Result',
            contributingCandidateIndices: [0],
            includedActionRequestIds: [],
            goalDecision,
          }),
        ],
      });

      await expect(
        new LlmDistiller({ provider }).distill({
          workingMemory: { messages: [] },
          broadcasts: [candidate('A'), candidate('B')],
          afferentContext: [{ role: 'afferent', content: 'Observation' }],
        }),
      ).rejects.toThrow(error);
    },
  );

  it('rejects autonomous goals without cognitive evidence and stale transitions', async () => {
    vi.mocked(provider.generateWithTools)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          synthesisCall({
            content: 'Result',
            contributingCandidateIndices: [0],
            includedActionRequestIds: [],
            supportingAfferentIndices: [0],
            goalDecision: rawGoalDecision({
              kind: 'activate',
              objective: 'Goal',
              successCriteria: 'Done',
              origin: 'autonomous',
              reason: 'Unsupported.',
              supportingAfferentIndices: [0],
            }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          synthesisCall({
            content: 'Result',
            contributingCandidateIndices: [0],
            includedActionRequestIds: [],
            goalDecision: rawGoalDecision({
              kind: 'revise',
              goalId: 'stale',
              objective: 'Goal',
              successCriteria: 'Done',
              origin: 'autonomous',
              reason: 'Stale.',
              supportingCandidateIndices: [0],
            }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          synthesisCall({
            content: 'Result',
            contributingCandidateIndices: [0],
            includedActionRequestIds: [],
            goalDecision: rawGoalDecision({
              kind: 'complete',
              goalId: 'stale',
              reason: 'Stale.',
              supportingCandidateIndices: [0],
            }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          synthesisCall({
            content: 'Result',
            contributingCandidateIndices: [0],
            includedActionRequestIds: [],
            goalDecision: rawGoalDecision({
              kind: 'activate',
              objective: 'Other goal',
              successCriteria: 'Done',
              origin: 'autonomous',
              reason: 'Conflicts.',
              supportingCandidateIndices: [0],
            }),
          }),
        ],
      });
    const distiller = new LlmDistiller({ provider });
    const base = {
      workingMemory: { messages: [] },
      broadcasts: [candidate('A'), candidate('B')],
    };

    await expect(
      distiller.distill({
        ...base,
        afferentContext: [{ role: 'afferent', content: 'Observation' }],
      }),
    ).rejects.toThrow('autonomous goal requires cognitive candidate evidence');

    const withActiveGoal = {
      ...base,
      activeGoal: {
        id: 'goal-1',
        objective: 'Existing',
        successCriteria: 'Done',
        origin: 'autonomous' as const,
        revision: 1,
      },
    };
    await expect(distiller.distill(withActiveGoal)).rejects.toThrow(
      'revise requires the exact active goal ID',
    );
    await expect(distiller.distill(withActiveGoal)).rejects.toThrow(
      'complete requires the exact active goal ID',
    );
    await expect(distiller.distill(withActiveGoal)).rejects.toThrow(
      'cannot activate a new goal while one is active',
    );
  });
});
