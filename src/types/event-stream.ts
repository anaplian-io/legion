import { Node, NodeStatus } from './node.js';

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

export type PublishProps =
  | PublishOrchestratorNodesChanged
  | PublishNodeStatusChange;

export type SubscribeProps =
  | SubscribeOrchestratorNodesChanged
  | SubscribeNodeStatusChange;

export type Topics = PublishProps['topicName'];

export interface EventStream {
  readonly publish: (props: PublishProps) => void;
  readonly subscribe: (props: SubscribeProps) => void;
}
