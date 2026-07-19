import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { Provider } from '../types/provider.js';
import { Sensor } from '../types/sensor.js';
import { MessageRole } from '../types/message.js';

export interface SensoryNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly sensor: Sensor;
  readonly capabilityDescription: string;
  readonly responseRole?: MessageRole;
}
export class SensoryNode implements Node<'sensory'> {
  public readonly kind = 'sensory' as const;
  public readonly id: string;
  public readonly capabilityDescription: string;
  private _nodeStatus: NodeStatus = 'idle';

  constructor(private readonly props: SensoryNodeProps) {
    this.id = props.id;
    this.capabilityDescription = props.capabilityDescription;
  }

  public get context(): string {
    return '';
  }

  public get status(): NodeStatus {
    return this._nodeStatus;
  }

  public readonly sendMessage = async (
    broadcastMessage: BroadcastMessage,
  ): Promise<NodeResponse> => {
    const { sensor } = this.props;
    await this.setStatus('generating');
    let content: string;
    try {
      content = await sensor.sense(broadcastMessage);
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `SensoryNode ${this.id}`,
        message: 'Sensor failed while sensing a broadcast.',
        error,
      });
      await this.setStatus('idle');
      return undefined;
    }
    if (content.trim().length === 0) {
      await this.setStatus('idle');
      return undefined;
    }
    const response: NodeResponse = {
      role: this.props.responseRole ?? 'afferent',
      originatingNodeId: this.id,
      content,
    };
    await this.setStatus('idle');
    return response;
  };

  private readonly setStatus = async (newStatus: NodeStatus): Promise<void> => {
    this._nodeStatus = newStatus;
    try {
      this.props.eventStream.publish({
        topicName: 'node/status-change',
        data: { nodeId: this.id, status: newStatus },
      });
    } catch (e) {
      this.props.eventStream.reportError?.({
        source: `SensoryNode ${this.id}`,
        message: 'Failed to publish a node status change.',
        error: e,
      });
    }
  };
}
