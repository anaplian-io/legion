import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { Provider } from '../types/provider.js';
import { EventStream } from '../types/event-stream.js';

export interface MemoryNodeProps {
  readonly id: string;
  readonly initialContext: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
}

export class MemoryNode implements Node<'memory'> {
  public readonly id: string;
  private _context: string;
  private _nodeStatus: NodeStatus = 'idle';

  constructor(private readonly props: MemoryNodeProps) {
    this.id = this.props.id;
    this._context = this.props.initialContext;
  }

  public readonly kind = 'memory' as const;

  public get context(): string {
    return this._context;
  }

  public get status(): NodeStatus {
    return this._nodeStatus;
  }

  public readonly sendMessage = async (
    broadcastMessage: BroadcastMessage,
  ): Promise<NodeResponse> => {
    const { provider } = this.props;
    const concatenatedBroadcast =
      broadcastMessage.workingMemory.messages
        .map(
          (message, index) =>
            `[WORKING MEMORY MESSAGE ${index}]:${message.content}\n`,
        )
        .join('') +
      `[NEW BROADCAST MESSAGE]:${broadcastMessage.broadcast.content}`;
    await this.setStatus('evaluating-relevance');
    const relevant = await provider.askYesNoQuestion(`${this.preamble}

    New Information: ${concatenatedBroadcast}

    Question: Is your experience relevant to this new information?`);
    await this.setStatus('idle');
    if (!relevant) {
      return undefined;
    }
    const messages = [
      ...broadcastMessage.workingMemory.messages,
      broadcastMessage.broadcast,
    ];
    await this.setStatus('generating');
    const response: NodeResponse = {
      originatingNodeId: this.id,
      content: await provider.generate({
        messages,
        systemPrompt: this.preamble,
      }),
    };
    await this.setStatus('idle');
    this._context =
      this._context +
      `\n\n` +
      `[BROADCAST MESSAGE]:${broadcastMessage.broadcast.content}` +
      `[NODE RESPONSE]:${response.content}`;
    this.props.eventStream.publish({
      topicName: 'orchestrator/node-updated',
      data: { node: this },
    });
    return response;
  };

  public get preamble(): string {
    return `You are a single memory and processing node of a larger
processing system that specializes in a given set of areas. You prefer to
weigh in on queries related to your core experience, but you may choose
to weigh in if you believe you have something relevant to add.

This is your compiled total set of experience:
${this.context}
--------------
`;
  }

  private readonly setStatus = async (newStatus: NodeStatus): Promise<void> => {
    this._nodeStatus = newStatus;
    try {
      this.props.eventStream.publish({
        topicName: 'node/status-change',
        data: { nodeId: this.id, status: newStatus },
      });
    } catch (e) {
      console.warn(
        `[MemoryNode ${this.id}] event publish threw during execution: ${e}`,
      );
    }
  };
}
