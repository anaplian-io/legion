import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { Provider } from '../types/provider.js';
import { ToolCall, ToolDefinition } from '../types/tool.js';
import { MCPClient, ToolResult } from '../adapter/mcp-client.js';
import { createToolOutputPreview } from '../utilities/tool-output-preview.js';
import { ActionRequest } from '../types/message.js';
import { isToolCall } from '../utilities/type-guards.js';

export interface ToolNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly mcpClient: MCPClient;
  readonly capabilityDescription: string;
  /** Tools fetched at boot while generating the MCP capability summary. */
  readonly initialTools?: readonly ToolDefinition[];
}

export interface ToolNodeOutcome {
  readonly requestId: string;
  readonly stage: 'elaboration' | 'mcp';
  readonly success: boolean;
  readonly callId?: string;
  readonly name?: string;
  readonly result?: unknown;
  readonly error?: string;
}

export class ToolNode implements Node<'tool'> {
  public readonly kind = 'tool' as const;
  public readonly id: string;
  public readonly capabilityDescription: string;
  private _nodeStatus: NodeStatus = 'idle';
  private readonly systemPrompt: string;
  private tools: ToolDefinition[];
  private initialized: boolean;

  constructor(private readonly props: ToolNodeProps) {
    this.id = props.id;
    this.capabilityDescription = props.capabilityDescription;
    this.tools = [...(props.initialTools ?? [])];
    this.initialized = props.initialTools !== undefined;
    this.systemPrompt = `You are a tool invocation node in a collective reasoning system. You receive one structured intent already routed to your exact node ID.

Your node ID: ${this.id}
Your capability: ${this.capabilityDescription}

Translate the intent into one or more calls to the supplied MCP tools. You must make at least one tool call. The request's operation and arguments are non-authoritative hints: they may be incomplete, stale, or wrong, so repair or ignore them using the supplied tool definitions. Choose the concrete tool and arguments yourself. MCP owns final validation and will return any execution failure to the collective.`;
  }

  /** Refresh the tools advertised by the MCP server. */
  public readonly initialize = async (): Promise<void> => {
    this.tools = await this.props.mcpClient.getAvailableTools();
    this.initialized = true;
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
    const targetedRequests =
      broadcastMessage.broadcast.actionRequests?.filter(
        (request) => request.targetNodeId === this.id,
      ) ?? [];
    if (targetedRequests.length === 0) {
      return undefined;
    }

    try {
      if (!this.initialized) {
        await this.initialize();
      }
    } catch (error) {
      this.reportElaborationError(
        'Failed to load tools before elaborating targeted intents.',
        error,
      );
      return this.toolResponse(
        targetedRequests.map((request) =>
          this.elaborationFailure(
            request.id,
            `ToolNode ${this.id} could not load its MCP tools: ${errorMessage(error)}`,
          ),
        ),
      );
    }

    return this.withStatus('generating', async () => {
      if (this.tools.length === 0) {
        return this.toolResponse(
          targetedRequests.map((request) =>
            this.elaborationFailure(
              request.id,
              `ToolNode ${this.id} has no available MCP tools.`,
            ),
          ),
        );
      }
      const outcomes = await Promise.all(
        targetedRequests.map((request) => this.elaborateAndInvoke(request)),
      );
      return this.toolResponse(outcomes.flat());
    });
  };

  private readonly elaborateAndInvoke = async (
    request: ActionRequest,
  ): Promise<ToolNodeOutcome[]> => {
    const messages = [
      {
        role: 'tool-intent' as const,
        content: '',
        actionRequests: [request],
      },
    ];
    let response: Awaited<ReturnType<Provider['generateWithTools']>>;
    try {
      response = await this.props.provider.generateWithTools({
        messages,
        systemPrompt: this.preamble,
        tools: this.tools,
        toolChoice: 'required',
      });
    } catch (error) {
      this.reportElaborationError(
        `Failed to elaborate action request ${request.id}.`,
        error,
        request.id,
      );
      return [
        this.elaborationFailure(
          request.id,
          `ToolNode ${this.id} could not elaborate the intent: ${errorMessage(error)}`,
        ),
      ];
    }

    if (response.toolCalls === undefined || response.toolCalls.length === 0) {
      const explanation = response.content.trim();
      return [
        this.elaborationFailure(
          request.id,
          explanation.length === 0
            ? `ToolNode ${this.id} returned neither a tool call nor an explanation for the intent.`
            : `ToolNode ${this.id} could not fulfill the intent: ${createToolOutputPreview(explanation)}`,
        ),
      ];
    }

    const calls = response.toolCalls.filter(isToolCall);
    if (calls.length !== response.toolCalls.length) {
      const malformedCall = response.toolCalls.find(
        (call) => !isToolCall(call),
      );
      const error = `Provider returned a malformed tool call: ${createToolOutputPreview(malformedCall)}`;
      this.reportElaborationError(
        `Rejected malformed output for action request ${request.id}.`,
        new Error(error),
        request.id,
      );
      return [this.elaborationFailure(request.id, error)];
    }

    this.publishElaborationCompleted(
      request.id,
      true,
      calls.map((call) => ({
        callId: call.id,
        toolName: call.function.name,
      })),
      response.content,
    );
    return Promise.all(
      calls.map((call) => this.invokeProviderToolCall(request, call)),
    );
  };

  private readonly invokeProviderToolCall = async (
    request: ActionRequest,
    call: ToolCall,
  ): Promise<ToolNodeOutcome> => {
    const { id: callId, function: functionCall } = call;
    const { name, arguments: argumentsStr } = functionCall;
    this.publishInvocationStarted(request.id, callId, name, argumentsStr);

    let result: ToolResult;
    try {
      result = await this.props.mcpClient.invokeTool(
        callId,
        name,
        argumentsStr,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: `Tool ${name} threw during invocation.`,
        error,
        metadata: { requestId: request.id, callId, toolName: name },
      });
      result = { callId, name, success: false, error: message };
    }

    this.publishInvocationCompleted(
      request.id,
      callId,
      name,
      result.success,
      result.success ? result.result : result.error,
    );
    return {
      requestId: request.id,
      stage: 'mcp',
      ...result,
    };
  };

  private readonly elaborationFailure = (
    requestId: string,
    error: string,
  ): ToolNodeOutcome => {
    this.publishElaborationCompleted(requestId, false, [], error);
    return {
      requestId,
      stage: 'elaboration',
      success: false,
      error,
    };
  };

  private readonly reportElaborationError = (
    message: string,
    error: unknown,
    requestId?: string,
  ): void => {
    this.props.eventStream.reportError?.({
      source: `ToolNode ${this.id}`,
      message,
      error,
      ...(requestId === undefined ? {} : { metadata: { requestId } }),
    });
  };

  private readonly publishInvocationStarted = (
    requestId: string,
    callId: string,
    toolName: string,
    argumentsStr: string,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'tool/invocation-started',
        data: {
          nodeId: this.id,
          requestId,
          callId,
          toolName,
          arguments: argumentsStr,
        },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: 'Failed to publish a tool invocation start event.',
        error,
        metadata: { requestId, callId, toolName },
      });
    }
  };

  private readonly publishElaborationCompleted = (
    requestId: string,
    success: boolean,
    toolCalls: readonly {
      readonly callId: string;
      readonly toolName: string;
    }[],
    output: unknown,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'tool/elaboration-completed',
        data: {
          nodeId: this.id,
          requestId,
          success,
          toolCalls,
          output: createToolOutputPreview(output),
        },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: 'Failed to publish a tool elaboration completion event.',
        error,
        metadata: { requestId },
      });
    }
  };

  private readonly publishInvocationCompleted = (
    requestId: string,
    callId: string,
    toolName: string,
    success: boolean,
    output: unknown,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          requestId,
          callId,
          toolName,
          success,
          output: createToolOutputPreview(output),
        },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: 'Failed to publish a tool invocation completion event.',
        error,
        metadata: { requestId, callId, toolName },
      });
    }
  };

  private readonly toolResponse = (
    outcomes: readonly ToolNodeOutcome[],
  ): Exclude<NodeResponse, undefined> => ({
    role: 'afferent',
    originatingNodeId: this.id,
    content: JSON.stringify(outcomes),
  });

  private readonly withStatus = async <T>(
    status: Exclude<NodeStatus, 'idle'>,
    operation: () => Promise<T>,
  ): Promise<T> => {
    this.setStatus(status);
    try {
      return await operation();
    } finally {
      this.setStatus('idle');
    }
  };

  private readonly setStatus = (newStatus: NodeStatus): void => {
    this._nodeStatus = newStatus;
    try {
      this.props.eventStream.publish({
        topicName: 'node/status-change',
        data: { nodeId: this.id, status: newStatus },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.id}`,
        message: 'Failed to publish a node status change.',
        error,
      });
    }
  };

  public get preamble(): string {
    return this.systemPrompt;
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
