import type { MCPClient, ToolResult } from '../../adapter/mcp-client.js';
import { evidenceDescriptor } from '../../telemetry/content-evidence.js';
import type { TelemetryRecorder } from '../../telemetry/telemetry-recorder.js';
import type { EventStream } from '../../types/event-stream.js';
import type { ActionRequest } from '../../types/message.js';
import type { NodeTelemetryContext } from '../../types/node.js';
import type { ToolCall } from '../../types/tool.js';
import type { ToolNodeOutcome } from '../../types/tool-node.js';
import { errorMessage } from '../../utilities/error-message.js';
import { ToolNodeObserver } from './tool-node-observer.js';

interface ToolCallInvokerProps {
  readonly nodeId: string;
  readonly mcpClient: MCPClient;
  readonly eventStream: EventStream;
  readonly telemetry: TelemetryRecorder;
  readonly observer: ToolNodeObserver;
}

/** Invokes validated calls and correlates their results with the source intent. */
export class ToolCallInvoker {
  constructor(private readonly props: ToolCallInvokerProps) {}

  public readonly invoke = async (
    request: ActionRequest,
    call: ToolCall,
    telemetry: NodeTelemetryContext,
  ): Promise<ToolNodeOutcome> => {
    const startedAtMs = this.props.telemetry.monotonicNow();
    const { id: callId, function: functionCall } = call;
    const { name, arguments: argumentsStr } = functionCall;
    this.props.observer.publishInvocationStarted(
      request.id,
      callId,
      name,
      argumentsStr,
      telemetry,
    );

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
        source: `ToolNode ${this.props.nodeId}`,
        message: `Tool ${name} threw during invocation.`,
        error,
        metadata: { requestId: request.id, callId, toolName: name },
        telemetry,
      });
      result = { callId, name, success: false, error: message };
    }

    this.props.observer.publishInvocationCompleted(
      request.id,
      callId,
      name,
      result.success,
      result.success ? result.result : result.error,
      telemetry,
    );
    const evidence = result.success
      ? evidenceDescriptor(`tool-result:${callId}`, result.result)
      : undefined;
    this.props.observer.recordInvocation(
      request.id,
      callId,
      name,
      result.success,
      this.props.telemetry.durationSince(startedAtMs),
      evidence,
      telemetry,
    );
    return {
      requestId: request.id,
      stage: 'mcp',
      ...result,
      ...(evidence === undefined ? {} : { evidence }),
    };
  };
}
