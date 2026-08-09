import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryNode } from './memory-node.js';
import type { Provider } from '../types/provider.js';
import type { BroadcastMessage } from '../types/node.js';
import { TEST_NODE_TELEMETRY } from '../telemetry/test-context.fixture.js';
import { ConcreteEventStream } from '../stream/concrete-event-stream.js';
import type { RelevanceGate } from '../types/relevance-gate.js';
import { AppendOnlyMemoryContextBuilder } from './support/append-only-memory-context-builder.js';
import { DeduplicatingMemoryPromptBuilder } from './support/deduplicating-memory-prompt-builder.js';

describe('MemoryNode', () => {
  let mockProvider: Provider;
  let eventStream: ConcreteEventStream;
  let mockRelevanceGate: RelevanceGate;
  let contextBuilder: AppendOnlyMemoryContextBuilder;
  let promptBuilder: DeduplicatingMemoryPromptBuilder;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi
        .fn()
        .mockResolvedValue({ content: '', toolCalls: undefined }),
    };
    eventStream = new ConcreteEventStream();
    mockRelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(true),
    };
    contextBuilder = new AppendOnlyMemoryContextBuilder();
    promptBuilder = new DeduplicatingMemoryPromptBuilder();
  });

  it('should create a memory node with the given props', () => {
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    expect(node.id).toBe('memory-1');
    expect(node.kind).toBe('memory');
    expect(node.context).toBe('Initial context');
    expect(node.status).toBe('idle');
  });

  it('should return undefined if memory is not relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: {
        messages: [
          { role: 'working-memory' as const, content: 'Previous message' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      messages: [
        { role: 'working-memory', content: 'Previous message' },
        { role: 'broadcast', content: 'New broadcast' },
      ],
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });
    expect(mockProvider.generateWithTools).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(node.status).toBe('idle');
  });

  it('should generate response when memory is relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: {
        messages: [
          { role: 'working-memory', content: 'Previous message 1' },
          { role: 'working-memory', content: 'Previous message 2' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    mockGeneration('Generated response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      messages: [
        { role: 'working-memory', content: 'Previous message 1' },
        { role: 'working-memory', content: 'Previous message 2' },
        { role: 'broadcast', content: 'New broadcast' },
      ],
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });

    expect(mockProvider.generateWithTools).toHaveBeenCalledWith(
      {
        systemPrompt: expect.stringContaining('Initial context'),
        messages: [
          { role: 'working-memory', content: 'Previous message 1' },
          { role: 'working-memory', content: 'Previous message 2' },
          { role: 'broadcast', content: 'New broadcast' },
        ],
        tools: [expect.objectContaining({ name: 'request_node_action' })],
        toolChoice: 'auto',
      },
      { stage: 'node-generation', ...TEST_NODE_TELEMETRY },
    );

    expect(result).toEqual({
      role: 'node-response',
      originatingNodeId: 'memory-1',
      content: 'Generated response',
      candidateId: TEST_NODE_TELEMETRY.candidateId,
      inputIds: [],
    });
    expect(node.context).toBe('Initial context');
    expect(node.status).toBe('idle');
  });

  it('keeps generated experience pending and discards a rejected candidate', async () => {
    const phases: string[] = [];
    eventStream.subscribe({
      topicName: 'orchestrator/node-updated',
      receiver: ({ phase }) => {
        phases.push(phase);
      },
    });
    mockGeneration('Rejected response');
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    const result = await node.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast', content: 'New broadcast' },
    });
    expect(node.context).toBe('Initial context');

    node.resolveCandidate(result!.candidateId!, 'rejected');

    expect(node.context).toBe('Initial context');
    expect(phases).toEqual(['candidate-pending', 'candidate-rejected']);
  });

  it('bounds pending experience and validates candidate resolution', async () => {
    mockGeneration('Pending response');
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });
    const message: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast', content: 'New broadcast' },
    };
    const result = await node.sendMessage(message);

    await expect(node.sendMessage(message)).rejects.toThrow(
      'candidate candidate-test is still awaiting resolution',
    );
    expect(() => node.resolveCandidate('other-candidate', 'rejected')).toThrow(
      'cannot resolve candidate other-candidate; candidate-test is pending',
    );

    node.resolveCandidate(result!.candidateId!, 'rejected');

    expect(() =>
      node.resolveCandidate(result!.candidateId!, 'selected'),
    ).toThrow('candidate candidate-test is not pending');
  });

  it('should generate response when relevance gate returns true', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(true);
    mockGeneration('Curious response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      messages: [{ role: 'broadcast', content: 'New broadcast' }],
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });
    expect(mockProvider.askYesNoQuestion).not.toHaveBeenCalled();
    expect(result).toEqual({
      role: 'node-response',
      originatingNodeId: 'memory-1',
      content: 'Curious response',
      candidateId: TEST_NODE_TELEMETRY.candidateId,
      inputIds: [],
    });
  });

  it('should pass preamble to relevance gate', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Specialized in test scenarios',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage(broadcastMessage);

    const relevanceCall = vi.mocked(mockRelevanceGate.isRelevant).mock
      .calls[0]?.[0];
    expect(relevanceCall).toBeDefined();
    expect(relevanceCall?.nodeContext).toContain(
      'You are one specialist node in a collective reasoning system',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'mind your own business, stay curious about the environment',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'role user-input, treat it as an interruption worth acknowledging',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'Specialized in test scenarios',
    );
  });

  it('should pass broadcast message to relevance gate', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: {
        messages: [
          { role: 'working-memory', content: 'First WM' },
          { role: 'working-memory', content: 'Second WM' },
        ],
      },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage(broadcastMessage);

    expect(mockRelevanceGate.isRelevant).toHaveBeenCalledWith({
      broadcastMessage,
      messages: [
        { role: 'working-memory', content: 'First WM' },
        { role: 'working-memory', content: 'Second WM' },
        { role: 'broadcast', content: 'New broadcast' },
      ],
      nodeId: 'memory-1',
      epochsAlive: 0,
      nodeContext: expect.stringContaining('Initial context'),
    });
  });

  it('should frame afferent capabilities as available system capabilities', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: {
        messages: [
          {
            role: 'working-memory',
            content:
              'what will the weather be in Brooklyn, NY for the next few days? what should I wear? any interesting events I should know about nearby?',
          },
          {
            role: 'working-memory',
            content:
              'Need specific date range from user to provide tailored weather/event advice for Brooklyn, NY.',
          },
        ],
      },
      afferentContext: [
        {
          role: 'afferent-capability',
          content:
            'Available afferent capabilities:\n- ddg-search: can search the web for current/local information, forecasts, events, and linked sources.',
        },
      ],
      broadcast: {
        role: 'broadcast',
        content:
          'Need specific date range from user to provide tailored weather/event advice for Brooklyn, NY.',
      },
    };

    mockGeneration(
      'Search the web for Brooklyn NY weather next few days and nearby events.',
    );

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage(broadcastMessage);

    const relevanceCall = vi.mocked(mockRelevanceGate.isRelevant).mock
      .calls[0]?.[0];
    expect(relevanceCall?.nodeContext).toContain(
      'available afferent capabilities',
    );
    expect(relevanceCall?.nodeContext).toContain(
      'use the request_node_action tool',
    );
    expect(relevanceCall?.broadcastMessage).toEqual(broadcastMessage);

    expect(mockProvider.generateWithTools).toHaveBeenCalledWith(
      {
        systemPrompt: expect.stringContaining(
          'available afferent capabilities',
        ),
        messages: expect.arrayContaining([
          {
            role: 'afferent-capability',
            content:
              'Available afferent capabilities:\n- ddg-search: can search the web for current/local information, forecasts, events, and linked sources.',
          },
        ]),
        tools: [expect.objectContaining({ name: 'request_node_action' })],
        toolChoice: 'auto',
      },
      { stage: 'node-generation', ...TEST_NODE_TELEMETRY },
    );
  });

  it('should handle empty working memory', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    mockGeneration('Response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage(broadcastMessage);

    expect(mockProvider.generateWithTools).toHaveBeenCalledWith(
      {
        messages: [{ role: 'broadcast', content: 'New broadcast' }],
        systemPrompt: expect.any(String),
        tools: [expect.objectContaining({ name: 'request_node_action' })],
        toolChoice: 'auto',
      },
      { stage: 'node-generation', ...TEST_NODE_TELEMETRY },
    );
  });

  it('should preserve id and kind after creation', () => {
    const node = new MemoryNode({
      id: 'test-id',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    expect(node.id).toBe('test-id');
    expect(node.kind).toBe('memory');
    expect(node.status).toBe('idle');
  });

  it('should return undefined when relevant check returns false', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: {
        messages: [{ role: 'working-memory' as const, content: 'test' }],
      },
      broadcast: { role: 'broadcast' as const, content: 'new' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);
    mockGeneration('Should not be called');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    expect(node.status).toBe('idle');

    const result = await node.sendMessage(broadcastMessage);

    expect(result).toBeUndefined();
    expect(mockProvider.generateWithTools).not.toHaveBeenCalled();
    expect(node.status).toBe('idle');
  });

  it('should publish status change events on status change', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    mockGeneration('Response');

    const statusEvents: Array<{ nodeId: string; status: string }> = [];
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: (data) => {
        statusEvents.push(data);
      },
    });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage(broadcastMessage);

    expect(statusEvents).toHaveLength(4);
    expect(statusEvents[0]).toEqual({
      nodeId: 'memory-1',
      status: 'evaluating-relevance',
    });
    expect(statusEvents[1]).toEqual({ nodeId: 'memory-1', status: 'idle' });
    expect(statusEvents[2]).toEqual({
      nodeId: 'memory-1',
      status: 'generating',
    });
    expect(statusEvents[3]).toEqual({ nodeId: 'memory-1', status: 'idle' });
  });

  it('should handle async status event subscriber', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const asyncSubscriber = vi.fn().mockResolvedValue(undefined);
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: asyncSubscriber,
    });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage(broadcastMessage);

    expect(asyncSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'evaluating-relevance',
    });
    expect(asyncSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'idle',
    });
  });

  it('should not throw if status event subscriber throws', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);

    const errorSubscriber = vi.fn().mockImplementation(() => {
      throw new Error('Subscriber failed');
    });
    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: errorSubscriber,
    });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
    expect(errorSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'evaluating-relevance',
    });
    expect(errorSubscriber).toHaveBeenCalledWith({
      nodeId: 'memory-1',
      status: 'idle',
    });
  });

  it('should handle publish throwing error gracefully', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    vi.mocked(mockRelevanceGate.isRelevant).mockResolvedValue(false);
    mockGeneration('Response');

    // Replace eventStream with one that throws on publish
    const throwingEventStream = {
      publish: () => {
        throw new Error('Publish failed');
      },
      subscribe: () => {},
    } as unknown as ConcreteEventStream;

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream: throwingEventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await expect(node.sendMessage(broadcastMessage)).resolves.toBeUndefined();
  });

  it('should update context with broadcast and response when relevant', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'New broadcast' },
    };

    mockGeneration('Node response');

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(node.context).toBe('Initial context');
    node.resolveCandidate(result!.candidateId!, 'selected');

    expect(node.context).toBe(
      'Initial context\n\n[BROADCAST MESSAGE]:New broadcast\n[NODE RESPONSE]:Node response',
    );
    expect(node.status).toBe('idle');
  });

  it('appends substantive afferent evidence before the turn and publishes the complete update', async () => {
    const updatedContexts: string[] = [];
    const updatePhases: string[] = [];
    eventStream.subscribe({
      topicName: 'orchestrator/node-updated',
      receiver: ({ node, phase }) => {
        updatedContexts.push(node.context);
        updatePhases.push(phase);
      },
    });
    mockGeneration('Grounded response');
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    const result = await node.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      afferentContext: [
        {
          role: 'afferent-capability',
          content: 'tool-search can search',
        },
        {
          role: 'afferent',
          content: 'Successful tool result',
          originatingNodeId: 'tool-search',
          evidence: [
            {
              id: 'tool-result:call-1',
              contentHash: 'result-hash',
              sourceUrls: ['https://example.com/result'],
            },
          ],
          candidateId: 'ephemeral-candidate',
        },
        {
          role: 'afferent',
          content: '[{"success":false,"error":"offline"}]',
          originatingNodeId: 'tool-search',
        },
        {
          role: 'user-input',
          content: 'Please use the result.',
          originatingNodeId: 'sensor-user-input',
          inputIds: ['input-1'],
        },
      ],
      broadcast: { role: 'broadcast', content: 'Investigate' },
    });

    expect(node.context).toBe('Initial context');
    node.resolveCandidate(result!.candidateId!, 'selected');

    expect(node.context.startsWith('Initial context')).toBe(true);
    expect(node.context).toContain('Successful tool result');
    expect(node.context).toContain('"originatingNodeId":"tool-search"');
    expect(node.context).toContain('"contentHash":"result-hash"');
    expect(node.context).toContain('offline');
    expect(node.context).toContain('Please use the result.');
    expect(node.context).not.toContain('tool-search can search');
    expect(node.context).not.toContain('ephemeral-candidate');
    expect(node.context.indexOf('Successful tool result')).toBeLessThan(
      node.context.indexOf('[BROADCAST MESSAGE]:Investigate'),
    );
    expect(updatedContexts).toEqual(['Initial context', node.context]);
    expect(updatePhases).toEqual(['candidate-pending', 'experience-committed']);
  });

  it('shares one ordered prompt-message array between relevance and generation', async () => {
    mockGeneration('Response');
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await node.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: {
        messages: [{ role: 'working-memory', content: 'Prior state' }],
      },
      afferentContext: [{ role: 'afferent', content: 'Current evidence' }],
      broadcast: { role: 'broadcast', content: 'Current broadcast' },
    });

    const relevanceMessages = vi.mocked(mockRelevanceGate.isRelevant).mock
      .calls[0]?.[0].messages;
    const generationMessages = vi.mocked(mockProvider.generateWithTools).mock
      .calls[0]?.[0].messages;
    expect(generationMessages).toBe(relevanceMessages);
    expect(generationMessages).toEqual([
      { role: 'working-memory', content: 'Prior state' },
      { role: 'afferent', content: 'Current evidence' },
      { role: 'broadcast', content: 'Current broadcast' },
    ]);
  });

  it('attaches valid structured action requests to its response and context', async () => {
    const broadcastMessage: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast', content: 'Inspect the workspace.' },
    };
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: '',
      toolCalls: [
        {
          id: 'request-1',
          type: 'function',
          function: {
            name: 'request_node_action',
            arguments: JSON.stringify({
              targetNodeId: 'tool-files',
              intent: 'List the workspace directory.',
              operation: 'list_directory',
              arguments: { path: '.' },
            }),
          },
        },
      ],
    });
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    const result = await node.sendMessage(broadcastMessage);

    expect(result?.actionRequests).toEqual([
      {
        id: 'request-1',
        targetNodeId: 'tool-files',
        intent: 'List the workspace directory.',
        operation: 'list_directory',
        arguments: { path: '.' },
      },
    ]);
    expect(node.context).toBe('Initial context');
    node.resolveCandidate(result!.candidateId!, 'selected');
    expect(node.context).toContain(
      '[ACTION REQUEST request-1] target=tool-files intent="List the workspace directory." operationHint=list_directory',
    );
  });

  it('does not emit or remember an empty response without a valid action', async () => {
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content: ' ',
      toolCalls: [
        {
          id: 'invalid-request',
          type: 'function',
          function: {
            name: 'request_node_action',
            arguments: '{bad',
          },
        },
      ],
    });
    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    await expect(
      node.sendMessage({
        telemetry: TEST_NODE_TELEMETRY,
        workingMemory: { messages: [] },
        broadcast: { role: 'broadcast', content: 'Think.' },
      }),
    ).resolves.toBeUndefined();
    expect(node.context).toBe('Initial context');
    expect(node.status).toBe('idle');
  });

  it('should accumulate context across multiple sendMessage calls', async () => {
    const broadcastMessage1: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'First broadcast' },
    };

    const broadcastMessage2: BroadcastMessage = {
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      broadcast: { role: 'broadcast' as const, content: 'Second broadcast' },
    };

    vi.mocked(mockProvider.generateWithTools)
      .mockResolvedValueOnce({
        content: 'First response',
        toolCalls: undefined,
      })
      .mockResolvedValueOnce({
        content: 'Second response',
        toolCalls: undefined,
      });

    const node = new MemoryNode({
      id: 'memory-1',
      initialContext: 'Initial context',
      provider: mockProvider,
      eventStream,
      relevanceGate: mockRelevanceGate,
      contextBuilder,
      promptBuilder,
    });

    const first = await node.sendMessage(broadcastMessage1);
    node.resolveCandidate(first!.candidateId!, 'selected');
    const second = await node.sendMessage(broadcastMessage2);
    node.resolveCandidate(second!.candidateId!, 'selected');

    expect(node.context).toBe(
      'Initial context\n\n[BROADCAST MESSAGE]:First broadcast\n[NODE RESPONSE]:First response\n\n[BROADCAST MESSAGE]:Second broadcast\n[NODE RESPONSE]:Second response',
    );
    expect(node.status).toBe('idle');
  });

  function mockGeneration(content: string): void {
    vi.mocked(mockProvider.generateWithTools).mockResolvedValue({
      content,
      toolCalls: undefined,
    });
  }
});
