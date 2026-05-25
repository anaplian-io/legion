import rawSettings from '../../settings.js';
import { OpenAI } from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDefined } from '../utilities/is-defined.js';
import { LegionSettings } from '../types/legion-settings.js';

export const init = async () => {
  const settings: LegionSettings = rawSettings;
  const openAi = new OpenAI({
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
  });

  const mcpClients: Client[] = settings.mcpServers
    ? (
        await Promise.all(
          Object.entries(settings.mcpServers).map(
            async ([name, definition]) => {
              const client = new Client({
                name,
                version: '0.1.0',
              });
              try {
                await client.connect(new StdioClientTransport(definition));
                console.info(
                  `[Init] Successfully connected MCP client ${name}`,
                );
              } catch (e) {
                console.warn(`[Init] Failed to load MCP client ${name}: ${e}`);
                return undefined;
              }
              return client;
            },
          ),
        )
      ).filter(isDefined)
    : [];

  return {
    openAi,
    mcpClients,
  };
};
