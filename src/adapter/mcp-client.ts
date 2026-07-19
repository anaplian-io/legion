import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolDefinition } from '../types/tool.js';
import { ErrorStream } from '../types/error-stream.js';

export interface ToolResult {
  readonly callId: string;
  readonly name: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * Coerces an MCP tool's `inputSchema` into a usable JSON object schema.
 *
 * The MCP SDK types `inputSchema` loosely, and a misbehaving server can return
 * a non-object value. Rather than blindly casting and forwarding malformed
 * schemas to the model, fall back to a minimal empty-object schema (a tool
 * that takes no arguments) when the schema is not a usable object.
 */
const normalizeToolSchema = (schema: unknown): Record<string, unknown> => {
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
};

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
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      parameters: normalizeToolSchema(tool.inputSchema),
    }));
  };

  public readonly invokeTool = async (
    callId: string,
    name: string,
    argumentsStr: string,
  ): Promise<ToolResult> => {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argumentsStr);
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

    try {
      const result = await this._client.callTool({
        name,
        arguments: args,
      });

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
