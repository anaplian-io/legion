import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Provider } from '../types/provider.js';
import type { RelevanceGate } from '../types/relevance-gate.js';
import { ConcreteEventStream } from '../stream/concrete-event-stream.js';
import { createTestTelemetry } from '../telemetry/test-context.fixture.js';
import { ConcreteMemoryNodeFactory } from '../factory/concrete-memory-node-factory.js';
import { AppendOnlyMemoryContextBuilder } from '../node/support/append-only-memory-context-builder.js';
import { DeduplicatingMemoryPromptBuilder } from '../node/support/deduplicating-memory-prompt-builder.js';
import { SessionLoader } from './session-loader.js';
import { SessionSaver } from './session-saver.js';
import { TEST_NODE_TELEMETRY } from '../telemetry/test-context.fixture.js';

describe('retained memory context persistence', () => {
  const directories: string[] = [];

  afterEach(() => {
    directories
      .splice(0)
      .forEach((directory) =>
        rmSync(directory, { recursive: true, force: true }),
      );
  });

  it('survives save/load, informs later calls, and still deduplicates', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'legion-context-'));
    directories.push(directory);
    const telemetry = createTestTelemetry();
    const eventStream = new ConcreteEventStream();
    const provider: Provider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      selectBest: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi
        .fn()
        .mockResolvedValueOnce({
          content: 'First response',
          toolCalls: undefined,
        })
        .mockResolvedValueOnce({
          content: 'Second response',
          toolCalls: undefined,
        }),
    };
    const relevanceGate: RelevanceGate = {
      isRelevant: vi.fn().mockResolvedValue(true),
    };
    const contextBuilder = new AppendOnlyMemoryContextBuilder();
    const promptBuilder = new DeduplicatingMemoryPromptBuilder();
    const factory = new ConcreteMemoryNodeFactory({
      provider,
      relevanceGate,
      contextBuilder,
      promptBuilder,
    });
    SessionSaver.watch({ eventStream, directory, telemetry });
    const node = factory.create({
      initialContext: 'Initial context',
      nodeId: 'memory-1',
      eventStream,
    });
    eventStream.publish({
      topicName: 'orchestrator/node-added',
      data: { addedNodes: [node] },
    });
    const evidence = {
      role: 'afferent' as const,
      content: 'Persisted tool result',
      originatingNodeId: 'tool-search',
      evidence: [{ id: 'call-1', contentHash: 'stable-result-hash' }],
    };

    const first = await node.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: { messages: [] },
      afferentContext: [evidence],
      broadcast: { role: 'broadcast', content: 'First broadcast' },
    });
    const pending = JSON.parse(
      readFileSync(path.join(directory, 'nodes', 'memory-1.json'), 'utf8'),
    ) as { readonly context: string };
    expect(pending.context).toBe('Initial context');
    expect(node.context).toBe('Initial context');

    node.resolveCandidate!(first!.candidateId!, 'selected');
    eventStream.publish({
      topicName: 'orchestrator/working-memory-updated',
      data: {
        workingMemory: { messages: [] },
        broadcast: { role: 'broadcast', content: 'Saved broadcast' },
      },
    });

    const saved = JSON.parse(
      readFileSync(path.join(directory, 'nodes', 'memory-1.json'), 'utf8'),
    ) as { readonly context: string };
    expect(saved.context).toBe(node.context);

    const loaded = SessionLoader.load({
      directory,
      eventStream,
      memoryNodeFactory: factory,
      telemetry,
    });
    const restored = loaded?.nodes[0];
    expect(restored?.context).toBe(node.context);
    expect(restored).toBeDefined();

    const second = await restored!.sendMessage({
      telemetry: TEST_NODE_TELEMETRY,
      workingMemory: loaded!.workingMemory,
      afferentContext: [
        {
          ...evidence,
          evidence: [{ id: 'call-2', contentHash: 'stable-result-hash' }],
        },
      ],
      broadcast: loaded!.broadcast,
    });
    restored!.resolveCandidate!(second!.candidateId!, 'selected');

    expect(restored!.context.match(/\[AFFERENT EVIDENCE v1/gu)).toHaveLength(1);
    const relevanceContext = vi
      .mocked(relevanceGate.isRelevant)
      .mock.calls.at(-1)?.[0].nodeContext;
    const generationContext = vi
      .mocked(provider.generateWithTools)
      .mock.calls.at(-1)?.[0].systemPrompt;
    expect(relevanceContext).toContain('Persisted tool result');
    expect(generationContext).toContain('Persisted tool result');
  });
});
