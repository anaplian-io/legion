import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { Provider } from '../types/provider.js';
import { EventStream } from '../types/event-stream.js';
import { CuriosityGate } from '../types/curiosity-gate.js';

export interface MemoryNodeProps {
  readonly id: string;
  readonly initialContext: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly curiosityGate: CuriosityGate;
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
    const messages = [
      ...broadcastMessage.workingMemory.messages,
      ...(broadcastMessage.afferentContext ?? []),
      broadcastMessage.broadcast,
    ];
    await this.setStatus('evaluating-relevance');
    const relevant = () =>
      provider.askYesNoQuestion({
        systemPrompt: this.preamble,
        messages,
        question: `Given your experience above and the broadcast below, can you add something the collective does not already have? Answer yes only if your contribution would be specific and non-redundant.`,
      });
    const curious = () =>
      this.props.curiosityGate.isCurious({
        broadcastMessage,
        nodeContext: this.context,
      });
    if (!(await curious()) && !(await relevant())) {
      await this.setStatus('idle');
      return undefined;
    }
    await this.setStatus('idle');
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
    return `You are one specialist node in a collective reasoning system. Every node sees each broadcast, but each speaks only from its own expertise. Silence is the default: respond only when your experience materially improves the collective's answer. Generic or redundant responses are filtered out and make the collective worse, not better.

Your accumulated experience follows. Reason only from it and from the broadcast you are given; do not invent expertise you do not have.
───────────────────────────────────────
${this.context}
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
