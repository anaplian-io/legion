import { Node, NodeStatus } from './node.js';
import { WorkingMemory } from './working-memory.js';
import { Message } from './message.js';

export interface NodeStatusChangeData {
  readonly nodeId: string;
  readonly status: NodeStatus;
}

export interface PublishNodeStatusChange {
  readonly topicName: 'node/status-change';
  readonly data: NodeStatusChangeData;
}

export interface SubscribeNodeStatusChange {
  readonly topicName: PublishNodeStatusChange['topicName'];
  readonly receiver: (data: NodeStatusChangeData) => void | Promise<void>;
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

export type PublishProps =
  | PublishOrchestratorNodesChanged
  | PublishOrchestratorNodeAdded
  | PublishOrchestratorNodeRemoved
  | PublishOrchestratorNodeUpdated
  | PublishOrchestratorWorkingMemoryUpdated
  | PublishNodeStatusChange;

export type SubscribeProps =
  | SubscribeOrchestratorNodesChanged
  | SubscribeOrchestratorNodeAdded
  | SubscribeOrchestratorNodeRemoved
  | SubscribeOrchestratorNodeUpdated
  | SubscribeOrchestratorWorkingMemoryUpdated
  | SubscribeNodeStatusChange;

export type Topics = PublishProps['topicName'];

export interface EventStream {
  readonly publish: (props: PublishProps) => void;
  readonly subscribe: (props: SubscribeProps) => void;
}
