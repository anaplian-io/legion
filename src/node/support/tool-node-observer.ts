import type { TelemetryRecorder } from '../../telemetry/telemetry-recorder.js';
import type { EventStream } from '../../types/event-stream.js';
import type { EvidenceDescriptor } from '../../types/evidence.js';
import type { NodeStatus, NodeTelemetryContext } from '../../types/node.js';
import type { ToolOperationSelection } from '../../types/tool-node.js';
import { createToolOutputPreview } from '../../utilities/tool-output-preview.js';

interface ToolNodeObserverProps {
  readonly nodeId: string;
  readonly eventStream: EventStream;
  readonly telemetry: TelemetryRecorder;
}

interface ToolCallData {
  readonly callId: string;
  readonly toolName: string;
}

/** Owns defensive domain-event publication and flat ToolNode telemetry. */
export class ToolNodeObserver {
  constructor(private readonly props: ToolNodeObserverProps) {}

  public readonly reportElaborationError = (
    message: string,
    error: unknown,
    telemetry: NodeTelemetryContext,
    requestId?: string,
  ): void => {
    this.props.eventStream.reportError?.({
      source: `ToolNode ${this.props.nodeId}`,
      message,
      error,
      ...(requestId === undefined ? {} : { metadata: { requestId } }),
      telemetry,
    });
  };

  public readonly publishElaborationCompleted = (
    requestId: string,
    success: boolean,
    toolCalls: readonly ToolCallData[],
    output: unknown,
    telemetry: NodeTelemetryContext,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'tool/elaboration-completed',
        data: {
          nodeId: this.props.nodeId,
          requestId,
          success,
          toolCalls,
          output: createToolOutputPreview(output),
        },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.props.nodeId}`,
        message: 'Failed to publish a tool elaboration completion event.',
        error,
        metadata: { requestId },
        telemetry: this.requestTelemetry(requestId, telemetry),
      });
    }
  };

  public readonly publishInvocationStarted = (
    requestId: string,
    callId: string,
    toolName: string,
    argumentsStr: string,
    telemetry: NodeTelemetryContext,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'tool/invocation-started',
        data: {
          nodeId: this.props.nodeId,
          requestId,
          callId,
          toolName,
          arguments: argumentsStr,
        },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.props.nodeId}`,
        message: 'Failed to publish a tool invocation start event.',
        error,
        metadata: { requestId, callId, toolName },
        telemetry: this.requestTelemetry(requestId, telemetry),
      });
    }
  };

  public readonly publishInvocationCompleted = (
    requestId: string,
    callId: string,
    toolName: string,
    success: boolean,
    output: unknown,
    telemetry: NodeTelemetryContext,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.props.nodeId,
          requestId,
          callId,
          toolName,
          success,
          output: createToolOutputPreview(output),
        },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.props.nodeId}`,
        message: 'Failed to publish a tool invocation completion event.',
        error,
        metadata: { requestId, callId, toolName },
        telemetry: this.requestTelemetry(requestId, telemetry),
      });
    }
  };

  public readonly recordElaboration = (
    requestId: string,
    callIds: readonly string[],
    outcome: 'success' | 'failure',
    context: NodeTelemetryContext,
    durationMs: number,
    errorCategory?: string,
    selection?: ToolOperationSelection,
  ): void => {
    this.props.telemetry.record(
      'tool.elaboration-completed',
      {
        requestId,
        durationMs,
        outcome,
        callIds,
        ...(selection === undefined
          ? {}
          : {
              resolvedCandidateIndex: selection.candidateIndex,
              resolvedOperation: selection.operation,
            }),
        ...(errorCategory === undefined ? {} : { errorCategory }),
      },
      { ...context, nodeId: this.props.nodeId },
      requestId,
    );
  };

  public readonly recordInvocation = (
    requestId: string,
    callId: string,
    toolName: string,
    success: boolean,
    durationMs: number,
    evidence: EvidenceDescriptor | undefined,
    context: NodeTelemetryContext,
  ): void => {
    this.props.telemetry.record(
      'tool.invocation-completed',
      {
        requestId,
        callId,
        toolName,
        durationMs,
        outcome: success ? 'success' : 'failure',
        ...(evidence === undefined ? {} : { evidence }),
        ...(success ? {} : { errorCategory: 'tool-invocation-failure' }),
      },
      this.requestTelemetry(requestId, context),
      callId,
    );
  };

  public readonly publishStatus = (
    status: NodeStatus,
    telemetry: NodeTelemetryContext,
  ): void => {
    try {
      this.props.eventStream.publish({
        topicName: 'node/status-change',
        data: { nodeId: this.props.nodeId, status },
      });
    } catch (error) {
      this.props.eventStream.reportError?.({
        source: `ToolNode ${this.props.nodeId}`,
        message: 'Failed to publish a node status change.',
        error,
        telemetry,
      });
    }
  };

  private readonly requestTelemetry = (
    requestId: string,
    telemetry: NodeTelemetryContext,
  ): NodeTelemetryContext => ({
    ...telemetry,
    nodeId: this.props.nodeId,
    parentSpanId: requestId,
  });
}
