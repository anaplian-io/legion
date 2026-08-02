import { describe, expect, it, vi } from 'vitest';
import type { Distiller } from '../types/distiller.js';
import type { Node } from '../types/node.js';
import type { NodePruner } from '../types/node-pruner.js';
import type { Provider } from '../types/provider.js';
import type { RelevanceFilter } from '../types/relevance-filter.js';
import type { TelemetryClock, TelemetryEvent } from '../types/telemetry.js';
import { ConcreteEventStream } from '../stream/concrete-event-stream.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import { extractEpochSummaries } from '../telemetry/benchmark-extractor.js';
import { UserInputSensor } from '../sensor/user-input-sensor.js';
import { SensoryNode } from '../node/sensory-node.js';
import { EpochOrchestrator } from './epoch-orchestrator.js';

const telemetryFixture = () => {
  let monotonic = 0;
  let id = 0;
  const clock: TelemetryClock = {
    wallNow: () => new Date('2026-08-02T00:00:00.000Z'),
    monotonicNow: () => monotonic++,
  };
  const telemetry = new TelemetryRecorder({
    runId: 'run-1',
    clock,
    idFactory: { create: (kind) => `${kind}-${++id}` },
  });
  const events: TelemetryEvent[] = [];
  telemetry.subscribe((event) => events.push(event));
  return { telemetry, events };
};

describe('EpochOrchestrator telemetry', () => {
  it('emits a complete correlated candidate lifecycle and derivable summary', async () => {
    const { telemetry, events } = telemetryFixture();
    const afferent = {
      ...node('sensor-1', 'sensory', async () => ({
        role: 'afferent',
        content: 'Observed evidence.',
        evidence: [{ id: 'evidence-1', contentHash: 'hash-1' }],
      })),
      capabilityDescription: 'can observe test evidence.',
    };
    const first = node('memory-1', 'memory', async () => ({
      role: 'node-response',
      content: 'Search first.',
      inputIds: ['input-from-response'],
    }));
    const second = node('memory-2', 'memory', async () => ({
      role: 'node-response',
      content: 'Answer now.',
    }));
    const relevanceFilter: RelevanceFilter = {
      filter: vi.fn(async (_workingMemory, candidates) => candidates),
    };
    const distiller: Distiller = {
      distill: vi.fn(async () => ({
        broadcast: { role: 'broadcast' as const, content: 'Search first.' },
        supportingEvidence: [
          { source: 'candidate' as const, index: 0 },
          { source: 'afferent' as const, index: 0 },
          { source: 'afferent' as const, index: 1 },
        ],
        goalDecision: {
          kind: 'unchanged' as const,
          reason: 'No goal change.',
        },
      })),
    };
    const orchestrator = makeOrchestrator({
      telemetry,
      nodes: [afferent, first, second],
      relevanceFilter,
      distiller,
    });

    await orchestrator.runEpoch();

    const generated = events.filter(
      (event) => event.event === 'candidate.generated',
    );
    expect(generated).toHaveLength(3);
    expect(
      generated.every(
        (event) =>
          event.epochId !== undefined &&
          event.candidateId !== undefined &&
          event.nodeId !== undefined &&
          event.data.contentHash.length === 64,
      ),
    ).toBe(true);
    expect(generated[0]).toMatchObject({
      data: { evidence: [{ id: 'evidence-1', contentHash: 'hash-1' }] },
    });
    expect(
      events.filter((event) => event.event === 'candidate.outcome'),
    ).toHaveLength(3);
    expect(extractEpochSummaries(events)[0]).toMatchObject({
      status: 'success',
      counts: { generated: 3, attentionPassed: 3, selected: 1 },
      waveCounts: {
        afferent: { generated: 1, attentionPassed: 1, selected: 0 },
        cognitive: { generated: 2, attentionPassed: 2, selected: 1 },
      },
    });
  });

  it('correlates user-input receipt, consumption, and selected broadcast', async () => {
    const { telemetry, events } = telemetryFixture();
    const eventStream = new ConcreteEventStream();
    const userInputSensor = new UserInputSensor();
    const userNode = new SensoryNode({
      id: 'sensor-user-input',
      provider: provider(),
      eventStream,
      sensor: userInputSensor,
      capabilityDescription: 'queued user input',
      responseRole: 'user-input',
    });
    const memory = node('memory-1', 'memory', async () => ({
      role: 'node-response',
      content: 'I will help.',
    }));
    const orchestrator = makeOrchestrator({
      telemetry,
      eventStream,
      nodes: [userNode, memory],
      userInputSensor,
      relevanceFilter: {
        filter: vi.fn(async (_workingMemory, candidates) => candidates),
      },
      distiller: {
        distill: vi.fn(async () => ({
          broadcast: { role: 'broadcast' as const, content: 'Acknowledged.' },
          supportingEvidence: [{ source: 'candidate' as const, index: 0 }],
          goalDecision: {
            kind: 'unchanged' as const,
            reason: 'No goal change.',
          },
        })),
      },
    });

    orchestrator.receiveUserInput('  Hello  ');
    await orchestrator.runEpoch();

    const milestones = events.filter((event) =>
      event.event.startsWith('user-input.'),
    );
    expect(milestones.map(({ event }) => event)).toEqual([
      'user-input.received',
      'user-input.consumed',
      'user-input.broadcast-selected',
    ]);
    const inputIds = milestones.map((event) => {
      if (
        event.event !== 'user-input.received' &&
        event.event !== 'user-input.consumed' &&
        event.event !== 'user-input.broadcast-selected'
      ) {
        throw new Error('Expected a user-input milestone.');
      }
      return event.data.inputId;
    });
    expect(new Set(inputIds).size).toBe(1);
    expect(milestones[1]?.epochId).toBeDefined();
    expect(milestones[2]).toMatchObject({
      data: { broadcastHash: expect.any(String) },
    });
  });

  it('keeps consumed input pending until a later epoch selects a broadcast', async () => {
    const { telemetry, events } = telemetryFixture();
    const eventStream = new ConcreteEventStream();
    const userInputSensor = new UserInputSensor();
    const userNode = new SensoryNode({
      id: 'sensor-user-input',
      provider: provider(),
      eventStream,
      sensor: userInputSensor,
      capabilityDescription: 'queued user input',
      responseRole: 'user-input',
    });
    const memory = node('memory-1', 'memory', async () => ({
      role: 'node-response',
      content: 'I can answer.',
    }));
    const relevanceFilter: RelevanceFilter = {
      filter: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementation(async (_workingMemory, candidates) => candidates),
    };
    const orchestrator = makeOrchestrator({
      telemetry,
      eventStream,
      nodes: [userNode, memory],
      userInputSensor,
      relevanceFilter,
      distiller: {
        distill: vi.fn(async () => ({
          broadcast: { role: 'broadcast' as const, content: 'Answered.' },
          supportingEvidence: [{ source: 'candidate' as const, index: 0 }],
          goalDecision: {
            kind: 'unchanged' as const,
            reason: 'No goal change.',
          },
        })),
      },
    });

    orchestrator.receiveUserInput('Hello');
    await orchestrator.runEpoch();
    expect(
      events.some((event) => event.event === 'user-input.broadcast-selected'),
    ).toBe(false);

    await orchestrator.runEpoch();
    const selected = events.filter(
      (event) => event.event === 'user-input.broadcast-selected',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.epochId).toBe(
      events.filter((event) => event.event === 'epoch.started')[1]?.epochId,
    );
  });

  it('completes failed and empty-survivor epochs without reconstruction', async () => {
    const failed = telemetryFixture();
    const failing = makeOrchestrator({
      telemetry: failed.telemetry,
      nodes: [
        node('memory-1', 'memory', async () => ({
          role: 'node-response',
          content: 'Candidate.',
        })),
      ],
      relevanceFilter: {
        filter: vi.fn().mockRejectedValue(new Error('ranking failed')),
      },
      distiller: { distill: vi.fn() },
    });
    await expect(failing.runEpoch()).rejects.toThrow('ranking failed');
    expect(extractEpochSummaries(failed.events)[0]).toMatchObject({
      status: 'failure',
      counts: { generated: 1, attentionPassed: 0, selected: 0 },
    });

    const empty = telemetryFixture();
    const fallbackNode = node('fallback', 'memory', async () => undefined);
    const noSurvivors = makeOrchestrator({
      telemetry: empty.telemetry,
      nodes: [node('memory-1', 'memory', async () => undefined)],
      relevanceFilter: { filter: vi.fn().mockResolvedValue([]) },
      distiller: { distill: vi.fn() },
      fallbackNode,
    });
    await noSurvivors.runEpoch();
    expect(extractEpochSummaries(empty.events)[0]).toMatchObject({
      status: 'success',
      counts: { generated: 0, attentionPassed: 0, selected: 0 },
    });
  });

  it('does not duplicate candidate outcomes when later epoch work fails', async () => {
    const { telemetry, events } = telemetryFixture();
    const orchestrator = makeOrchestrator({
      telemetry,
      nodes: [
        node('memory-1', 'memory', async () => ({
          role: 'node-response',
          content: 'Candidate.',
        })),
      ],
      relevanceFilter: {
        filter: vi.fn(async (_workingMemory, candidates) => candidates),
      },
      distiller: {
        distill: vi.fn(async () => ({
          broadcast: { role: 'broadcast' as const, content: 'Candidate.' },
          supportingEvidence: [{ source: 'candidate' as const, index: 0 }],
          goalDecision: {
            kind: 'unchanged' as const,
            reason: 'No goal change.',
          },
        })),
      },
      nodePruner: {
        selectForPruning: vi.fn(() => {
          throw new Error('pruning failed');
        }),
      },
    });

    await expect(orchestrator.runEpoch()).rejects.toThrow('pruning failed');
    expect(
      events.filter((event) => event.event === 'candidate.outcome'),
    ).toHaveLength(1);
    expect(extractEpochSummaries(events)[0]?.status).toBe('failure');
  });

  it('lets shutdown await an active epoch and rejects overlapping epochs', async () => {
    const { telemetry, events } = telemetryFixture();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const orchestrator = makeOrchestrator({
      telemetry,
      nodes: [
        node('memory-1', 'memory', async () => {
          await blocked;
          return undefined;
        }),
      ],
      relevanceFilter: { filter: vi.fn().mockResolvedValue([]) },
      distiller: { distill: vi.fn() },
    });

    const running = orchestrator.runEpoch();
    const idle = orchestrator.waitForIdle();
    await expect(orchestrator.runEpoch()).rejects.toThrow(
      'an epoch is already running',
    );
    expect(events.some((event) => event.event === 'epoch.completed')).toBe(
      false,
    );

    release?.();
    await running;
    await idle;
    await orchestrator.waitForIdle();
    expect(
      events.filter((event) => event.event === 'epoch.completed'),
    ).toHaveLength(1);
  });
});

const makeOrchestrator = ({
  telemetry,
  nodes,
  relevanceFilter,
  distiller,
  eventStream = new ConcreteEventStream(),
  userInputSensor,
  fallbackNode = node('spawned', 'memory', async () => undefined),
  nodePruner = { selectForPruning: vi.fn().mockReturnValue([]) },
}: {
  readonly telemetry: TelemetryRecorder;
  readonly nodes: Node<string>[];
  readonly relevanceFilter: RelevanceFilter;
  readonly distiller: Distiller;
  readonly eventStream?: ConcreteEventStream;
  readonly userInputSensor?: UserInputSensor;
  readonly fallbackNode?: Node<'memory'>;
  readonly nodePruner?: NodePruner;
}): EpochOrchestrator =>
  new EpochOrchestrator({
    provider: provider(),
    relevanceFilter,
    distiller,
    maxWorkingMemoryMessages: 10,
    contextLengthThreshold: 10_000,
    memoryNodeSplitter: { split: vi.fn() },
    nodePruner,
    initialBroadcast: { role: 'broadcast', content: 'Initial.' },
    memoryNodeFactory: { create: vi.fn().mockReturnValue(fallbackNode) },
    eventStream,
    initialNodes: nodes,
    userInputSensor,
    telemetry,
  });

const node = <Kind extends string>(
  id: string,
  kind: Kind,
  sendMessage: Node<Kind>['sendMessage'],
): Node<Kind> => ({
  id,
  kind,
  status: 'idle',
  context: '',
  sendMessage,
});

const provider = (): Provider => ({
  generate: vi.fn(),
  selectBest: vi.fn(),
  rankByRelevance: vi.fn(),
  askYesNoQuestion: vi.fn(),
  splitString: vi.fn(),
  generateWithTools: vi.fn(),
});
