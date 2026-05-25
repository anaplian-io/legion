import { ToolNode } from '../node/tool-node.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import {
  CreateToolNodeProps,
  ToolNodeFactory,
} from '../types/tool-node-factory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MCPClient } from '../adapter/mcp-client.js';

export interface ConcreteToolNodeFactoryProps {
  readonly provider: Provider;
  readonly mcpClient: Client;
}

export class ConcreteToolNodeFactory implements ToolNodeFactory {
  private readonly _provider: Provider;
  private readonly _mcpClient: MCPClient;

  constructor(props: ConcreteToolNodeFactoryProps) {
    this._provider = props.provider;
    this._mcpClient = new MCPClient({ client: props.mcpClient });
  }

  public readonly create = (props: CreateToolNodeProps): Node<'tool'> => {
    const id = props.nodeId ?? crypto.randomUUID();
    return new ToolNode({
      id,
      provider: this._provider,
      eventStream: props.eventStream,
      mcpClient: this._mcpClient,
    });
  };
}
