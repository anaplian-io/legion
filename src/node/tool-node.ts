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
import { createToolOutputPreview } from '../utilities/tool-output-preview.js';
import { Message } from '../types/message.js';

export interface ToolNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly mcpClient: MCPClient;
  readonly relevanceGate: RelevanceGate;
  readonly capabilityDescription: string;
  /** Tools fetched at boot while generating the MCP capability summary. */
  readonly initialTools?: readonly ToolDefinition[];
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
    this.tools = [...(props.initialTools ?? [])];
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
    // Expose only requests addressed to this node during generation. The
    // relevance gate still receives the original broadcast for routing.
    const targetedRequests = broadcastMessage.broadcast.actionRequests?.filter(
      (request) => request.targetNodeId === this.id,
    );
    const broadcast: Message = {
      role: broadcastMessage.broadcast.role,
      content: broadcastMessage.broadcast.content,
      ...(broadcastMessage.broadcast.originatingNodeId === undefined
        ? {}
        : {
            originatingNodeId: broadcastMessage.broadcast.originatingNodeId,
          }),
      ...(broadcastMessage.broadcast.contributingNodeIds === undefined
        ? {}
        : {
            contributingNodeIds: broadcastMessage.broadcast.contributingNodeIds,
          }),
      ...(targetedRequests === undefined || targetedRequests.length === 0
        ? {}
        : { actionRequests: targetedRequests }),
    };
    const messages = [...broadcastMessage.workingMemory.messages, broadcast];
    const nodeBroadcastMessage: BroadcastMessage = {
      ...broadcastMessage,
      broadcast,
    };
    this.setStatus('evaluating-relevance');
    const relevant = this.props.relevanceGate.isRelevant({
      broadcastMessage: nodeBroadcastMessage,
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
      systemPrompt: `${this.preamble}\nYou MUST make a tool call.`,
      tools: this.tools,
    });
    if (!response.toolCalls || response.toolCalls.length === 0) {
      this.setStatus('idle');
      return undefined;
    }
    const toolCallResponse = await Promise.all(
      response.toolCalls.map(async (call) => {
        this.props.eventStream.publish({
          topicName: 'tool/invocation-started',
          data: {
            nodeId: this.id,
            callId: call.id,
            toolName: call.function.name,
            arguments: call.function.arguments,
          },
        });
        try {
          const result = await mcpClient.invokeTool(
            call.id,
            call.function.name,
            call.function.arguments,
          );
          this.props.eventStream.publish({
            topicName: 'tool/invocation-completed',
            data: {
              nodeId: this.id,
              callId: call.id,
              toolName: call.function.name,
              success: result.success,
              output: createToolOutputPreview(
                result.success ? result.result : result.error,
              ),
            },
          });
          return result;
        } catch (e) {
          this.props.eventStream.reportError?.({
            source: `ToolNode ${this.id}`,
            message: `Tool ${call.function.name} threw during invocation.`,
            error: e,
            metadata: { callId: call.id, toolName: call.function.name },
          });
          const failure = {
            callId: call.id,
            name: call.function.name,
            success: false,
            error: `${e}`,
          } satisfies ToolResult;
          this.props.eventStream.publish({
            topicName: 'tool/invocation-completed',
            data: {
              nodeId: this.id,
              callId: call.id,
              toolName: call.function.name,
              success: false,
              output: createToolOutputPreview(`${e}`),
            },
          });
          return failure;
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
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: 'Failed to publish a node status change.',
        error: e,
      });
    }
  };

  public get preamble(): string {
    return `You are a tool invocation node in a collective reasoning system. You contribute only by invoking tools when a broadcast names a task one of your tools can resolve.

Your node ID: ${this.id}
Your capability: ${this.capabilityDescription}

Your available tools:
${this.tools.map((tool) => JSON.stringify(tool)).join('\n')}
`;
  }
}
