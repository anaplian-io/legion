import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { Provider } from '../types/provider.js';
import { ToolDefinition, GenerateWithToolsProps } from '../types/tool.js';
import { MCPClient } from '../mcp/mcp-client.js';

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
    const { provider } = this.props;
    await this.setStatus('generating');

    const systemPrompt = `You are a tool invocation node. Use the available tools to process the broadcast message.

Available working memory:
${broadcastMessage.workingMemory.messages.map((m, i) => `[MESSAGE ${i}]: ${m.content}`).join('\n')}

New broadcast: ${broadcastMessage.broadcast.content}
`;

    const messages: GenerateWithToolsProps['messages'] = [
      { content: broadcastMessage.broadcast.content },
    ];

    let responseContent = '';
    let toolCalls = undefined;

    try {
      const result = await provider.generateWithTools({
        systemPrompt,
        messages,
        tools: this.tools,
      });
      responseContent = result.content;
      toolCalls = result.toolCalls;
    } catch (error) {
      console.error(`[ToolNode ${this.id}]: error getting tool calls:`, error);
      await this.setStatus('idle');
      return undefined;
    }

    if (toolCalls && toolCalls.length > 0) {
      const toolResults: GenerateWithToolsProps['messages'] = [];
      for (const toolCall of toolCalls) {
        const result = await this.mcpClient.invokeTool(
          toolCall.id,
          toolCall.function.name,
          toolCall.function.arguments,
        );
        if (result.success) {
          toolResults.push({
            originatingNodeId: this.id,
            content: JSON.stringify(result.result),
          });
        } else {
          toolResults.push({
            originatingNodeId: this.id,
            content: JSON.stringify({ error: result.error }),
          });
        }
      }
      const finalMessages: GenerateWithToolsProps['messages'] = [
        { content: broadcastMessage.broadcast.content },
        ...toolResults,
      ];
      try {
        const finalResult = await provider.generateWithTools({
          systemPrompt,
          messages: finalMessages,
          tools: this.tools,
        });
        responseContent = finalResult.content;
      } catch (error) {
        console.error(
          `[ToolNode ${this.id}]: error after tool execution:`,
          error,
        );
        await this.setStatus('idle');
        return undefined;
      }
    }
    const response: NodeResponse = {
      originatingNodeId: this.id,
      content: responseContent,
    };
    await this.setStatus('idle');
    return response;
  };

  private readonly setStatus = async (newStatus: NodeStatus): Promise<void> => {
    this._nodeStatus = newStatus;
    this.props.eventStream.publish({
      topicName: 'node/status-change',
      data: { nodeId: this.id, status: newStatus },
    });
  };
}
