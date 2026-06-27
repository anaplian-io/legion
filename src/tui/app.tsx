import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { EventStream } from '../types/event-stream.js';
import type { NodeStatus } from '../types/node.js';
import type { EpochOrchestrator } from '../orchestration/epoch-orchestrator.js';
import { Markdown, stripMarkdown } from './markdown.js';

export interface AppProps {
  readonly orchestrator: EpochOrchestrator;
  readonly eventStream: EventStream;
  /** Delay between epochs, in ms. */
  readonly epochDelayMs?: number;
  /** Called once the UI has exited so the caller can tear down. */
  readonly onExit: () => void;
}

interface NodeView {
  readonly id: string;
  readonly kind: string;
  readonly status: NodeStatus;
}

interface LogLine {
  readonly id: number;
  readonly text: string;
  readonly color: string;
}

/** The Global Workspace Theory epoch cycle, as the user sees it unfold. */
type Phase = 'idle' | 'broadcast' | 'compete' | 'attention' | 'consolidate';

const PHASE_STEPS: ReadonlyArray<{
  readonly phase: Exclude<Phase, 'idle'>;
  readonly label: string;
  readonly desc: string;
}> = [
  {
    phase: 'broadcast',
    label: 'Broadcast',
    desc: 'workspace → all processors',
  },
  {
    phase: 'compete',
    label: 'Compete',
    desc: 'processors generate candidates',
  },
  { phase: 'attention', label: 'Attention', desc: 'filter ranks by relevance' },
  {
    phase: 'consolidate',
    label: 'Consolidate',
    desc: 'distill → working memory',
  },
];

const MAX_LOG_LINES = 100;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const STATUS_COLOR: Record<NodeStatus, string> = {
  idle: 'gray',
  generating: 'yellow',
  'evaluating-relevance': 'cyan',
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: 'idle',
  generating: 'generating',
  'evaluating-relevance': 'evaluating',
};

const shortId = (id: string): string => (id.length > 16 ? id.slice(0, 16) : id);

export const App: React.FC<AppProps> = ({
  orchestrator,
  eventStream,
  epochDelayMs = 750,
  onExit,
}) => {
  const { exit } = useApp();
  // Seed from the orchestrator so restored (persisted) nodes and working
  // memory show immediately — the events that populate these fire during
  // init(), before this component mounts and subscribes, so they'd be missed.
  const [nodes, setNodes] = useState<Map<string, NodeView>>(
    () =>
      new Map(
        orchestrator.nodes.map((node) => [
          node.id,
          { id: node.id, kind: node.kind, status: node.status },
        ]),
      ),
  );
  const [workingMemory, setWorkingMemory] = useState<string[]>(() =>
    orchestrator.workingMemory.messages.map((m) => m.content),
  );
  const [broadcast, setBroadcast] = useState<string>(
    orchestrator.currentBroadcast.content,
  );
  const [epoch, setEpoch] = useState<number>(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState<boolean>(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [frame, setFrame] = useState<number>(0);
  const [inputMode, setInputMode] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState<string>('');
  // The epoch loop stays dormant until the first broadcast is injected.
  const [started, setStarted] = useState<boolean>(false);
  // Expanded, full-width, fully-readable working-memory view.
  const [wmExpanded, setWmExpanded] = useState<boolean>(false);

  const appendLog = (text: string, color = 'white'): void => {
    setLogs((prev) => {
      const next = [
        ...prev,
        { id: (prev[prev.length - 1]?.id ?? 0) + 1, text, color },
      ];
      return next.length > MAX_LOG_LINES
        ? next.slice(next.length - MAX_LOG_LINES)
        : next;
    });
  };

  // Animation tick for the active-phase / generating spinner.
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER.length),
      110,
    );
    return () => clearInterval(timer);
  }, []);

  // Wire up event subscriptions once. Node statuses drive the phase pipeline.
  useEffect(() => {
    eventStream.subscribe({
      topicName: 'orchestrator/nodes-changed',
      receiver: ({ allNodes }) => {
        setNodes((prev) => {
          const next = new Map<string, NodeView>();
          for (const node of allNodes) {
            next.set(node.id, {
              id: node.id,
              kind: node.kind,
              status: prev.get(node.id)?.status ?? node.status,
            });
          }
          return next;
        });
      },
    });

    eventStream.subscribe({
      topicName: 'orchestrator/node-added',
      receiver: ({ addedNodes }) => {
        for (const node of addedNodes) {
          appendLog(`+ spawned ${shortId(node.id)} (${node.kind})`, 'green');
        }
      },
    });

    eventStream.subscribe({
      topicName: 'orchestrator/node-removed',
      receiver: ({ removedNodeIds }) => {
        for (const id of removedNodeIds) {
          appendLog(`- pruned/split ${shortId(id)}`, 'red');
        }
      },
    });

    eventStream.subscribe({
      topicName: 'node/status-change',
      receiver: ({ nodeId, status }) => {
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(nodeId, { ...existing, status });
          return next;
        });
        if (status === 'generating') {
          /* v8 ignore next -- the consolidate-preserving arm depends on React update ordering and can't be hit deterministically */
          setPhase((p) => (p === 'consolidate' ? p : 'compete'));
        } else if (status === 'evaluating-relevance') {
          setPhase('attention');
        }
      },
    });

    eventStream.subscribe({
      topicName: 'orchestrator/working-memory-updated',
      receiver: ({ workingMemory: wm, broadcast: next }) => {
        setWorkingMemory(wm.messages.map((m) => m.content));
        setBroadcast(next.content);
        setPhase('consolidate');
        appendLog('✦ distilled new broadcast into working memory', 'magenta');
      },
    });
  }, [eventStream]);

  // Drive the epoch loop. Dormant until the first broadcast is injected.
  useEffect(() => {
    if (!started || paused) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      // Guards the race where the timer fires during effect teardown. The
      // cleanup clears this timer, so the guard is effectively unreachable.
      /* v8 ignore next 1 */
      if (cancelled) return;
      setPhase('broadcast');
      appendLog(`▶ epoch ${epoch}: broadcasting to all processors`, 'cyan');
      try {
        await orchestrator.runEpoch();
        if (!cancelled) {
          appendLog(`✓ epoch ${epoch} complete`, 'green');
          setEpoch((n) => n + 1);
        }
      } catch (e) {
        appendLog(
          `✗ epoch ${epoch} error: ${e instanceof Error ? e.message : String(e)}`,
          'red',
        );
        /* v8 ignore next -- post-cancel completion depends on async race timing */
        if (!cancelled) setEpoch((n) => n + 1);
      }
    }, epochDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [epoch, paused, started, orchestrator, epochDelayMs]);

  useInput((input, key) => {
    // Input mode: capture typed text for an injected broadcast.
    if (inputMode) {
      if (key.return) {
        const text = inputValue.trim();
        if (text.length > 0) {
          orchestrator.injectBroadcast(text);
          appendLog(`☢ injected broadcast: ${text}`, 'magentaBright');
          if (!started) {
            setStarted(true);
            appendLog('▶ first broadcast received — starting epochs', 'green');
          }
        }
        setInputValue('');
        setInputMode(false);
        return;
      }
      if (key.escape) {
        setInputValue('');
        setInputMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      // Append printable characters; ignore navigation / modifier keys.
      if (
        input.length > 0 &&
        !key.ctrl &&
        !key.meta &&
        !key.tab &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow
      ) {
        setInputValue((v) => v + input);
      }
      return;
    }

    // Command mode.
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onExit();
      exit();
      return;
    }
    if (input === 'i') {
      setInputMode(true);
      return;
    }
    if (input === 'm') {
      setWmExpanded((e) => !e);
      return;
    }
    if (input === ' ' || input === 'p') {
      setPaused((p) => !p);
    }
  });

  // `frame` is kept in range by the animation effect, so this index is always
  // defined (the assertion satisfies noUncheckedIndexedAccess without a branch).
  const spin = SPINNER[frame]!;
  const nodeList = Array.from(nodes.values());
  const competing = nodeList.filter((n) => n.status !== 'idle').length;
  const activeStep = PHASE_STEPS.findIndex((s) => s.phase === phase);
  const activeStepDesc = PHASE_STEPS.find((s) => s.phase === phase)?.desc ?? '';
  const visibleLogs = logs.slice(-10);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Title bar */}
      <Box>
        <Text bold color="magentaBright">
          ◆ LEGION
        </Text>
        <Text color="gray"> Global Workspace Theory engine</Text>
        <Text color="gray"> · epoch </Text>
        <Text bold color="greenBright">
          {epoch}
        </Text>
        <Text color="gray"> · </Text>
        <Text
          bold
          color={
            !started ? 'yellowBright' : paused ? 'redBright' : 'greenBright'
          }
        >
          {!started
            ? '◌ AWAITING FIRST BROADCAST'
            : paused
              ? '❚❚ PAUSED'
              : `${spin} RUNNING`}
        </Text>
      </Box>

      {/* GWT cycle pipeline */}
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={1}
        marginTop={1}
      >
        <Text bold color="yellow">
          GWT EPOCH CYCLE
        </Text>
        <Box marginTop={1}>
          {PHASE_STEPS.map((step, i) => {
            const isActive = i === activeStep;
            const isDone = activeStep >= 0 && i < activeStep;
            const color = isActive ? 'yellowBright' : isDone ? 'green' : 'gray';
            return (
              <Box key={step.phase}>
                <Text bold color={color}>
                  {isActive ? spin : isDone ? '✓' : '○'} {i + 1}.{step.label}
                </Text>
                {i < PHASE_STEPS.length - 1 ? (
                  <Text color="gray"> ──▶ </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
        <Text color="gray">
          {activeStep >= 0
            ? `↳ ${activeStepDesc}`
            : '↳ waiting for next epoch…'}
        </Text>
      </Box>

      {/* Global workspace spotlight */}
      <Box
        borderStyle="double"
        borderColor="magentaBright"
        flexDirection="column"
        paddingX={1}
        marginTop={1}
      >
        <Text bold color="magentaBright">
          ☀ GLOBAL WORKSPACE
        </Text>
        <Text color="gray">the single broadcast all processors receive</Text>
        <Box marginTop={1}>
          {started ? (
            <Text color="whiteBright" wrap="truncate-end">
              « {stripMarkdown(broadcast)} »
            </Text>
          ) : (
            <Text color="yellow">
              awaiting your first broadcast — press [i], type a message, then
              [enter] to begin
            </Text>
          )}
        </Box>
      </Box>

      {wmExpanded ? (
        /* Expanded, full-width, fully-readable working memory */
        <Box
          borderStyle="round"
          borderColor="blue"
          flexDirection="column"
          paddingX={1}
          marginTop={1}
        >
          <Box>
            <Text bold color="blue">
              WORKING MEMORY{' '}
            </Text>
            <Text color="gray">
              (rolling window · {workingMemory.length} entries · oldest →
              newest)
            </Text>
          </Box>
          {workingMemory.length === 0 ? (
            <Text color="gray">(empty)</Text>
          ) : (
            workingMemory.map((message, i) => {
              const isNewest = i === workingMemory.length - 1;
              return (
                <Box key={i} flexDirection="column" marginTop={1}>
                  <Text>
                    <Text bold color={isNewest ? 'blueBright' : 'gray'}>
                      #{i + 1}
                    </Text>
                    {isNewest ? (
                      <Text bold color="greenBright">
                        {'  '}◀ most recent
                      </Text>
                    ) : null}
                  </Text>
                  <Markdown
                    text={message}
                    color={isNewest ? 'whiteBright' : 'gray'}
                  />
                </Box>
              );
            })
          )}
        </Box>
      ) : (
        /* Dashboard: processors + compact working memory + activity */
        <>
          <Box marginTop={1}>
            <Box
              borderStyle="round"
              borderColor="cyan"
              flexDirection="column"
              paddingX={1}
              width="55%"
            >
              <Box>
                <Text bold color="cyan">
                  UNCONSCIOUS PROCESSORS{' '}
                </Text>
                <Text color="gray">({nodeList.length} nodes · </Text>
                <Text color="yellowBright">{competing} active</Text>
                <Text color="gray">)</Text>
              </Box>
              {nodeList.length === 0 ? (
                <Text color="gray">(none yet — bootstrapping)</Text>
              ) : (
                nodeList.map((node) => {
                  const glyph = node.status === 'idle' ? '○' : spin;
                  return (
                    <Box key={node.id}>
                      <Text color={STATUS_COLOR[node.status]}>{glyph} </Text>
                      <Text color="whiteBright">{shortId(node.id)} </Text>
                      <Text color="gray">{node.kind} </Text>
                      <Text color={STATUS_COLOR[node.status]}>
                        {STATUS_LABEL[node.status]}
                      </Text>
                    </Box>
                  );
                })
              )}
            </Box>

            <Box
              borderStyle="round"
              borderColor="blue"
              flexDirection="column"
              paddingX={1}
              width="45%"
            >
              <Box>
                <Text bold color="blue">
                  WORKING MEMORY{' '}
                </Text>
                <Text color="gray">
                  (rolling · {workingMemory.length} · [m] to expand)
                </Text>
              </Box>
              {workingMemory.length === 0 ? (
                <Text color="gray">(empty)</Text>
              ) : (
                workingMemory.slice(-7).map((message, i, shown) => {
                  const isNewest = i === shown.length - 1;
                  return (
                    <Text
                      key={i}
                      wrap="truncate-end"
                      color={isNewest ? 'whiteBright' : 'gray'}
                    >
                      {isNewest ? '▸ ' : '• '}
                      {stripMarkdown(message)}
                    </Text>
                  );
                })
              )}
            </Box>
          </Box>

          {/* Activity log */}
          <Box
            borderStyle="round"
            borderColor="gray"
            flexDirection="column"
            paddingX={1}
            marginTop={1}
          >
            <Text bold color="gray">
              ACTIVITY
            </Text>
            {visibleLogs.length === 0 ? (
              <Text color="gray">(waiting…)</Text>
            ) : (
              visibleLogs.map((line) => (
                <Text key={line.id} color={line.color} wrap="truncate-end">
                  {line.text}
                </Text>
              ))
            )}
          </Box>
        </>
      )}

      <Box marginTop={1}>
        {inputMode ? (
          <Text>
            <Text bold color="greenBright">
              ☀ broadcast›{' '}
            </Text>
            <Text color="whiteBright">{inputValue}</Text>
            <Text color="green">▏</Text>
            <Text color="gray">{'  '}[enter] send · [esc] cancel</Text>
          </Text>
        ) : (
          <Text color="gray">
            [i] inject · [space] pause/resume ·{' '}
            {wmExpanded ? '[m] collapse memory' : '[m] expand memory'} · [q]
            quit
          </Text>
        )}
      </Box>
    </Box>
  );
};
