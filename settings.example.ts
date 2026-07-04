import { LegionSettings } from './src/types/legion-settings.js';
import { WikipediaSensor } from './src/sensor/wikipedia-sensor.js';
import { CurrentTimeSensor } from './src/sensor/current-time-sensor.js';
import { CoarseLocationSensor } from './src/sensor/coarse-location-sensor.js';

export default {
  llmProvider: 'openai',
  model: 'openai/gpt-oss-20b',
  initialBroadcastMessage: 'What is the 3 day forecast?',
  saveLocation: './data',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio',
  maxParallelism: 4,
  toolCuriosityProbability: 0.15,
  sensorProviders: [
    () => ({
      sensor: new CurrentTimeSensor(),
      capabilityDescription:
        'can provide the current UTC time as an ISO timestamp.',
    }),
    () => ({
      sensor: new CoarseLocationSensor({
        location: {
          city: 'Brooklyn',
          state: 'NY',
          country: 'USA',
          zipCode: '11218',
        },
      }),
      capabilityDescription:
        "can provide the user's configured approximate coarse location.",
    }),
    ({ provider }) => ({
      sensor: new WikipediaSensor(provider),
      capabilityDescription:
        'can surface random Wikipedia article knowledge as external background context.',
    }),
  ],
  mcpServers: {
    'ddg-search': {
      command: 'uvx',
      args: ['duckduckgo-mcp-server'],
      capabilityDescription:
        'can search the web for current/local information, forecasts, events, and linked sources. can also fetch web pages.',
    },
  },
} satisfies LegionSettings;
