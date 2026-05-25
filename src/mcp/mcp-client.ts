import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolDefinition } from '../types/tool.js';

export interface ToolResult {
  readonly callId: string;
  readonly name: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export class MCPClient {
  private readonly _client: Client;

  constructor(props: { readonly client: Client }) {
    this._client = props.client;
  }

  public readonly getAvailableTools = async (): Promise<ToolDefinition[]> => {
    const response = await this._client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema as Record<string, unknown>,
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
    } catch {
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
