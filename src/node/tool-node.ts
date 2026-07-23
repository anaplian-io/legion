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
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import {
  hasDefinedProperty,
  isRecord,
  isToolCall,
} from '../utilities/type-guards.js';

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
    const { provider } = this.props;
    if (this.tools.length === 0) {
      await this.initialize();
    }
    // Validate requests addressed to this node before model selection. Invalid
    // requests become failures; valid requests continue independently.
    const targetedRequests = broadcastMessage.broadcast.actionRequests?.filter(
      (request) => request.targetNodeId === this.id,
    );
    const targetedRequestValidations = (targetedRequests ?? []).map(
      (request) => ({
        request,
        error: this.validateToolSelection(request.operation, request.arguments),
      }),
    );
    const invalidTargetedRequests = targetedRequestValidations.filter(
      hasDefinedProperty('error'),
    );
    const validTargetedRequests = targetedRequestValidations
      .filter(({ error }) => error === undefined)
      .map(({ request }) => request);
    let preflightFailures: ToolResult[] = [];
    if (invalidTargetedRequests.length > 0) {
      this.setStatus('generating');
      preflightFailures = invalidTargetedRequests.map(({ request, error }) =>
        this.rejectToolCall(
          request.id,
          request.operation,
          JSON.stringify(request.arguments),
          error,
        ),
      );
      this.setStatus('idle');
      if (validTargetedRequests.length === 0) {
        return this.toolResponse(preflightFailures);
      }
    }
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
      ...(validTargetedRequests.length === 0
        ? {}
        : { actionRequests: validTargetedRequests }),
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
      return preflightFailures.length === 0
        ? undefined
        : this.toolResponse(preflightFailures);
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
      return preflightFailures.length === 0
        ? undefined
        : this.toolResponse(preflightFailures);
    }
    const toolCallResponse = await Promise.all(
      response.toolCalls.map((call) => this.invokeProviderToolCall(call)),
    );
    this.setStatus('idle');
    return this.toolResponse([...preflightFailures, ...toolCallResponse]);
  };

  private readonly invokeProviderToolCall = async (
    call: unknown,
  ): Promise<ToolResult> => {
    if (!isToolCall(call)) {
      const details = malformedToolCallDetails(call);
      return this.rejectToolCall(
        details.callId,
        details.name,
        details.arguments,
        `Provider returned a malformed tool call: ${createToolOutputPreview(call)}`,
      );
    }
    const { id: callId, function: functionCall } = call;
    const { name, arguments: argumentsStr } = functionCall;
    this.publishInvocationStarted(callId, name, argumentsStr);

    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(argumentsStr) as unknown;
    } catch {
      return this.rejectStartedToolCall(
        callId,
        name,
        `Tool ${name} arguments are not valid JSON.`,
      );
    }

    const validationError = this.validateToolSelection(name, parsedArguments);
    if (validationError !== undefined) {
      return this.rejectStartedToolCall(callId, name, validationError);
    }

    try {
      const result = await this.props.mcpClient.invokeTool(
        callId,
        name,
        argumentsStr,
      );
      this.publishInvocationCompleted(
        callId,
        name,
        result.success,
        result.success ? result.result : result.error,
      );
      return result;
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: `Tool ${name} threw during invocation.`,
        error,
        metadata: { callId, toolName: name },
      });
      const errorMessage = String(error);
      this.publishInvocationCompleted(callId, name, false, errorMessage);
      return {
        callId,
        name,
        success: false,
        error: errorMessage,
      };
    }
  };

  private readonly validateToolSelection = (
    name: string,
    argumentsValue: unknown,
  ): string | undefined => {
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (tool === undefined) {
      const available = this.tools
        .map((candidate) => candidate.name)
        .join(', ');
      return `Tool ${name} was not advertised by ToolNode ${this.id}. Available tools: ${available}.`;
    }
    if (!isRecord(argumentsValue)) {
      return `Tool ${name} arguments must be a JSON object.`;
    }
    try {
      const validation = new AjvJsonSchemaValidator().getValidator(
        tool.parameters,
      )(argumentsValue);
      return validation.valid
        ? undefined
        : `Tool ${name} arguments do not match its advertised schema: ${validation.errorMessage}.`;
    } catch (error) {
      return `Tool ${name} has an invalid advertised schema: ${String(error)}.`;
    }
  };

  private readonly rejectToolCall = (
    callId: string,
    name: string,
    argumentsStr: string,
    error: string,
  ): ToolResult => {
    this.publishInvocationStarted(callId, name, argumentsStr);
    return this.rejectStartedToolCall(callId, name, error);
  };

  private readonly rejectStartedToolCall = (
    callId: string,
    name: string,
    error: string,
  ): ToolResult => {
    this.props.eventStream.reportError?.({
      source: `ToolNode ${this.id}`,
      message: `Rejected tool ${name} before MCP invocation.`,
      error: new Error(error),
      metadata: { callId, toolName: name },
    });
    this.publishInvocationCompleted(callId, name, false, error);
    return { callId, name, success: false, error };
  };

  private readonly publishInvocationStarted = (
    callId: string,
    toolName: string,
    argumentsStr: string,
  ): void => {
    this.props.eventStream.publish({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: this.id,
        callId,
        toolName,
        arguments: argumentsStr,
      },
    });
  };

  private readonly publishInvocationCompleted = (
    callId: string,
    toolName: string,
    success: boolean,
    output: unknown,
  ): void => {
    this.props.eventStream.publish({
      topicName: 'tool/invocation-completed',
      data: {
        nodeId: this.id,
        callId,
        toolName,
        success,
        output: createToolOutputPreview(output),
      },
    });
  };

  private readonly toolResponse = (
    results: readonly ToolResult[],
  ): Exclude<NodeResponse, undefined> => ({
    role: 'afferent',
    originatingNodeId: this.id,
    content: JSON.stringify(results),
  });

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

const malformedToolCallDetails = (
  call: unknown,
): {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
} => {
  const callRecord = isRecord(call) ? call : {};
  const functionCall = isRecord(callRecord['function'])
    ? callRecord['function']
    : {};
  return {
    callId:
      typeof callRecord['id'] === 'string'
        ? callRecord['id']
        : '[missing-call-id]',
    name:
      typeof functionCall['name'] === 'string'
        ? functionCall['name']
        : '[missing-tool-name]',
    arguments:
      typeof functionCall['arguments'] === 'string'
        ? functionCall['arguments']
        : createToolOutputPreview(functionCall['arguments']),
  };
};
