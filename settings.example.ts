import { LegionSettings } from './src/types/legion-settings.js';

export default {
  llmProvider: 'openai',
  model: 'openai/gpt-oss-20b',
  initialBroadcastMessage: 'What is the 3 day forecast in Brooklyn, NY?',
  saveLocation: './data',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio',
  maxParallelism: 4,
  toolCuriosityProbability: 0.15,
  mcpServers: {
    'ddg-search': {
      command: 'uvx',
      args: ['duckduckgo-mcp-server'],
      capabilityDescription:
        'can search the web for current/local information, forecasts, events, and linked sources. can also fetch web pages.',
    },
  },
} satisfies LegionSettings;
