import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolDefinition } from '../types/tool.js';
import { ErrorStream } from '../types/error-stream.js';
import { isDefined, isRecord } from '../utilities/type-guards.js';
import { createToolOutputPreview } from '../utilities/tool-output-preview.js';

export interface ToolResult {
  readonly callId: string;
  readonly name: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * Accepts only usable JSON object schemas advertised by an MCP server.
 *
 * The MCP SDK types `inputSchema` loosely, and a misbehaving server can return
 * a non-object value. Such a tool must not be offered to the model because no
 * trustworthy argument-validation boundary can be established for it.
 */
const normalizeToolSchema = (
  schema: unknown,
): Record<string, unknown> | undefined =>
  isRecord(schema) ? schema : undefined;

export class MCPClient {
  private readonly _client: Client;

  constructor(props: {
    readonly client: Client;
    readonly errorStream?: ErrorStream;
  }) {
    this._client = props.client;
    this._errorStream = props.errorStream;
  }

  private readonly _errorStream: ErrorStream | undefined;

  public readonly getAvailableTools = async (): Promise<ToolDefinition[]> => {
    const response = await this._client.listTools();
    return response.tools.flatMap((tool) => {
      const parameters = normalizeToolSchema(tool.inputSchema);
      if (parameters === undefined) {
        this._errorStream?.publish({
          source: 'MCPClient',
          message: `Ignored tool ${tool.name} because its input schema is invalid.`,
          error: new Error('MCP tool input schema must be an object.'),
          metadata: { name: tool.name },
        });
        return [];
      }
      return [
        {
          name: tool.name,
          description: tool.description ?? '',
          parameters,
        },
      ];
    });
  };

  public readonly invokeTool = async (
    callId: string,
    name: string,
    argumentsStr: string,
  ): Promise<ToolResult> => {
    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(argumentsStr) as unknown;
    } catch (error) {
      this._errorStream?.publish({
        source: 'MCPClient',
        message: `Tool ${name} received invalid JSON arguments.`,
        error,
        metadata: { callId, name },
      });
      return {
        callId,
        name,
        success: false,
        error: `Invalid arguments JSON: ${argumentsStr}`,
      };
    }
    if (!isRecord(parsedArguments)) {
      const error = new Error('Tool arguments must be a JSON object.');
      this._errorStream?.publish({
        source: 'MCPClient',
        message: `Tool ${name} received non-object arguments.`,
        error,
        metadata: { callId, name },
      });
      return {
        callId,
        name,
        success: false,
        error: error.message,
      };
    }

    try {
      const result = await this._client.callTool({
        name,
        arguments: parsedArguments,
      });

      if (result.isError === true) {
        const errorMessage = semanticErrorMessage(name, result);
        this._errorStream?.publish({
          source: 'MCPClient',
          message: `Tool ${name} returned an MCP error result.`,
          error: new Error(errorMessage),
          metadata: { callId, name },
        });
        return {
          callId,
          name,
          success: false,
          error: errorMessage,
        };
      }

      return {
        callId,
        name,
        success: true,
        result,
      };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this._errorStream?.publish({
        source: 'MCPClient',
        message: `Tool ${name} invocation failed.`,
        error: e,
        metadata: { callId, name },
      });
      return {
        callId,
        name,
        success: false,
        error: errorMessage,
      };
    }
  };

  public readonly shutdown = async (): Promise<void> => {
    await this._client.close();
  };
}

const semanticErrorMessage = (
  name: string,
  result: Readonly<Record<string, unknown>>,
): string => {
  const content = result['content'];
  if (Array.isArray(content)) {
    const text = content
      .map((item) =>
        isRecord(item) &&
        item['type'] === 'text' &&
        typeof item['text'] === 'string'
          ? item['text']
          : undefined,
      )
      .filter(isDefined)
      .join('\n')
      .trim();
    if (text.length > 0) {
      return text;
    }
  }
  const structuredContent = result['structuredContent'];
  if (structuredContent !== undefined) {
    return `MCP tool ${name} returned an error: ${createToolOutputPreview(structuredContent)}`;
  }
  return `MCP tool ${name} returned isError: true.`;
};
