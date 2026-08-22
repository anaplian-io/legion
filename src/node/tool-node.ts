import { classifyTelemetryError } from '../telemetry/telemetry-recorder.js';
import type { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import type { MCPClient } from '../adapter/mcp-client.js';
import type { EventStream } from '../types/event-stream.js';
import type { ActionRequest } from '../types/message.js';
import type {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
  NodeTelemetryContext,
} from '../types/node.js';
import type { Provider } from '../types/provider.js';
import type { ToolCall, ToolDefinition } from '../types/tool.js';
import type { ToolNodeOutcome } from '../types/tool-node.js';
import { errorMessage } from '../utilities/error-message.js';
import { createToolOutputPreview } from '../utilities/tool-output-preview.js';
import { ToolCallElaborator } from './support/tool-call-elaborator.js';
import { ToolCallInvoker } from './support/tool-call-invoker.js';
import { ToolNodeObserver } from './support/tool-node-observer.js';

export type { ToolNodeOutcome } from '../types/tool-node.js';

export interface ToolNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly mcpClient: MCPClient;
  readonly capabilityDescription: string;
  /** Tools fetched at boot while generating the MCP capability summary. */
  readonly initialTools?: readonly ToolDefinition[];
  readonly telemetry: TelemetryRecorder;
}

/** Coordinates routing, elaboration, invocation, and observable node state. */
export class ToolNode implements Node<'tool'> {
  public readonly kind = 'tool' as const;
  public readonly id: string;
  public readonly capabilityDescription: string;
  private _nodeStatus: NodeStatus = 'idle';
  private readonly elaborator: ToolCallElaborator;
  private readonly invoker: ToolCallInvoker;
  private readonly observer: ToolNodeObserver;
  private initialized: boolean;

  constructor(private readonly props: ToolNodeProps) {
    this.id = props.id;
    this.capabilityDescription = props.capabilityDescription;
    this.initialized = props.initialTools !== undefined;
    this.observer = new ToolNodeObserver({
      nodeId: this.id,
      eventStream: props.eventStream,
      telemetry: props.telemetry,
    });
    this.elaborator = new ToolCallElaborator({
      nodeId: this.id,
      capabilityDescription: this.capabilityDescription,
      provider: props.provider,
      ...(props.initialTools === undefined
        ? {}
        : { initialTools: props.initialTools }),
    });
    this.invoker = new ToolCallInvoker({
      nodeId: this.id,
      mcpClient: props.mcpClient,
      eventStream: props.eventStream,
      telemetry: props.telemetry,
      observer: this.observer,
    });
  }

  /** Refresh the tools advertised by the MCP server. */
  public readonly initialize = async (): Promise<void> => {
    this.elaborator.setTools(await this.props.mcpClient.getAvailableTools());
    this.initialized = true;
  };

  public get context(): string {
    return '';
  }

  public get status(): NodeStatus {
    return this._nodeStatus;
  }

  public get preamble(): string {
    return this.elaborator.preamble;
  }

  public readonly sendMessage = async (
    broadcastMessage: BroadcastMessage,
  ): Promise<NodeResponse> => {
    const requests =
      broadcastMessage.broadcast.actionRequests?.filter(
        (request) => request.targetNodeId === this.id,
      ) ?? [];
    if (requests.length === 0) {
      return undefined;
    }

    const loadingFailure = await this.ensureInitialized(
      requests,
      broadcastMessage.telemetry,
    );
    if (loadingFailure !== undefined) {
      return loadingFailure;
    }

    return this.withStatus(
      'generating',
      broadcastMessage.telemetry,
      async () => {
        if (this.elaborator.toolCount === 0) {
          return this.toolResponse(
            requests.map((request) => {
              const failure = this.elaborationFailure(
                request,
                [],
                `ToolNode ${this.id} has no available MCP tools.`,
                broadcastMessage.telemetry,
              );
              this.observer.recordElaboration(
                request.id,
                [],
                'failure',
                broadcastMessage.telemetry,
                0,
                'no-tools',
              );
              return failure;
            }),
          );
        }
        const outcomes = await Promise.all(
          requests.map((request) =>
            this.elaborateAndInvoke(request, broadcastMessage.telemetry),
          ),
        );
        return this.toolResponse(outcomes.flat());
      },
    );
  };

  private readonly ensureInitialized = async (
    requests: readonly ActionRequest[],
    telemetry: NodeTelemetryContext,
  ): Promise<Exclude<NodeResponse, undefined> | undefined> => {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      return undefined;
    } catch (error) {
      this.observer.reportElaborationError(
        'Failed to load tools before elaborating targeted intents.',
        error,
        telemetry,
      );
      return this.toolResponse(
        requests.map((request) => {
          const failure = this.elaborationFailure(
            request,
            [],
            `ToolNode ${this.id} could not load its MCP tools: ${errorMessage(error)}`,
            telemetry,
          );
          this.observer.recordElaboration(
            request.id,
            [],
            'failure',
            telemetry,
            0,
            classifyTelemetryError(error),
          );
          return failure;
        }),
      );
    }
  };

  private readonly elaborateAndInvoke = async (
    request: ActionRequest,
    telemetry: NodeTelemetryContext,
  ): Promise<ToolNodeOutcome[]> => {
    const startedAtMs = this.props.telemetry.monotonicNow();
    const result = await this.elaborator.elaborate(request, telemetry);
    if (!result.success) {
      if (result.diagnostic !== undefined) {
        this.observer.reportElaborationError(
          result.diagnostic.message,
          result.diagnostic.error,
          telemetry,
          request.id,
        );
      }
      const failure = this.elaborationFailure(
        request,
        result.calls,
        result.error,
        telemetry,
      );
      this.observer.recordElaboration(
        request.id,
        result.calls.map(({ id }) => id),
        'failure',
        telemetry,
        this.props.telemetry.durationSince(startedAtMs),
        result.errorCategory,
        result.selection,
      );
      return [failure];
    }

    this.observer.publishElaborationCompleted(
      request.id,
      true,
      toolCallData(result.calls),
      result.output,
      telemetry,
    );
    this.observer.recordElaboration(
      request.id,
      result.calls.map(({ id }) => id),
      'success',
      telemetry,
      this.props.telemetry.durationSince(startedAtMs),
      undefined,
      result.selection,
    );
    return Promise.all(
      result.calls.map((call) => this.invoker.invoke(request, call, telemetry)),
    );
  };

  private readonly elaborationFailure = (
    request: ActionRequest,
    calls: readonly ToolCall[],
    error: string,
    telemetry: NodeTelemetryContext,
  ): ToolNodeOutcome => {
    const boundedError = createToolOutputPreview(error);
    const operations = selectedOperations(calls);
    this.observer.publishElaborationCompleted(
      request.id,
      false,
      toolCallData(calls),
      boundedError,
      telemetry,
    );
    return {
      requestId: request.id,
      intent: request.intent,
      ...(operations.length === 0 ? {} : { selectedOperations: operations }),
      stage: 'elaboration',
      success: false,
      error: boundedError,
    };
  };

  private readonly toolResponse = (
    outcomes: readonly ToolNodeOutcome[],
  ): Exclude<NodeResponse, undefined> => ({
    role: 'afferent',
    originatingNodeId: this.id,
    content: JSON.stringify(outcomes.map(withoutEvidence)),
    evidence: outcomes.flatMap((outcome) =>
      outcome.evidence === undefined ? [] : [outcome.evidence],
    ),
  });

  private readonly withStatus = async <T>(
    status: Exclude<NodeStatus, 'idle'>,
    telemetry: NodeTelemetryContext,
    operation: () => Promise<T>,
  ): Promise<T> => {
    this.setStatus(status, telemetry);
    try {
      return await operation();
    } finally {
      this.setStatus('idle', telemetry);
    }
  };

  private readonly setStatus = (
    status: NodeStatus,
    telemetry: NodeTelemetryContext,
  ): void => {
    this._nodeStatus = status;
    this.observer.publishStatus(status, telemetry);
  };
}

const selectedOperations = (calls: readonly ToolCall[]): string[] => [
  ...new Set(calls.map((call) => call.function.name)),
];

const toolCallData = (
  calls: readonly ToolCall[],
): readonly { readonly callId: string; readonly toolName: string }[] =>
  calls.map((call) => ({
    callId: call.id,
    toolName: call.function.name,
  }));

const withoutEvidence = (
  outcome: ToolNodeOutcome,
): Omit<ToolNodeOutcome, 'evidence'> => {
  const {
    requestId,
    intent,
    selectedOperations: operations,
    stage,
    success,
    callId,
    name,
    result,
    error,
  } = outcome;
  return {
    requestId,
    ...(intent === undefined ? {} : { intent }),
    ...(operations === undefined ? {} : { selectedOperations: operations }),
    stage,
    success,
    ...(callId === undefined ? {} : { callId }),
    ...(name === undefined ? {} : { name }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  };
};
