import { ToolNode } from '../node/tool-node.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import {
  CreateToolNodeProps,
  ToolNodeFactory,
} from '../types/tool-node-factory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MCPClient } from '../adapter/mcp-client.js';
import { ToolDefinition } from '../types/tool.js';
import { ErrorStream } from '../types/error-stream.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';

export interface ConcreteToolNodeFactoryProps {
  readonly provider: Provider;
  readonly mcpClient: Client;
  readonly capabilityDescription: string;
  readonly initialTools?: readonly ToolDefinition[];
  readonly errorStream?: ErrorStream;
  readonly telemetry: TelemetryRecorder;
}

export class ConcreteToolNodeFactory implements ToolNodeFactory {
  private readonly _provider: Provider;
  private readonly _mcpClient: MCPClient;
  private readonly _capabilityDescription: string;
  private readonly _initialTools: readonly ToolDefinition[] | undefined;
  private readonly _telemetry: TelemetryRecorder;

  constructor(props: ConcreteToolNodeFactoryProps) {
    this._provider = props.provider;
    this._mcpClient = new MCPClient({
      client: props.mcpClient,
      ...(props.errorStream === undefined
        ? {}
        : { errorStream: props.errorStream }),
    });
    this._capabilityDescription = props.capabilityDescription;
    this._initialTools = props.initialTools;
    this._telemetry = props.telemetry;
  }

  public readonly create = (props: CreateToolNodeProps): Node<'tool'> => {
    const id = props.nodeId ?? crypto.randomUUID();
    return new ToolNode({
      id,
      provider: this._provider,
      eventStream: props.eventStream,
      mcpClient: this._mcpClient,
      capabilityDescription: this._capabilityDescription,
      ...(this._initialTools === undefined
        ? {}
        : { initialTools: this._initialTools }),
      telemetry: this._telemetry,
    });
  };
}
