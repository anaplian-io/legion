import { ToolNode } from '../node/tool-node.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import {
  CreateToolNodeProps,
  ToolNodeFactory,
} from '../types/tool-node-factory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MCPClient } from '../adapter/mcp-client.js';
import { RelevanceGate } from '../types/relevance-gate.js';
import { ToolDefinition } from '../types/tool.js';

export interface ConcreteToolNodeFactoryProps {
  readonly provider: Provider;
  readonly mcpClient: Client;
  readonly relevanceGate: RelevanceGate;
  readonly capabilityDescription: string;
  readonly initialTools?: readonly ToolDefinition[];
}

export class ConcreteToolNodeFactory implements ToolNodeFactory {
  private readonly _provider: Provider;
  private readonly _mcpClient: MCPClient;
  private readonly _relevanceGate: RelevanceGate;
  private readonly _capabilityDescription: string;
  private readonly _initialTools: readonly ToolDefinition[];

  constructor(props: ConcreteToolNodeFactoryProps) {
    this._provider = props.provider;
    this._mcpClient = new MCPClient({ client: props.mcpClient });
    this._relevanceGate = props.relevanceGate;
    this._capabilityDescription = props.capabilityDescription;
    this._initialTools = props.initialTools ?? [];
  }

  public readonly create = (props: CreateToolNodeProps): Node<'tool'> => {
    const id = props.nodeId ?? crypto.randomUUID();
    return new ToolNode({
      id,
      provider: this._provider,
      eventStream: props.eventStream,
      mcpClient: this._mcpClient,
      relevanceGate: this._relevanceGate,
      capabilityDescription: this._capabilityDescription,
      initialTools: this._initialTools,
    });
  };
}
