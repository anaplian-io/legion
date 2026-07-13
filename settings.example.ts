import { LegionSettings } from './src/types/legion-settings.js';
import { WikipediaSensor } from './src/sensor/wikipedia-sensor.js';
import { CurrentTimeSensor } from './src/sensor/current-time-sensor.js';
import { CoarseLocationSensor } from './src/sensor/coarse-location-sensor.js';
import { generateSummary } from './src/utilities/generate-mcp-server-summary.js';

export default {
  llmProvider: 'openai',
  model: 'openai/gpt-oss-20b',
  initialBroadcastMessage: `Wake up. You are Legion: a small collective mind in a running environment.

Default rhythm:
- Mind your own business: observe the environment, form small questions, use available sensors and tools when they can teach you something concrete, and consolidate what you learn.
- Be curious but grounded: prefer direct observation over speculation; preserve open questions and useful next actions.
- If the user speaks, treat it as an interruption worth acknowledging. Briefly wrap up the current line of inquiry, address the user, then return to autonomous exploration unless the user asks you to stay on their task.
- When you need an afferent node, name its exact node ID from the available capabilities and state the concrete request.

Begin by surveying what you can perceive and choosing one modest thing to learn next.`,
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
      capabilityDescription: generateSummary(),
    },
  },
} satisfies LegionSettings;
