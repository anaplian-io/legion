import { classifyTelemetryError } from '../../telemetry/telemetry-recorder.js';
import type { ActionRequest, Message } from '../../types/message.js';
import type { NodeTelemetryContext } from '../../types/node.js';
import type { Provider } from '../../types/provider.js';
import type { ToolCall, ToolDefinition } from '../../types/tool.js';
import type { ToolOperationSelection } from '../../types/tool-node.js';
import { errorMessage } from '../../utilities/error-message.js';
import { createToolOutputPreview } from '../../utilities/tool-output-preview.js';
import {
  ToolOperationResolver,
  type ToolOperationResolution,
} from './tool-operation-resolver.js';
import { validateGeneratedCalls } from './tool-call-validator.js';

interface ToolCallElaboratorProps {
  readonly nodeId: string;
  readonly capabilityDescription: string;
  readonly provider: Provider;
  readonly initialTools?: readonly ToolDefinition[];
}

export interface ElaborationDiagnostic {
  readonly message: string;
  readonly error: unknown;
}

export type ToolElaborationResult =
  | {
      readonly success: true;
      readonly calls: readonly ToolCall[];
      readonly output: string;
      readonly selection: ToolOperationSelection;
    }
  | {
      readonly success: false;
      readonly calls: readonly ToolCall[];
      readonly error: string;
      readonly errorCategory: string;
      readonly selection?: ToolOperationSelection;
      readonly diagnostic?: ElaborationDiagnostic;
    };

/** Resolves an intent once, then elaborates arguments for only that operation. */
export class ToolCallElaborator {
  private readonly systemPrompt: string;
  private readonly resolver: ToolOperationResolver;
  private tools: ToolDefinition[];

  constructor(private readonly props: ToolCallElaboratorProps) {
    this.tools = [...(props.initialTools ?? [])];
    this.resolver = new ToolOperationResolver(props);
    this.systemPrompt = `You are a tool invocation node in a collective reasoning system. You receive one structured intent already routed to your exact node ID.

Your node ID: ${props.nodeId}
Your capability: ${props.capabilityDescription}

An operation resolver has already compared the complete live MCP catalog and narrowed the supplied tools to the single operation whose advertised result best matches the authoritative intent. Translate the intent into one or more calls to that supplied operation. You must make at least one tool call.

The request's operation and arguments are non-authoritative hints: they may be incomplete, stale, or wrong. Use the authoritative intent and the supplied operation's schema to repair arguments. Do not substitute another operation.`;
  }

  public get preamble(): string {
    return this.systemPrompt;
  }

  public get toolCount(): number {
    return this.tools.length;
  }

  public readonly setTools = (tools: readonly ToolDefinition[]): void => {
    this.tools = [...tools];
  };

  public readonly elaborate = async (
    request: ActionRequest,
    telemetry: NodeTelemetryContext,
  ): Promise<ToolElaborationResult> => {
    const resolution = await this.resolve(request, telemetry);
    if (!resolution.success) {
      return resolution.failure;
    }
    if (resolution.value.outcome === 'no-applicable') {
      return failure(
        [],
        `ToolNode ${this.props.nodeId} found no advertised MCP operation that can plausibly fulfill intent ${JSON.stringify(request.intent)}.`,
        'no-applicable-tool',
        { selection: resolution.value.selection },
      );
    }

    const response = await this.generate(
      request,
      resolution.value.tool,
      telemetry,
    );
    if (!response.success) {
      return { ...response.failure, selection: resolution.value.selection };
    }
    if (response.toolCalls === undefined || response.toolCalls.length === 0) {
      const explanation = response.output.trim();
      return failure(
        [],
        explanation.length === 0
          ? `ToolNode ${this.props.nodeId} returned neither a tool call nor an explanation for the intent.`
          : `ToolNode ${this.props.nodeId} could not fulfill the intent: ${createToolOutputPreview(explanation)}`,
        'no-tool-call',
        { selection: resolution.value.selection },
      );
    }

    const validation = validateGeneratedCalls(
      response.toolCalls,
      this.tools,
      resolution.value.tool.name,
    );
    if (validation.outcome !== 'success') {
      const errorCategory =
        validation.outcome === 'semantic-mismatch'
          ? 'semantic-operation-mismatch'
          : 'structural-validation-failure';
      return failure(validation.calls, validation.error, errorCategory, {
        selection: resolution.value.selection,
        ...(validation.outcome === 'structural-failure'
          ? {
              diagnostic: {
                message: `Rejected structurally invalid output for action request ${request.id}.`,
                error: new Error(validation.error),
              },
            }
          : {}),
      });
    }
    return {
      success: true,
      calls: validation.calls,
      output: response.output,
      selection: resolution.value.selection,
    };
  };

  private readonly resolve = async (
    request: ActionRequest,
    telemetry: NodeTelemetryContext,
  ): Promise<
    | { readonly success: true; readonly value: ToolOperationResolution }
    | {
        readonly success: false;
        readonly failure: Extract<ToolElaborationResult, { success: false }>;
      }
  > => {
    try {
      return {
        success: true,
        value: await this.resolver.resolve(request, this.tools, telemetry),
      };
    } catch (error) {
      return {
        success: false,
        failure: failure(
          [],
          `ToolNode ${this.props.nodeId} could not resolve an operation for the intent: ${errorMessage(error)}`,
          'semantic-resolution-failure',
          {
            diagnostic: {
              message: `Failed to resolve an operation for action request ${request.id}.`,
              error,
            },
          },
        ),
      };
    }
  };

  private readonly generate = async (
    request: ActionRequest,
    tool: ToolDefinition,
    telemetry: NodeTelemetryContext,
  ): Promise<
    | {
        readonly success: true;
        readonly output: string;
        readonly toolCalls: readonly ToolCall[] | undefined;
      }
    | {
        readonly success: false;
        readonly failure: Extract<ToolElaborationResult, { success: false }>;
      }
  > => {
    const messages: Message[] = [
      { role: 'tool-intent', content: '', actionRequests: [request] },
    ];
    try {
      const response = await this.props.provider.generateWithTools(
        {
          messages,
          systemPrompt: this.preamble,
          tools: [tool],
          toolChoice: 'required',
        },
        {
          stage: 'tool-elaboration',
          ...telemetry,
          nodeId: this.props.nodeId,
          parentSpanId: request.id,
        },
      );
      return {
        success: true,
        output: response.content,
        toolCalls: response.toolCalls,
      };
    } catch (error) {
      return {
        success: false,
        failure: failure(
          [],
          `ToolNode ${this.props.nodeId} could not elaborate the intent: ${errorMessage(error)}`,
          classifyTelemetryError(error),
          {
            diagnostic: {
              message: `Failed to elaborate action request ${request.id}.`,
              error,
            },
          },
        ),
      };
    }
  };
}

const failure = (
  calls: readonly ToolCall[],
  error: string,
  errorCategory: string,
  options: {
    readonly selection?: ToolOperationSelection;
    readonly diagnostic?: ElaborationDiagnostic;
  } = {},
): Extract<ToolElaborationResult, { success: false }> => ({
  success: false,
  calls,
  error,
  errorCategory,
  ...(options.selection === undefined ? {} : { selection: options.selection }),
  ...(options.diagnostic === undefined
    ? {}
    : { diagnostic: options.diagnostic }),
});
