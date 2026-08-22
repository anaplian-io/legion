import type { ActionRequest, Message } from '../../types/message.js';
import type { NodeTelemetryContext } from '../../types/node.js';
import type { Provider } from '../../types/provider.js';
import type { ToolDefinition } from '../../types/tool.js';
import type { ToolOperationSelection } from '../../types/tool-node.js';

export const NO_APPLICABLE_OPERATION = 'legion_no_applicable_tool';

export type ToolOperationResolution =
  | {
      readonly outcome: 'operation';
      readonly tool: ToolDefinition;
      readonly selection: ToolOperationSelection;
    }
  | {
      readonly outcome: 'no-applicable';
      readonly selection: ToolOperationSelection;
    };

interface ToolOperationResolverProps {
  readonly nodeId: string;
  readonly capabilityDescription: string;
  readonly provider: Provider;
}

/** Chooses the one advertised operation whose result best matches an intent. */
export class ToolOperationResolver {
  private readonly systemPrompt: string;

  constructor(private readonly props: ToolOperationResolverProps) {
    this.systemPrompt = `You resolve an authoritative task intent to one exact MCP operation for ToolNode ${props.nodeId}.

ToolNode capability: ${props.capabilityDescription}

Select the single candidate whose advertised result most directly produces the requested outcome. Compare all candidates rather than accepting an adjacent step. Search, discovery, listing, metadata, and status operations are valid when the intent requests those outcomes, but they do not substitute for retrieving, changing, or executing something. In particular, when the intent requests the content of a known webpage, prefer an advertised page-fetch or content-retrieval operation over web search.

The request's intent is authoritative. Its operation and argument hints are advisory evidence: use them when they are compatible with the intent, but repair or ignore them when they conflict. A required value present in an argument hint is available to the eventual call even when the intent does not repeat it. Select ${NO_APPLICABLE_OPERATION} when no advertised operation can plausibly produce the requested outcome, or when neither the intent nor compatible hints provide information required to form a meaningful call and no advertised operation can obtain it. Do not invent a missing URL, identifier, path, or other required target.`;
  }

  public readonly resolve = async (
    request: ActionRequest,
    tools: readonly ToolDefinition[],
    telemetry: NodeTelemetryContext,
  ): Promise<ToolOperationResolution> => {
    const candidates = [
      ...tools.map(operationCandidate),
      noApplicableCandidate(),
    ];
    const selectedIndex = await this.props.provider.selectBest(
      {
        systemPrompt: this.systemPrompt,
        messages: [intentMessage(request)],
        candidates,
      },
      {
        stage: 'tool-elaboration',
        ...telemetry,
        nodeId: this.props.nodeId,
        parentSpanId: request.id,
      },
    );
    if (selectedIndex === tools.length) {
      return {
        outcome: 'no-applicable',
        selection: {
          candidateIndex: selectedIndex,
          operation: NO_APPLICABLE_OPERATION,
        },
      };
    }
    const tool = tools[selectedIndex];
    if (tool === undefined) {
      throw new Error(
        `ToolNode ${this.props.nodeId} resolver selected invalid candidate index ${selectedIndex}.`,
      );
    }
    return {
      outcome: 'operation',
      tool,
      selection: { candidateIndex: selectedIndex, operation: tool.name },
    };
  };
}

const intentMessage = (request: ActionRequest): Message => ({
  role: 'tool-intent',
  content: '',
  actionRequests: [request],
});

const operationCandidate = (tool: ToolDefinition): string =>
  JSON.stringify({
    candidate: 'mcp-operation',
    operation: tool.name,
    advertisedResult: tool.description ?? '',
    parameters: tool.parameters,
  });

const noApplicableCandidate = (): string =>
  JSON.stringify({
    candidate: NO_APPLICABLE_OPERATION,
    advertisedResult:
      'None of the advertised MCP operations can plausibly produce the requested outcome.',
  });
