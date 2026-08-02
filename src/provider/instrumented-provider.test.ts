import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../types/provider.js';
import type { TelemetryClock, TelemetryEvent } from '../types/telemetry.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import { InstrumentedProvider } from './instrumented-provider.js';

const setup = () => {
  let monotonic = 0;
  let id = 0;
  const provider: Provider = {
    generate: vi.fn().mockResolvedValue('generated'),
    selectBest: vi.fn().mockResolvedValue(0),
    rankByRelevance: vi.fn().mockResolvedValue([0]),
    askYesNoQuestion: vi.fn().mockResolvedValue(true),
    splitString: vi.fn().mockResolvedValue(['left', 'right']),
    generateWithTools: vi
      .fn()
      .mockResolvedValue({ content: 'tools', toolCalls: undefined }),
  };
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
  return {
    provider,
    instrumented: new InstrumentedProvider({ provider, telemetry }),
    events,
  };
};

describe('InstrumentedProvider', () => {
  it('records every provider method with a stable inference ID and stage', async () => {
    const { instrumented, events } = setup();
    const messages = [{ role: 'broadcast' as const, content: 'prompt' }];

    await instrumented.generate(
      { systemPrompt: 'system', messages },
      { stage: 'provider-generate' },
    );
    await instrumented.selectBest(
      {
        systemPrompt: 'system',
        messages,
        candidates: ['candidate'],
      },
      { stage: 'provider-select-best' },
    );
    await instrumented.rankByRelevance('concept', ['item'], {
      stage: 'provider-rank-relevance',
    });
    await instrumented.askYesNoQuestion(
      {
        systemPrompt: 'system',
        messages,
        question: 'Useful?',
      },
      { stage: 'provider-yes-no' },
    );
    await instrumented.splitString('content', { stage: 'provider-split' });
    await instrumented.generateWithTools(
      {
        systemPrompt: 'system',
        messages,
        tools: [],
      },
      { stage: 'provider-generate-tools' },
    );

    const inferences = events.filter(
      (event): event is TelemetryEvent<'inference.completed'> =>
        event.event === 'inference.completed',
    );
    expect(inferences.map(({ data }) => data.stage)).toEqual([
      'provider-generate',
      'provider-select-best',
      'provider-rank-relevance',
      'provider-yes-no',
      'provider-split',
      'provider-generate-tools',
    ]);
    expect(inferences.every(({ data }) => data.outcome === 'success')).toBe(
      true,
    );
    expect(new Set(inferences.map(({ data }) => data.inferenceId)).size).toBe(
      6,
    );
  });

  it('retains explicit correlation and records failures before rethrowing', async () => {
    const { provider, instrumented, events } = setup();
    vi.mocked(provider.generate).mockRejectedValueOnce(new TypeError('failed'));

    await expect(
      instrumented.generate(
        { systemPrompt: 'system', messages: [] },
        {
          stage: 'node-generation',
          epochId: 'epoch-1',
          wave: 'cognitive',
          candidateId: 'candidate-1',
          nodeId: 'node-1',
          parentSpanId: 'wave-1',
        },
      ),
    ).rejects.toThrow('failed');

    expect(events[0]).toMatchObject({
      event: 'inference.completed',
      epochId: 'epoch-1',
      wave: 'cognitive',
      candidateId: 'candidate-1',
      nodeId: 'node-1',
      parentSpanId: 'wave-1',
      data: {
        stage: 'node-generation',
        outcome: 'failure',
        errorCategory: 'TypeError',
      },
    });
  });
});
