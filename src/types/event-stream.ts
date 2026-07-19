import { Node, NodeStatus } from './node.js';
import { WorkingMemory } from './working-memory.js';
import { Message } from './message.js';
import { NodeStats } from './node-stats.js';
import { ActiveGoal } from './goal.js';
import { ErrorReport } from './error-stream.js';

export interface NodeStatusChangeData {
  readonly nodeId: string;
  readonly status: NodeStatus;
}

export interface SystemNoticeData {
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PublishSystemNotice {
  readonly topicName: 'system/notice';
  readonly data: SystemNoticeData;
}

export interface SubscribeSystemNotice {
  readonly topicName: PublishSystemNotice['topicName'];
  readonly receiver: (data: SystemNoticeData) => void | Promise<void>;
}

export interface PublishNodeStatusChange {
  readonly topicName: 'node/status-change';
  readonly data: NodeStatusChangeData;
}

export interface SubscribeNodeStatusChange {
  readonly topicName: PublishNodeStatusChange['topicName'];
  readonly receiver: (data: NodeStatusChangeData) => void | Promise<void>;
}

export interface ToolInvocationStartedData {
  readonly nodeId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: string;
}

export interface PublishToolInvocationStarted {
  readonly topicName: 'tool/invocation-started';
  readonly data: ToolInvocationStartedData;
}

export interface SubscribeToolInvocationStarted {
  readonly topicName: PublishToolInvocationStarted['topicName'];
  readonly receiver: (data: ToolInvocationStartedData) => void | Promise<void>;
}

export interface ToolInvocationCompletedData {
  readonly nodeId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly success: boolean;
  /** Bounded, single-line output preview for logs and the TUI. */
  readonly output: string;
}

export interface PublishToolInvocationCompleted {
  readonly topicName: 'tool/invocation-completed';
  readonly data: ToolInvocationCompletedData;
}

export interface SubscribeToolInvocationCompleted {
  readonly topicName: PublishToolInvocationCompleted['topicName'];
  readonly receiver: (
    data: ToolInvocationCompletedData,
  ) => void | Promise<void>;
}

export interface GoalUpdatedData {
  readonly activeGoal: ActiveGoal | undefined;
}

export interface PublishGoalUpdated {
  readonly topicName: 'goal/updated';
  readonly data: GoalUpdatedData;
}

export interface SubscribeGoalUpdated {
  readonly topicName: PublishGoalUpdated['topicName'];
  readonly receiver: (data: GoalUpdatedData) => void | Promise<void>;
}

export interface NodesChangedData {
  readonly allNodes: Node<string>[];
}

export interface PublishOrchestratorNodesChanged {
  readonly topicName: 'orchestrator/nodes-changed';
  readonly data: NodesChangedData;
}

export interface SubscribeOrchestratorNodesChanged {
  readonly topicName: PublishOrchestratorNodesChanged['topicName'];
  readonly receiver: (data: NodesChangedData) => void | Promise<void>;
}

export interface NodeAddedData {
  readonly addedNodes: Node<string>[];
}

export interface PublishOrchestratorNodeAdded {
  readonly topicName: 'orchestrator/node-added';
  readonly data: NodeAddedData;
}

export interface SubscribeOrchestratorNodeAdded {
  readonly topicName: PublishOrchestratorNodeAdded['topicName'];
  readonly receiver: (data: NodeAddedData) => void | Promise<void>;
}

export interface NodeRemovedData {
  readonly removedNodeIds: string[];
}

export interface PublishOrchestratorNodeRemoved {
  readonly topicName: 'orchestrator/node-removed';
  readonly data: NodeRemovedData;
}

export interface SubscribeOrchestratorNodeRemoved {
  readonly topicName: PublishOrchestratorNodeRemoved['topicName'];
  readonly receiver: (data: NodeRemovedData) => void | Promise<void>;
}

export interface NodeUpdatedData {
  readonly node: Node<string>;
}

export interface PublishOrchestratorNodeUpdated {
  readonly topicName: 'orchestrator/node-updated';
  readonly data: NodeUpdatedData;
}

export interface SubscribeOrchestratorNodeUpdated {
  readonly topicName: PublishOrchestratorNodeUpdated['topicName'];
  readonly receiver: (data: NodeUpdatedData) => void | Promise<void>;
}

export interface WorkingMemoryUpdatedData {
  readonly workingMemory: WorkingMemory;
  readonly broadcast: Message;
}

export interface PublishOrchestratorWorkingMemoryUpdated {
  readonly topicName: 'orchestrator/working-memory-updated';
  readonly data: WorkingMemoryUpdatedData;
}

export interface SubscribeOrchestratorWorkingMemoryUpdated {
  readonly topicName: PublishOrchestratorWorkingMemoryUpdated['topicName'];
  readonly receiver: (data: WorkingMemoryUpdatedData) => void | Promise<void>;
}

export interface UserInputReceivedData {
  readonly content: string;
}

export interface PublishOrchestratorUserInputReceived {
  readonly topicName: 'orchestrator/user-input-received';
  readonly data: UserInputReceivedData;
}

export interface SubscribeOrchestratorUserInputReceived {
  readonly topicName: PublishOrchestratorUserInputReceived['topicName'];
  readonly receiver: (data: UserInputReceivedData) => void | Promise<void>;
}

export interface UserInputConsumedData {
  readonly content: string;
}

export interface PublishOrchestratorUserInputConsumed {
  readonly topicName: 'orchestrator/user-input-consumed';
  readonly data: UserInputConsumedData;
}

export interface SubscribeOrchestratorUserInputConsumed {
  readonly topicName: PublishOrchestratorUserInputConsumed['topicName'];
  readonly receiver: (data: UserInputConsumedData) => void | Promise<void>;
}

export interface NodeStatsEntry {
  readonly nodeId: string;
  readonly stats: NodeStats;
}

export interface NodeStatsUpdatedData {
  readonly nodeStats: NodeStatsEntry[];
}

export interface PublishOrchestratorNodeStatsUpdated {
  readonly topicName: 'orchestrator/node-stats-updated';
  readonly data: NodeStatsUpdatedData;
}

export interface SubscribeOrchestratorNodeStatsUpdated {
  readonly topicName: PublishOrchestratorNodeStatsUpdated['topicName'];
  readonly receiver: (data: NodeStatsUpdatedData) => void | Promise<void>;
}

export type PublishProps =
  | PublishSystemNotice
  | PublishOrchestratorNodesChanged
  | PublishOrchestratorNodeAdded
  | PublishOrchestratorNodeRemoved
  | PublishOrchestratorNodeUpdated
  | PublishOrchestratorWorkingMemoryUpdated
  | PublishOrchestratorUserInputReceived
  | PublishOrchestratorUserInputConsumed
  | PublishOrchestratorNodeStatsUpdated
  | PublishNodeStatusChange
  | PublishToolInvocationStarted
  | PublishToolInvocationCompleted
  | PublishGoalUpdated;

export type SubscribeProps =
  | SubscribeSystemNotice
  | SubscribeOrchestratorNodesChanged
  | SubscribeOrchestratorNodeAdded
  | SubscribeOrchestratorNodeRemoved
  | SubscribeOrchestratorNodeUpdated
  | SubscribeOrchestratorWorkingMemoryUpdated
  | SubscribeOrchestratorUserInputReceived
  | SubscribeOrchestratorUserInputConsumed
  | SubscribeOrchestratorNodeStatsUpdated
  | SubscribeNodeStatusChange
  | SubscribeToolInvocationStarted
  | SubscribeToolInvocationCompleted
  | SubscribeGoalUpdated;

export type Topics = PublishProps['topicName'];

export interface EventStream {
  readonly publish: (props: PublishProps) => void;
  readonly subscribe: (props: SubscribeProps) => void;
  /** Subscribe to every event; used by the durable event log consumer. */
  readonly subscribeAll?: (receiver: (props: PublishProps) => void) => void;
  /** Publish a recoverable failure to Legion's dedicated error stream. */
  readonly reportError?: (report: ErrorReport) => void;
}
