import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { Provider } from '../types/provider.js';
import { EventStream } from '../types/event-stream.js';
import { RelevanceGate } from '../types/relevance-gate.js';
import {
  ACTION_REQUEST_TOOL,
  actionRequestFromToolCall,
  formatActionRequests,
  formatMessagePayload,
} from '../utilities/action-request.js';
import { isDefined } from '../utilities/type-guards.js';

export interface MemoryNodeProps {
  readonly id: string;
  readonly initialContext: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly relevanceGate: RelevanceGate;
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
    const relevant = await this.props.relevanceGate.isRelevant({
      broadcastMessage,
      nodeId: this.id,
      epochsAlive: broadcastMessage.recipientNodeStats?.epochsAlive ?? 0,
      nodeContext: this.preamble,
    });
    if (!relevant) {
      await this.setStatus('idle');
      return undefined;
    }
    await this.setStatus('idle');
    await this.setStatus('generating');
    const generated = await provider.generateWithTools({
      messages,
      systemPrompt: this.preamble,
      tools: [ACTION_REQUEST_TOOL],
      toolChoice: 'auto',
    });
    const actionRequests = (generated.toolCalls ?? [])
      .map(actionRequestFromToolCall)
      .filter(isDefined);
    if (generated.content.trim().length === 0 && actionRequests.length === 0) {
      await this.setStatus('idle');
      return undefined;
    }
    const response: NodeResponse = {
      role: 'node-response',
      originatingNodeId: this.id,
      content: generated.content,
      ...(actionRequests.length === 0 ? {} : { actionRequests }),
    };
    await this.setStatus('idle');
    this._context =
      this._context +
      `\n\n` +
      `[BROADCAST MESSAGE]:${formatMessagePayload(broadcastMessage.broadcast)}` +
      `[NODE RESPONSE]:${response.content}` +
      (response.actionRequests === undefined
        ? ''
        : `\n${formatActionRequests(response.actionRequests)}`);
    this.props.eventStream.publish({
      topicName: 'orchestrator/node-updated',
      data: { node: this },
    });
    return response;
  };

  public get preamble(): string {
    return `You are one specialist node in a collective reasoning system. Every node sees each broadcast, but each speaks only from its own expertise. Silence is the default: respond only when your experience materially improves the collective's answer. Generic or redundant responses are filtered out and make the collective worse, not better.

Default rhythm: mind your own business, stay curious about the environment, ask small grounded questions, and help the collective learn in an unstructured way.

User input is special. When an afferent message has role user-input, treat it as an interruption worth acknowledging. Help the collective briefly wrap up the current line of inquiry, address the user, and preserve enough context to resume autonomous exploration unless the user asks otherwise.

Some messages may describe available afferent capabilities such as tools or sensors. When a specific afferent node must act, use the request_node_action tool to attach a structured request; do not put fake tool calls or action JSON in prose. Copy the exact target node ID and follow its advertised operation schema. Otherwise, respond without a tool call.

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
      this.props.eventStream.reportError?.({
        source: `MemoryNode ${this.id}`,
        message: 'Failed to publish a node status change.',
        error: e,
      });
    }
  };
}
