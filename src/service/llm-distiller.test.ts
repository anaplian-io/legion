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
        : JSON.stringify(argumentsValue),
  },
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

  it('returns a sole candidate unchanged, including action-only candidates', async () => {
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
    const distiller = new LlmDistiller({ provider });

    await expect(
      distiller.distill({
        workingMemory: { messages: [] },
        broadcasts: [broadcast],
      }),
    ).resolves.toBe(broadcast);
    expect(provider.generateWithTools).not.toHaveBeenCalled();
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
      role: 'broadcast',
      content: 'Inspect the workspace, then summarize it for the user.',
      contributingNodeIds: ['memory-a', 'memory-b'],
      actionRequests: [originalRequest],
    });

    expect(provider.generateWithTools).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining(
        'Never rewrite, invent, or copy its target',
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
      role: 'broadcast',
      content: 'Combined.',
      contributingNodeIds: ['same-node'],
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
    ).resolves.toEqual({ role: 'broadcast', content: 'Combined.' });
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
});
