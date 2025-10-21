import { MCPServer } from '@openai/agents';
import { McpServerRepository } from './mcp-server-repository.js';

describe('McpServerRepository', () => {
  const firstMockServer = {
    connect: jest.fn(),
    close: jest.fn(),
  } as unknown as MCPServer;

  const secondMockServer = {
    connect: jest.fn(),
    close: jest.fn(),
  } as unknown as MCPServer;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('connects all servers with connectAll', async () => {
    const repo = new McpServerRepository({
      servers: {
        first: firstMockServer,
        second: secondMockServer,
      },
    });
    await repo.connectAll();
    expect(firstMockServer.connect).toHaveBeenCalledTimes(1);
    expect(secondMockServer.connect).toHaveBeenCalledTimes(1);
    expect(firstMockServer.close).not.toHaveBeenCalledTimes(1);
    expect(secondMockServer.close).not.toHaveBeenCalledTimes(1);
  });

  it('closes all servers with close', async () => {
    const repo = new McpServerRepository({
      servers: {
        first: firstMockServer,
        second: secondMockServer,
      },
    });
    await repo.closeAll();
    expect(firstMockServer.connect).not.toHaveBeenCalledTimes(1);
    expect(secondMockServer.connect).not.toHaveBeenCalledTimes(1);
    expect(firstMockServer.close).toHaveBeenCalledTimes(1);
    expect(secondMockServer.close).toHaveBeenCalledTimes(1);
  });

  it('correctly references all servers', async () => {
    const repo = new McpServerRepository({
      servers: {
        first: firstMockServer,
        second: secondMockServer,
      },
    });
    await repo.servers.first.connect();
    await repo.servers.second.connect();
    await repo.servers.first.close();
    await repo.servers.second.close();
    expect(firstMockServer.connect).toHaveBeenCalledTimes(1);
    expect(secondMockServer.connect).toHaveBeenCalledTimes(1);
    expect(firstMockServer.close).toHaveBeenCalledTimes(1);
    expect(secondMockServer.close).toHaveBeenCalledTimes(1);
  });
});
