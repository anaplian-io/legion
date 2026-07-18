import {
  BroadcastMessage,
  Node,
  NodeResponse,
  NodeStatus,
} from '../types/node.js';
import { EventStream } from '../types/event-stream.js';
import { Provider, ToolCall } from '../types/provider.js';
import { RelevanceGate } from '../types/relevance-gate.js';
import { ToolDefinition } from '../types/tool.js';
import { GoalStore } from '../service/goal-store.js';
import { ActiveGoal } from '../types/goal.js';
import { createToolOutputPreview } from '../utilities/tool-output-preview.js';

const GOAL_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'set_active_goal',
    description: 'Set or replace the single active collective goal.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'A concise, concrete shared intention for Legion.',
        },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_active_goal',
    description:
      'Clear the active collective goal after completion or abandonment.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

interface GoalToolResult {
  readonly callId: string;
  readonly name: string;
  readonly success: boolean;
  readonly activeGoal?: ActiveGoal;
  readonly cleared?: boolean;
  readonly error?: string;
}

export interface GoalNodeProps {
  readonly id: string;
  readonly provider: Provider;
  readonly eventStream: EventStream;
  readonly relevanceGate: RelevanceGate;
  readonly goalStore: GoalStore;
}

/** A local actuator that lets the collective turn a selected thought into intent. */
export class GoalNode implements Node<'goal'> {
  public readonly kind = 'goal' as const;
  public readonly id: string;
  public readonly capabilityDescription =
    "can set, replace, or clear Legion's single persistent active collective goal.";
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
    const messages = [
      ...broadcastMessage.workingMemory.messages,
      broadcastMessage.broadcast,
    ];
    this.setStatus('evaluating-relevance');
    const relevant = await this.props.relevanceGate.isRelevant({
      broadcastMessage,
      nodeId: this.id,
      epochsAlive: broadcastMessage.recipientNodeStats?.epochsAlive ?? 0,
      nodeContext: this.preamble,
    });
    if (!relevant) {
      this.setStatus('idle');
      return undefined;
    }

    this.setStatus('idle');
    this.setStatus('generating');
    const response = await this.props.provider.generateWithTools({
      systemPrompt: this.preamble,
      messages,
      tools: GOAL_TOOLS,
    });
    if (!response.toolCalls || response.toolCalls.length === 0) {
      this.setStatus('idle');
      return undefined;
    }

    const results = response.toolCalls.map((call) => this.invokeGoalTool(call));
    this.setStatus('idle');
    return {
      role: 'afferent',
      originatingNodeId: this.id,
      content: JSON.stringify(results),
    };
  };

  public get preamble(): string {
    return `You are Legion's native goal-management node. You act only when the collective's broadcast explicitly asks ${this.id} to set, replace, or clear the active goal. The active goal is a concise shared intention, not a task plan or a user message. Use set_active_goal for a new or revised intention, and clear_active_goal only when the current intention is complete or should be abandoned.\n\nYour node ID: ${this.id}\nYour available tools:\n${GOAL_TOOLS.map((tool) => JSON.stringify(tool)).join('\n')}`;
  }

  private readonly invokeGoalTool = (call: ToolCall): GoalToolResult => {
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
      const result = this.applyGoalTool(call);
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: call.id,
          toolName: call.function.name,
          success: true,
          output: createToolOutputPreview(result),
        },
      });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.props.eventStream.publish({
        topicName: 'tool/invocation-completed',
        data: {
          nodeId: this.id,
          callId: call.id,
          toolName: call.function.name,
          success: false,
          output: createToolOutputPreview(errorMessage),
        },
      });
      return {
        callId: call.id,
        name: call.function.name,
        success: false,
        error: errorMessage,
      };
    }
  };

  private readonly applyGoalTool = (call: ToolCall): GoalToolResult => {
    switch (call.function.name) {
      case 'set_active_goal': {
        const activeGoal = this.props.goalStore.setActiveGoal(
          parseGoalContent(call.function.arguments),
        );
        return {
          callId: call.id,
          name: call.function.name,
          success: true,
          activeGoal,
        };
      }
      case 'clear_active_goal':
        return {
          callId: call.id,
          name: call.function.name,
          success: true,
          cleared: this.props.goalStore.clearActiveGoal(),
        };
      default:
        throw new Error(
          `[GoalNode ${this.id}] unsupported goal tool ${call.function.name}`,
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
      console.warn(
        `[GoalNode ${this.id}] event publish threw during execution: ${error}`,
      );
    }
  };
}

const parseGoalContent = (argumentsString: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsString) as unknown;
  } catch {
    throw new Error('[GoalNode] set_active_goal arguments must be valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>)['goal'] !== 'string'
  ) {
    throw new Error(
      '[GoalNode] set_active_goal arguments require a string goal field',
    );
  }
  return (parsed as Record<string, unknown>)['goal'] as string;
};
