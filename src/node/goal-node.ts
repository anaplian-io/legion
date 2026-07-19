import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { GoalStore } from '../service/goal-store.js';
import { ActiveGoal, GoalOrigin } from '../types/goal.js';
import { ActionRequest } from '../types/message.js';
import { createToolOutputPreview } from '../utilities/tool-output-preview.js';

interface GoalActionResult {
  readonly callId: string;
  readonly name: string;
  readonly success: boolean;
  readonly activeGoal?: ActiveGoal;
  readonly cleared?: boolean;
  readonly error?: string;
}

export interface GoalNodeProps {
  readonly id: string;
  readonly eventStream: EventStream;
  readonly goalStore: GoalStore;
}

/** Executes only typed action requests addressed to Legion's goal actuator. */
export class GoalNode implements Node<'goal'> {
  public readonly kind = 'goal' as const;
  public readonly id: string;
  public readonly capabilityDescription =
    'accepts structured operations: set_active_goal with objective, successCriteria, and origin (user or autonomous); clear_active_goal with the exact active goalId.';
  private _nodeStatus: NodeStatus = 'idle';

  constructor(private readonly props: GoalNodeProps) {
    this.id = props.id;
  }

  public get context(): string {
    return '';
  }

  public get status(): NodeStatus {
    return this._nodeStatus;
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

    this.setStatus('generating');
    const results = requests.map(this.invokeGoalAction);
    this.setStatus('idle');
    return {
      role: 'afferent',
      originatingNodeId: this.id,
      content: JSON.stringify(results),
    };
  };

  public get preamble(): string {
    return `Goal actions are accepted only through structured requests addressed to ${this.id}. Supported operations: set_active_goal(objective, successCriteria, origin) and clear_active_goal(goalId).`;
  }

  private readonly invokeGoalAction = (
    request: ActionRequest,
  ): GoalActionResult => {
    const serializedArguments = JSON.stringify(request.arguments);
    this.props.eventStream.publish({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: this.id,
        callId: request.id,
        toolName: request.operation,
        arguments: serializedArguments,
      },
    });
    try {
      const result = this.applyGoalAction(request);
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: request.id,
          toolName: request.operation,
          success: true,
          output: createToolOutputPreview(result),
        },
      });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.props.eventStream.reportError?.({
        source: `GoalNode ${this.id}`,
        message: `Goal action ${request.operation} failed.`,
        error,
        metadata: { callId: request.id, operation: request.operation },
      });
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: request.id,
          toolName: request.operation,
          success: false,
          output: createToolOutputPreview(errorMessage),
        },
      });
      return {
        callId: request.id,
        name: request.operation,
        success: false,
        error: errorMessage,
      };
    }
  };

  private readonly applyGoalAction = (
    request: ActionRequest,
  ): GoalActionResult => {
    switch (request.operation) {
      case 'set_active_goal': {
        const activeGoal = this.props.goalStore.setActiveGoal({
          objective: requiredString(request, 'objective'),
          successCriteria: requiredString(request, 'successCriteria'),
          origin: requiredOrigin(request),
        });
        return {
          callId: request.id,
          name: request.operation,
          success: true,
          activeGoal,
        };
      }
      case 'clear_active_goal':
        return {
          callId: request.id,
          name: request.operation,
          success: true,
          cleared: this.props.goalStore.clearActiveGoal(
            requiredString(request, 'goalId'),
          ),
        };
      default:
        throw new Error(
          `[GoalNode ${this.id}] unsupported goal operation ${request.operation}`,
        );
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
        source: `GoalNode ${this.id}`,
        message: 'Failed to publish a node status change.',
        error,
      });
    }
  };
}

const requiredString = (request: ActionRequest, field: string): string => {
  const value = request.arguments[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `[GoalNode] ${request.operation} requires a non-empty string ${field}`,
    );
  }
  return value;
};

const requiredOrigin = (request: ActionRequest): GoalOrigin => {
  const value = requiredString(request, 'origin');
  if (value !== 'user' && value !== 'autonomous') {
    throw new Error(
      '[GoalNode] set_active_goal origin must be user or autonomous',
    );
  }
  return value;
};
