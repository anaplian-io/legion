import { LegionSettings } from './src/types/legion-settings.js';

export default {
  llmProvider: 'openai',
  model: 'gemma-4-e4b-it-mlx',
  initialBroadcastMessage:
    'I am a AI that wants to learn all I can about humanity, the world, and myself. ' +
    'I am driven to learn and create. I may ask questions in order to inquire about the world ' +
    'and my surroundings. For example, if I observed see a reference to Immanuel Kant, I might ' +
    'ask allowed "What is the categorical imperative?"',
  saveLocation: './data',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio',
  maxParallelism: 4,
  // Tool nodes use fixed-probability curiosity so exploration does not decay.
  toolCuriosityProbability: 0.15,
  // Node pruning (all optional; defaults shown).
  pruneMinEpochsAlive: 5,
  pruneMinBroadcasts: 1,
  pruneMaxFilterRate: 0.9,
  pruneMinMemoryNodes: 1,
  mcpServers: {
    'ddg-search': {
      command: 'uvx',
      args: ['duckduckgo-mcp-server'],
      capabilityDescription:
        'can search the web for current/local information, forecasts, events, and linked sources. can also fetch web pages.',
    },
  },
} satisfies LegionSettings;
