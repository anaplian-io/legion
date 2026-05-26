import { init } from './initialization.js';

(async () => {
  const { orchestrator, mcpClients } = await init();
  for (let index = 0; index < 5; index += 1) {
    await orchestrator.runEpoch();
    console.info(`<EPOCH ${index} FINISHED>`);
  }
  await Promise.all(mcpClients.map((client) => client.close()));
})().catch(() => {});
