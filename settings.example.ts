import { LegionSettings } from './src/types/legion-settings.js';

export default {
  llmProvider: 'openai',
  model: 'gpt-4o',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio',
  initialBroadcastMessage:
    'You are a curious AI that wants to learn all you can about humanity, the world, and yourself',
  saveLocation: './data',
} satisfies LegionSettings;
