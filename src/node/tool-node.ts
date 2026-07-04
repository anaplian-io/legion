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
import { RelevanceGate } from '../types/relevance-gate.js';

export interface ToolNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly mcpClient: MCPClient;
  readonly relevanceGate: RelevanceGate;
  readonly capabilityDescription: string;
}

export class ToolNode implements Node<'tool'> {
  public readonly kind = 'tool' as const;
  public readonly id: string;
  public readonly capabilityDescription: string;
  private _nodeStatus: NodeStatus = 'idle';
  private readonly mcpClient: MCPClient;
  private tools: ToolDefinition[] = [];

  constructor(private readonly props: ToolNodeProps) {
    this.id = props.id;
    this.capabilityDescription = props.capabilityDescription;
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
    // Shared between the relevance check and the tool-calling generation so
    // both present an identical [tools preamble][working memory][broadcast]
    // prefix, maximizing prompt-cache reuse.
    const messages = [
      ...broadcastMessage.workingMemory.messages,
      broadcastMessage.broadcast,
    ];
    this.setStatus('evaluating-relevance');
    const relevant = this.props.relevanceGate.isRelevant({
      broadcastMessage,
      nodeId: this.id,
      epochsAlive: broadcastMessage.recipientNodeStats?.epochsAlive ?? 0,
      nodeContext: this.preamble,
    });
    if (!(await relevant)) {
      this.setStatus('idle');
      return undefined;
    }
    this.setStatus('idle');
    this.setStatus('generating');
    const response = await provider.generateWithTools({
      messages,
      systemPrompt: `You are a tool invocation node. Use the available tools to act on the broadcast. You MUST make a tool call.`,
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
      role: 'afferent',
      originatingNodeId: this.id,
      content: JSON.stringify(toolCallResponse),
    };
  };

  private readonly setStatus = (newStatus: NodeStatus): void => {
    this._nodeStatus = newStatus;
    try {
      this.props.eventStream.publish({
        topicName: 'node/status-change',
        data: { nodeId: this.id, status: newStatus },
      });
    } catch (e) {
      console.warn(
        `[ToolNode ${this.id}] event publish threw during execution: ${e}`,
      );
    }
  };

  public get preamble(): string {
    return `You are a tool node in a collective reasoning system. You contribute only by invoking tools when a broadcast names a task one of your tools can resolve.

Your available tools:
${this.tools.map((tool) => JSON.stringify(tool)).join('\n')}
`;
  }
}
