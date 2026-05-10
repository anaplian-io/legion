export interface MCPServer {
  connect(): Promise<void>;
  close(): Promise<void>;
}

export interface McpServerRepositoryProps<T extends string> {
  readonly servers: Record<T, MCPServer>;
}

export class McpServerRepository<T extends string> {
  public readonly servers: Record<T, MCPServer>;
  constructor(props: McpServerRepositoryProps<T>) {
    this.servers = props.servers;
  }

  public readonly connectAll = (): Promise<void[]> => {
    const allServers: MCPServer[] = Object.values(this.servers);
    return Promise.all(allServers.map((server) => server.connect()));
  };

  public readonly closeAll = (): Promise<void[]> => {
    const allServers: MCPServer[] = Object.values(this.servers);
    return Promise.all(allServers.map((server) => server.close()));
  };
}
