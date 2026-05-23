import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { Provider } from '../types/provider.js';

export class MemoryNode implements Node<'memory'> {
  public readonly id: string;
  private _context: string;
  private _nodeStatus: NodeStatus = 'idle';

  constructor({
    id,
    initialContext,
    provider,
  }: {
    readonly id: string;
    readonly initialContext: string;
    readonly provider: Provider;
  }) {
    this.id = id;
    this._context = initialContext;
    this._provider = provider;
  }

  private readonly _provider: Provider;

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
    const { _provider: provider } = this;
    const concatenatedBroadcast =
      broadcastMessage.workingMemory.messages.map(
        (message, index) =>
          `[WORKING MEMORY MESSAGE ${index}]:${message.content}\n`,
      ) + `[NEW BROADCAST MESSAGE]:${broadcastMessage.broadcast.content}`;
    this._nodeStatus = 'evaluating-relevance';
    const relevant = await provider.askYesNoQuestion(`${this.preamble}

    New Information: ${concatenatedBroadcast}

    Question: Is your experience relevant to this new information?`);
    this._nodeStatus = 'idle';
    if (!relevant) {
      return undefined;
    }
    const messages = [
      ...broadcastMessage.workingMemory.messages,
      broadcastMessage.broadcast,
    ];
    this._nodeStatus = 'generating';
    const response: NodeResponse = {
      originatingNodeId: this.id,
      content: await provider.generate({
        messages,
        systemPrompt: this.preamble,
      }),
    };
    this._nodeStatus = 'idle';
    this._context =
      this._context +
      `\n\n` +
      `[BROADCAST MESSAGE]:${broadcastMessage.broadcast.content}` +
      `[NODE RESPONSE]:${response.content}`;
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
}
