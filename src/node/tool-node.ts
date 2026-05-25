import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { Provider } from '../types/provider.js';
import { ToolDefinition } from '../types/tool.js';
import { MCPClient, ToolResult } from '../adapter/mcp-client.js';

export interface ToolNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly mcpClient: MCPClient;
}

export class ToolNode implements Node<'tool'> {
  public readonly kind = 'tool' as const;
  public readonly id: string;
  private _nodeStatus: NodeStatus = 'idle';
  private readonly mcpClient: MCPClient;
  private tools: ToolDefinition[] = [];

  constructor(private readonly props: ToolNodeProps) {
    this.id = props.id;
    this.mcpClient = props.mcpClient;
  }

  /**
   * Initialize the node by fetching tools from the MCP server
   */
  public readonly initialize = async (): Promise<void> => {
    this.tools = await this.mcpClient.getAvailableTools();
  };

  public get context(): string {
    return '';
  }

  public get status(): NodeStatus {
    return this._nodeStatus;
  }

  public readonly sendMessage = async (
    broadcastMessage: BroadcastMessage,
  ): Promise<NodeResponse> => {
    const { provider, mcpClient } = this.props;
    if (this.tools.length === 0) {
      await this.initialize();
    }
    const concatenatedBroadcast =
      broadcastMessage.workingMemory.messages.map(
        (message, index) =>
          `[WORKING MEMORY MESSAGE ${index}]:${message.content}\n`,
      ) + `[NEW BROADCAST MESSAGE]:${broadcastMessage.broadcast.content}`;
    this.setStatus('evaluating-relevance');
    const relevant = await provider.askYesNoQuestion(`${this.preamble}

    New Information: ${concatenatedBroadcast}

    Question: Will one or more of your tools help resolve the above information?`);
    if (!relevant) {
      this.setStatus('idle');
      return undefined;
    }
    const messages = [
      ...broadcastMessage.workingMemory.messages,
      broadcastMessage.broadcast,
    ];
    this.setStatus('generating');
    const systemPrompt = `You are a tool invocation node. Use the available tools to process the broadcast message.
You MUST make a tool call.

Available working memory:
${broadcastMessage.workingMemory.messages.map((m, i) => `[MESSAGE ${i}]: ${m.content}`).join('\n')}

New broadcast: ${broadcastMessage.broadcast.content}
`;
    const response = await provider.generateWithTools({
      messages,
      systemPrompt,
      tools: this.tools,
    });
    if (!response.toolCalls || response.toolCalls.length === 0) {
      this.setStatus('idle');
      return undefined;
    }
    const toolCallResponse = await Promise.all(
      response.toolCalls.map(async (call) => {
        try {
          return await mcpClient.invokeTool(
            call.id,
            call.function.name,
            call.function.arguments,
          );
        } catch (e) {
          return {
            callId: call.id,
            name: call.function.name,
            success: false,
            error: `${e}`,
          } satisfies ToolResult;
        }
      }),
    );
    this.setStatus('idle');
    return {
      originatingNodeId: this.id,
      content: JSON.stringify(toolCallResponse),
    };
  };

  private readonly setStatus = (newStatus: NodeStatus): void => {
    this._nodeStatus = newStatus;
    this.props.eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: this.id, status: newStatus },
    });
  };

  public get preamble(): string {
    return `You will have the following tools available:
    ${this.tools.map((tool) => JSON.stringify(tool)).join('\n')}
    
    Pay attention to whether the provided information below is a query that you will
    be able to use one of your tools to resolve.
    `;
  }
}
