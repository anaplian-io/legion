import { Node, NodeStatus } from './node.js';
import { WorkingMemory } from './working-memory.js';
import { Message } from './message.js';
import { NodeStats } from './node-stats.js';
import { ActiveGoal } from './goal.js';
import { ErrorReport } from './error-stream.js';
import { Unsubscribe } from './subscription.js';

export interface NodeStatusChangeData {
  readonly nodeId: string;
  readonly status: NodeStatus;
}

export interface SystemNoticeData {
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolElaborationCallData {
  readonly callId: string;
  readonly toolName: string;
}

export interface ToolElaborationCompletedData {
  readonly nodeId: string;
  readonly requestId: string;
  readonly success: boolean;
  readonly toolCalls: readonly ToolElaborationCallData[];
  /** Bounded, single-line model output or afferent failure preview. */
  readonly output: string;
}

export interface ToolInvocationStartedData {
  readonly nodeId: string;
  /** Cognitive request that caused this call; absent for non-ToolNode actuators. */
  readonly requestId?: string;
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: string;
}

export interface ToolInvocationCompletedData {
  readonly nodeId: string;
  /** Cognitive request that caused this call; absent for non-ToolNode actuators. */
  readonly requestId?: string;
  readonly callId: string;
  readonly toolName: string;
  readonly success: boolean;
  /** Bounded, single-line output preview for logs and the TUI. */
  readonly output: string;
}

export interface GoalUpdatedData {
  readonly activeGoal: ActiveGoal | undefined;
}

export interface NodesChangedData {
  readonly allNodes: Node<string>[];
}

export interface NodeAddedData {
  readonly addedNodes: Node<string>[];
}

export interface NodeRemovedData {
  readonly removedNodeIds: string[];
}

export interface NodeUpdatedData {
  readonly node: Node<string>;
  readonly candidateId: string;
  readonly phase:
    'candidate-pending' | 'candidate-rejected' | 'experience-committed';
}

export interface WorkingMemoryUpdatedData {
  readonly workingMemory: WorkingMemory;
  readonly broadcast: Message;
}

export interface UserInputReceivedData {
  readonly content: string;
}

export interface UserInputConsumedData {
  readonly content: string;
}

export interface NodeStatsEntry {
  readonly nodeId: string;
  readonly stats: NodeStats;
}

export interface NodeStatsUpdatedData {
  readonly nodeStats: NodeStatsEntry[];
}

/** The canonical topic-to-payload map for Legion's in-process domain events. */
export interface EventMap {
  readonly 'system/notice': SystemNoticeData;
  readonly 'node/status-change': NodeStatusChangeData;
  readonly 'tool/elaboration-completed': ToolElaborationCompletedData;
  readonly 'tool/invocation-started': ToolInvocationStartedData;
  readonly 'tool/invocation-completed': ToolInvocationCompletedData;
  readonly 'goal/updated': GoalUpdatedData;
  readonly 'orchestrator/nodes-changed': NodesChangedData;
  readonly 'orchestrator/node-added': NodeAddedData;
  readonly 'orchestrator/node-removed': NodeRemovedData;
  readonly 'orchestrator/node-updated': NodeUpdatedData;
  readonly 'orchestrator/working-memory-updated': WorkingMemoryUpdatedData;
  readonly 'orchestrator/user-input-received': UserInputReceivedData;
  readonly 'orchestrator/user-input-consumed': UserInputConsumedData;
  readonly 'orchestrator/node-stats-updated': NodeStatsUpdatedData;
}

export type Topics = keyof EventMap;

export type PublishProps<Topic extends Topics = Topics> = {
  readonly [Name in Topic]: {
    readonly topicName: Name;
    readonly data: EventMap[Name];
  };
}[Topic];

export type SubscribeProps<Topic extends Topics = Topics> = {
  readonly [Name in Topic]: {
    readonly topicName: Name;
    readonly receiver: (data: EventMap[Name]) => void | Promise<void>;
  };
}[Topic];

export type PublishSystemNotice = PublishProps<'system/notice'>;
export type SubscribeSystemNotice = SubscribeProps<'system/notice'>;
export type PublishNodeStatusChange = PublishProps<'node/status-change'>;
export type SubscribeNodeStatusChange = SubscribeProps<'node/status-change'>;
export type PublishToolElaborationCompleted =
  PublishProps<'tool/elaboration-completed'>;
export type SubscribeToolElaborationCompleted =
  SubscribeProps<'tool/elaboration-completed'>;
export type PublishToolInvocationStarted =
  PublishProps<'tool/invocation-started'>;
export type SubscribeToolInvocationStarted =
  SubscribeProps<'tool/invocation-started'>;
export type PublishToolInvocationCompleted =
  PublishProps<'tool/invocation-completed'>;
export type SubscribeToolInvocationCompleted =
  SubscribeProps<'tool/invocation-completed'>;
export type PublishGoalUpdated = PublishProps<'goal/updated'>;
export type SubscribeGoalUpdated = SubscribeProps<'goal/updated'>;
export type PublishOrchestratorNodesChanged =
  PublishProps<'orchestrator/nodes-changed'>;
export type SubscribeOrchestratorNodesChanged =
  SubscribeProps<'orchestrator/nodes-changed'>;
export type PublishOrchestratorNodeAdded =
  PublishProps<'orchestrator/node-added'>;
export type SubscribeOrchestratorNodeAdded =
  SubscribeProps<'orchestrator/node-added'>;
export type PublishOrchestratorNodeRemoved =
  PublishProps<'orchestrator/node-removed'>;
export type SubscribeOrchestratorNodeRemoved =
  SubscribeProps<'orchestrator/node-removed'>;
export type PublishOrchestratorNodeUpdated =
  PublishProps<'orchestrator/node-updated'>;
export type SubscribeOrchestratorNodeUpdated =
  SubscribeProps<'orchestrator/node-updated'>;
export type PublishOrchestratorWorkingMemoryUpdated =
  PublishProps<'orchestrator/working-memory-updated'>;
export type SubscribeOrchestratorWorkingMemoryUpdated =
  SubscribeProps<'orchestrator/working-memory-updated'>;
export type PublishOrchestratorUserInputReceived =
  PublishProps<'orchestrator/user-input-received'>;
export type SubscribeOrchestratorUserInputReceived =
  SubscribeProps<'orchestrator/user-input-received'>;
export type PublishOrchestratorUserInputConsumed =
  PublishProps<'orchestrator/user-input-consumed'>;
export type SubscribeOrchestratorUserInputConsumed =
  SubscribeProps<'orchestrator/user-input-consumed'>;
export type PublishOrchestratorNodeStatsUpdated =
  PublishProps<'orchestrator/node-stats-updated'>;
export type SubscribeOrchestratorNodeStatsUpdated =
  SubscribeProps<'orchestrator/node-stats-updated'>;

export interface EventStream {
  readonly publish: (props: PublishProps) => void;
  readonly subscribe: <Topic extends Topics>(
    props: SubscribeProps<Topic>,
  ) => Unsubscribe;
  /** Publish a recoverable failure to Legion's dedicated error stream. */
  readonly reportError?: (report: ErrorReport) => void;
}

/** An event stream that can also feed infrastructure-level consumers. */
export interface ObservableEventStream extends EventStream {
  readonly subscribeAll: (
    receiver: (props: PublishProps) => void | Promise<void>,
  ) => Unsubscribe;
}
