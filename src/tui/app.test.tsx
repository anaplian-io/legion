import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { ConcreteEventStream } from '../service/concrete-event-stream.js';
import type { EpochOrchestrator } from '../orchestration/epoch-orchestrator.js';
import type { Node } from '../types/node.js';
import type { Message } from '../types/message.js';

const ESC = '\x1B';
const BACKSPACE = '\x7F';
const ENTER = '\r';

const memoryNode = (id: string): Node<'memory'> => ({
  id,
  kind: 'memory',
  status: 'idle',
  context: '',
  sendMessage: vi.fn(),
});

const toolNode = (id: string): Node<'tool'> => ({
  id,
  kind: 'tool',
  status: 'idle',
  context: '',
  sendMessage: vi.fn(),
});

interface FakeOrchestrator {
  nodes: Node<string>[];
  workingMemory: { messages: Message[] };
  currentBroadcast: Message;
  runEpoch: ReturnType<typeof vi.fn>;
  receiveUserInput: ReturnType<typeof vi.fn>;
}

const makeOrchestrator = (
  overrides: Partial<FakeOrchestrator> = {},
): FakeOrchestrator => ({
  nodes: [],
  workingMemory: { messages: [] },
  currentBroadcast: { role: 'broadcast', content: '' },
  runEpoch: vi.fn().mockResolvedValue(undefined),
  receiveUserInput: vi.fn(),
  ...overrides,
});

const asOrchestrator = (o: FakeOrchestrator): EpochOrchestrator =>
  o as unknown as EpochOrchestrator;

/** Let ink process input and re-render (real timers, short waits). */
const tick = async (ms = 60): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
};

/**
 * Poll `read()` until `predicate` holds, or fail after a timeout. Robust to the
 * variable render latency of Ink (especially under coverage instrumentation),
 * where a fixed sleep is flaky.
 */
const waitForFrame = async (
  read: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 2000,
): Promise<string> => {
  const start = Date.now();
  for (;;) {
    const frame = read() ?? '';
    if (predicate(frame)) {
      return frame;
    }
    if (Date.now() - start > timeoutMs) {
      return frame;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
};

describe('App', () => {
  let eventStream: ConcreteEventStream;

  beforeEach(() => {
    eventStream = new ConcreteEventStream();
  });

  it('renders the initial paused state with seeded nodes and memory', () => {
    const orchestrator = makeOrchestrator({
      nodes: [memoryNode('seed-node-1')],
      workingMemory: {
        messages: [
          { role: 'working-memory' as const, content: 'remembered thing' },
        ],
      },
      currentBroadcast: { role: 'broadcast', content: 'seed broadcast' },
    });

    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    const out = lastFrame() ?? '';
    expect(out).toContain('LEGION');
    expect(out).toContain('PAUSED');
    expect(out).toContain('seed broadcast');
    expect(out).toContain('USER INPUT');
    expect(out).toContain('seed-node-1');
    expect(out).toContain('remembered thing');
  });

  it('shows the initial broadcast before the loop is unpaused', () => {
    const orchestrator = makeOrchestrator({
      currentBroadcast: {
        role: 'broadcast',
        content: 'What is the 3 day forecast?',
      },
    });

    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    const out = lastFrame() ?? '';
    expect(out).toContain('PAUSED');
    expect(out).toContain('What is the 3 day forecast?');
  });

  it('sends user input without starting the epoch loop', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={10}
      />,
    );

    stdin.write('i'); // enter input mode
    await tick();
    expect(lastFrame() ?? '').toContain('user›');

    stdin.write('hello'); // type
    await tick();
    stdin.write(ENTER); // enter
    await tick();

    expect(orchestrator.receiveUserInput).toHaveBeenCalledWith('hello');
    await tick(30);
    expect(orchestrator.runEpoch).not.toHaveBeenCalled();
  });

  it('starts the epoch loop when unpaused', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={10}
      />,
    );

    stdin.write(' ');
    await waitForFrame(
      lastFrame,
      () => orchestrator.runEpoch.mock.calls.length > 0,
    );
    expect(orchestrator.runEpoch).toHaveBeenCalled();
  });

  it('sending input more than once keeps the TUI paused', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={1000}
      />,
    );

    stdin.write('i');
    await tick();
    stdin.write('one');
    await tick();
    stdin.write(ENTER);
    await tick();

    stdin.write('i');
    await tick();
    stdin.write('two');
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(orchestrator.receiveUserInput).toHaveBeenLastCalledWith('two');
    const out = lastFrame() ?? '';
    expect(out).toContain('PAUSED');
    expect(out).not.toContain('starting epochs');
    expect(orchestrator.runEpoch).not.toHaveBeenCalled();
  });

  it('ignores arrow keys while typing user input', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    stdin.write('i');
    await tick();
    stdin.write('ab');
    await tick();
    stdin.write('\x1B[A'); // up arrow — must not append to the buffer
    await tick();
    stdin.write('\x1B[C'); // right arrow
    await tick();
    stdin.write(ENTER);
    await tick();

    // Arrows were ignored, so only 'ab' was sent.
    expect(orchestrator.receiveUserInput).toHaveBeenCalledWith('ab');
  });

  it('cancels input mode on [esc] without sending input', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    stdin.write('i');
    await tick();
    stdin.write('abc');
    await tick();
    stdin.write(ESC);
    await tick();

    expect(orchestrator.receiveUserInput).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').not.toContain('user›');
  });

  it('supports backspace while typing user input', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    stdin.write('i');
    await tick();
    stdin.write('hi');
    await tick();
    stdin.write(BACKSPACE);
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(orchestrator.receiveUserInput).toHaveBeenCalledWith('h');
  });

  it('ignores an empty user input submission', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    stdin.write('i');
    await tick();
    stdin.write(ENTER); // submit nothing
    await tick();

    expect(orchestrator.receiveUserInput).not.toHaveBeenCalled();
  });

  it('shows the latest received user input event', async () => {
    const orchestrator = makeOrchestrator();
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'orchestrator/user-input-received',
      data: { content: 'please inspect the sensor path' },
    });

    const out = await waitForFrame(lastFrame, (frame) =>
      frame.includes('please inspect the sensor path'),
    );
    expect(out).toContain('USER INPUT');
    expect(out).toContain('please inspect the sensor path');
  });

  it('marks compact user input as consumed', async () => {
    const orchestrator = makeOrchestrator();
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'orchestrator/user-input-received',
      data: { content: 'compact request' },
    });
    eventStream.publish({
      topicName: 'orchestrator/user-input-consumed',
      data: { content: 'compact request' },
    });

    const out = await waitForFrame(lastFrame, (frame) =>
      frame.includes('✓ compact request'),
    );
    expect(out).toContain('0 pending');
  });

  it('expands user input to show the full queue and marks consumed messages', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'orchestrator/user-input-received',
      data: { content: 'first request' },
    });
    eventStream.publish({
      topicName: 'orchestrator/user-input-received',
      data: { content: 'second request' },
    });

    let out = await waitForFrame(lastFrame, (frame) =>
      frame.includes('first request'),
    );
    expect(out).toContain('▸ first request');
    expect(out).not.toContain('second request');

    stdin.write('u');
    out = await waitForFrame(lastFrame, (frame) =>
      frame.includes('second request'),
    );
    expect(out).toContain('▸ first request');
    expect(out).toContain('▸ second request');

    eventStream.publish({
      topicName: 'orchestrator/user-input-consumed',
      data: { content: 'first request' },
    });
    out = await waitForFrame(lastFrame, (frame) =>
      frame.includes('✓ first request'),
    );
    expect(out).toContain('✓ first request');
    expect(out).toContain('▸ second request');
    expect(out).toContain('1 pending');

    eventStream.publish({
      topicName: 'orchestrator/user-input-consumed',
      data: { content: 'not in queue' },
    });
    await tick();
    expect(lastFrame() ?? '').toContain('✓ first request');
  });

  it('toggles the expanded working-memory view with [m]', async () => {
    const orchestrator = makeOrchestrator({
      // Multiple entries exercise both the newest and older render arms in the
      // compact (initial) and expanded panels.
      workingMemory: {
        messages: [
          { role: 'working-memory', content: 'older mem entry' },
          { role: 'working-memory', content: 'newest mem entry' },
        ],
      },
    });
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    stdin.write('m');
    // Expanded view shows the full-width memory panel header.
    expect(
      await waitForFrame(lastFrame, (f) => f.includes('oldest → newest')),
    ).toContain('oldest → newest');

    stdin.write('m');
    // Collapsed view restores the side-by-side processors panel; the expanded
    // header is gone.
    const collapsed = await waitForFrame(
      lastFrame,
      (f) => !f.includes('oldest → newest'),
    );
    expect(collapsed).not.toContain('oldest → newest');
    expect(collapsed).toContain('NODES');
  });

  it('pauses and resumes with [space]', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    // Start the loop first.
    stdin.write('i');
    await tick();
    stdin.write('go');
    await tick();
    stdin.write(ENTER);
    await tick();

    stdin.write(' '); // pause
    expect(
      await waitForFrame(lastFrame, (f) => f.includes('PAUSED')),
    ).toContain('PAUSED');

    stdin.write(' '); // resume
    expect(
      await waitForFrame(lastFrame, (f) => f.includes('RUNNING')),
    ).toContain('RUNNING');
  });

  it('also pauses with the [p] alias and shows the memory phase description', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    // A status change advances the phase pipeline, rendering a phase desc line.
    eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: [memoryNode('n')] },
    });
    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'n', status: 'generating' },
    });
    expect(
      await waitForFrame(lastFrame, (f) => f.includes('↳ memory nodes reason')),
    ).toContain('↳ memory nodes reason');

    // Start, then pause via the 'p' alias.
    stdin.write('i');
    await tick();
    stdin.write('go');
    await tick();
    stdin.write(ENTER);
    await tick();
    // An unhandled command-mode key is a no-op (false arm of the pause check).
    stdin.write('z');
    await tick();
    stdin.write('p');
    expect(
      await waitForFrame(lastFrame, (f) => f.includes('PAUSED')),
    ).toContain('PAUSED');
  });

  it('shows afferent nodes upstream of the memory wave', async () => {
    const orchestrator = makeOrchestrator({
      nodes: [toolNode('tool-a'), memoryNode('memory-a')],
    });
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'tool-a', status: 'generating' },
    });

    const out = await waitForFrame(lastFrame, (f) =>
      f.includes('↳ tools/sensors perceive upstream context'),
    );
    expect(out).toContain('upstream afferent');
    expect(out).toContain('memory wave');
    expect(out).toContain('tool-a');
    expect(out).toContain('memory-a');
  });

  it('quits with [q], calling onExit', async () => {
    const orchestrator = makeOrchestrator();
    const onExit = vi.fn();
    const { stdin } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={onExit}
      />,
    );

    stdin.write('q');
    await tick();
    expect(onExit).toHaveBeenCalled();
  });

  it('also quits on ctrl+c', async () => {
    const orchestrator = makeOrchestrator();
    const onExit = vi.fn();
    const { stdin } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={onExit}
      />,
    );

    stdin.write('\x03'); // ctrl+c
    await tick();
    expect(onExit).toHaveBeenCalled();
  });

  it('truncates long node ids in the processor list', async () => {
    const orchestrator = makeOrchestrator({
      nodes: [memoryNode('a-very-long-node-identifier-1234567890')],
    });
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    const out = lastFrame() ?? '';
    expect(out).toContain('a-very-long-node');
    expect(out).not.toContain('a-very-long-node-identifier-1234567890');
  });

  it('shows (empty) in the expanded memory view when there is no memory', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    stdin.write('m');
    const out = await waitForFrame(lastFrame, (f) =>
      f.includes('oldest → newest'),
    );
    expect(out).toContain('(empty)');
  });

  it('caps the activity log and keeps the most recent entries', async () => {
    const orchestrator = makeOrchestrator();
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    // Each node-added publish appends a log line; exceed the 100-line cap.
    for (let i = 0; i < 120; i++) {
      eventStream.publish({
        topicName: 'orchestrator/node-added',
        data: { addedNodes: [memoryNode(`spawned-${i}`)] },
      });
    }

    const out = await waitForFrame(lastFrame, (f) => f.includes('spawned-119'));
    // The newest entry is shown; the oldest has scrolled past the cap.
    expect(out).toContain('spawned-119');
    expect(out).not.toContain('spawned-0 ');
  });

  it('reflects orchestrator events in the view', async () => {
    const orchestrator = makeOrchestrator();
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: [memoryNode('live-node')] },
    });
    eventStream.publish({
      topicName: 'orchestrator/node-added',
      data: { addedNodes: [memoryNode('live-node')] },
    });
    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'live-node', status: 'generating' },
    });
    eventStream.publish({
      topicName: 'orchestrator/working-memory-updated',
      data: {
        workingMemory: {
          messages: [
            { role: 'working-memory' as const, content: 'distilled mem' },
          ],
        },
        broadcast: { role: 'broadcast' as const, content: 'new broadcast' },
      },
    });
    const out = await waitForFrame(
      lastFrame,
      // The distillation event writes a full-width activity-log line (the
      // compact memory panel truncates, so assert on the log instead).
      (f) => f.includes('live-node') && f.includes('distilled new broadcast'),
    );
    expect(out).toContain('live-node');
    expect(out).toContain('distilled new broadcast');
  });

  it('keeps the consolidate phase when a generating status arrives mid-consolidation', async () => {
    const orchestrator = makeOrchestrator();
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: [memoryNode('n')] },
    });
    // Enter the consolidate phase.
    eventStream.publish({
      topicName: 'orchestrator/working-memory-updated',
      data: {
        workingMemory: {
          messages: [{ role: 'working-memory' as const, content: 'm' }],
        },
        broadcast: { role: 'broadcast' as const, content: 'b' },
      },
    });
    await waitForFrame(lastFrame, (f) => f.includes('Consolidate'));
    // A late generating status must NOT knock us back to an earlier phase.
    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'n', status: 'generating' },
    });
    const out = await waitForFrame(lastFrame, (f) =>
      f.includes('distill → working memory'),
    );
    expect(out).toContain('distill → working memory');
  });

  it('logs a non-Error epoch rejection via String()', async () => {
    const orchestrator = makeOrchestrator({
      runEpoch: vi.fn().mockRejectedValue('plain string failure'),
    });
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={5}
      />,
    );

    stdin.write(' ');

    const out = await waitForFrame(lastFrame, (f) =>
      f.includes('plain string failure'),
    );
    expect(out).toContain('plain string failure');
  });

  it('cancels a pending epoch when paused before the delay elapses', async () => {
    const orchestrator = makeOrchestrator();
    const { stdin } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={1000}
      />,
    );

    // Unpause, then pause before the (long) epoch delay elapses so the
    // effect cleanup cancels the scheduled epoch.
    stdin.write(' ');
    await tick();
    stdin.write(' '); // pause -> cleanup clears the pending timer
    await tick(40);

    expect(orchestrator.runEpoch).not.toHaveBeenCalled();
  });

  it('skips a fired epoch whose effect was cancelled mid-flight', async () => {
    // A runEpoch that blocks lets us flip `cancelled` (via pause) after the
    // timer fires but before the async body resumes, exercising the in-body
    // cancellation guard.
    let releaseEpoch: (() => void) | undefined;
    const orchestrator = makeOrchestrator({
      runEpoch: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseEpoch = resolve;
          }),
      ),
    });
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={5}
      />,
    );

    stdin.write(' ');

    // Let the first epoch start and block inside runEpoch.
    await waitForFrame(
      lastFrame,
      () => orchestrator.runEpoch.mock.calls.length > 0,
    );
    // Pause (cancels the in-flight effect), then let the blocked epoch resolve.
    stdin.write(' ');
    await tick();
    releaseEpoch?.();
    await tick(40);

    // The epoch ran once; its completion was swallowed by the cancel guard, so
    // no second epoch was scheduled.
    expect(orchestrator.runEpoch).toHaveBeenCalledTimes(1);
  });

  it('logs node removal and handles relevance/unknown status changes', async () => {
    const orchestrator = makeOrchestrator();
    const { lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
      />,
    );

    eventStream.publish({
      topicName: 'orchestrator/nodes-changed',
      data: { allNodes: [memoryNode('node-x')] },
    });
    // A status change for a node the view doesn't know about is ignored.
    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'ghost', status: 'generating' },
    });
    // The relevance-evaluation status drives the attention phase.
    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'node-x', status: 'evaluating-relevance' },
    });
    // An 'idle' status updates the node but matches no phase branch.
    eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: 'node-x', status: 'idle' },
    });
    // Removal writes a full-width activity-log line.
    eventStream.publish({
      topicName: 'orchestrator/node-removed',
      data: { removedNodeIds: ['node-x'] },
    });

    const out = await waitForFrame(lastFrame, (f) =>
      f.includes('pruned/split'),
    );
    expect(out).toContain('pruned/split');
  });

  it('logs an epoch error when runEpoch rejects', async () => {
    const orchestrator = makeOrchestrator({
      runEpoch: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { stdin, lastFrame } = render(
      <App
        orchestrator={asOrchestrator(orchestrator)}
        eventStream={eventStream}
        onExit={() => {}}
        epochDelayMs={5}
      />,
    );

    stdin.write(' ');

    const out = await waitForFrame(lastFrame, (f) => f.includes('error'));
    expect(orchestrator.runEpoch).toHaveBeenCalled();
    expect(out).toContain('error');
  });
});
