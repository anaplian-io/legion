import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { GoalStore } from '../service/goal-store.js';
import { ActiveGoal, GoalDecision, GoalOrigin } from '../types/goal.js';
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

interface GoalActionRequest extends ActionRequest {
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
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
    const goalDecision = broadcastMessage.broadcast.goalDecision;
    if (
      requests.length === 0 &&
      (goalDecision === undefined || goalDecision.kind === 'unchanged')
    ) {
      return undefined;
    }

    this.setStatus('generating');
    const results = [
      ...requests.map(this.invokeGoalAction),
      ...(goalDecision === undefined || goalDecision.kind === 'unchanged'
        ? []
        : [this.invokeGoalDecision(goalDecision)]),
    ];
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
    const operation = request.operation ?? '[missing-operation-hint]';
    const serializedArguments = JSON.stringify(request.arguments ?? {});
    this.props.eventStream.publish({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: this.id,
        callId: request.id,
        toolName: operation,
        arguments: serializedArguments,
      },
    });
    try {
      const result = this.applyGoalAction(requireGoalActionRequest(request));
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: request.id,
          toolName: operation,
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
        message: `Goal action ${operation} failed.`,
        error,
        metadata: { callId: request.id, operation },
      });
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: request.id,
          toolName: operation,
          success: false,
          output: createToolOutputPreview(errorMessage),
        },
      });
      return {
        callId: request.id,
        name: operation,
        success: false,
        error: errorMessage,
      };
    }
  };

  private readonly invokeGoalDecision = (
    decision: Exclude<GoalDecision, { readonly kind: 'unchanged' }>,
  ): GoalActionResult => {
    const serializedArguments = JSON.stringify(decision);
    this.props.eventStream.publish({
      topicName: 'tool/invocation-started',
      data: {
        nodeId: this.id,
        callId: decision.id,
        toolName: decision.kind,
        arguments: serializedArguments,
      },
    });
    try {
      const result = this.applyGoalDecision(decision);
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: decision.id,
          toolName: decision.kind,
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
        message: `Goal decision ${decision.kind} failed.`,
        error,
        metadata: { callId: decision.id, operation: decision.kind },
      });
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: decision.id,
          toolName: decision.kind,
          success: false,
          output: createToolOutputPreview(errorMessage),
        },
      });
      return {
        callId: decision.id,
        name: decision.kind,
        success: false,
        error: errorMessage,
      };
    }
  };

  private readonly applyGoalAction = (
    request: GoalActionRequest,
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

  private readonly applyGoalDecision = (
    decision: Exclude<GoalDecision, { readonly kind: 'unchanged' }>,
  ): GoalActionResult => {
    switch (decision.kind) {
      case 'activate': {
        if (this.props.goalStore.activeGoal !== undefined) {
          throw new Error(
            '[GoalNode] cannot activate a new goal while one is active',
          );
        }
        return {
          callId: decision.id,
          name: decision.kind,
          success: true,
          activeGoal: this.props.goalStore.setActiveGoal(decision),
        };
      }
      case 'revise':
        return {
          callId: decision.id,
          name: decision.kind,
          success: true,
          activeGoal: this.props.goalStore.reviseActiveGoal(
            decision.goalId,
            decision,
          ),
        };
      case 'supersede':
        this.requireActiveGoal(decision.goalId, decision.kind);
        return {
          callId: decision.id,
          name: decision.kind,
          success: true,
          activeGoal: this.props.goalStore.setActiveGoal(decision),
        };
      case 'complete':
      case 'abandon':
        return {
          callId: decision.id,
          name: decision.kind,
          success: true,
          cleared: this.props.goalStore.clearActiveGoal(decision.goalId),
        };
    }
  };

  private readonly requireActiveGoal = (
    expectedGoalId: string,
    operation: string,
  ): void => {
    if (this.props.goalStore.activeGoal?.id !== expectedGoalId) {
      throw new Error(
        `[GoalNode] ${operation} requires the exact active goal ID`,
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

const requireGoalActionRequest = (
  request: ActionRequest,
): GoalActionRequest => {
  if (request.operation === undefined || request.arguments === undefined) {
    throw new Error(
      `[GoalNode] action intent ${request.id} requires explicit operation and argument hints`,
    );
  }
  return request as GoalActionRequest;
};

const requiredString = (request: GoalActionRequest, field: string): string => {
  const value = request.arguments[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `[GoalNode] ${request.operation} requires a non-empty string ${field}`,
    );
  }
  return value;
};

const requiredOrigin = (request: GoalActionRequest): GoalOrigin => {
  const value = requiredString(request, 'origin');
  if (value !== 'user' && value !== 'autonomous') {
    throw new Error(
      '[GoalNode] set_active_goal origin must be user or autonomous',
    );
  }
  return value;
};
