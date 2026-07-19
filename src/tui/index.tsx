import path from 'node:path';
import { render } from 'ink';
import rawSettings from '../../settings.js';
import { init } from '../constants/initialization.js';
import { ConcreteErrorStream } from '../service/concrete-error-stream.js';
import { JsonlLogRouter } from '../service/jsonl-log-router.js';
import { App } from './app.js';

export const main = async (): Promise<void> => {
  const logRouter = new JsonlLogRouter({
    directory: path.join(rawSettings.saveLocation, 'logs'),
  });
  const errorStream = new ConcreteErrorStream({ logRouter });

  try {
    if (!process.stdin.isTTY) {
      errorStream.publish({
        source: 'TUI',
        message:
          'The Legion TUI needs an interactive terminal (TTY). Run it directly in your terminal.',
      });
      process.exitCode = 1;
      return;
    }

    const { orchestrator, mcpClients, eventStream } = await init({
      logRouter,
      errorStream,
    });

    let tornDown = false;
    const teardown = async (): Promise<void> => {
      if (tornDown) return;
      tornDown = true;
      await Promise.all(mcpClients.map((client) => client.close())).catch(
        (error: unknown) => {
          eventStream.reportError?.({
            source: 'TUI',
            message: 'Failed to close one or more MCP clients during teardown.',
            error,
          });
        },
      );
    };

    const { waitUntilExit } = render(
      <App
        orchestrator={orchestrator}
        eventStream={eventStream}
        onExit={() => {
          void teardown();
        }}
      />,
    );

    await waitUntilExit();
    await teardown();
    process.exit(0);
  } catch (error) {
    errorStream.publish({
      source: 'TUI',
      message: 'The Legion TUI exited unexpectedly.',
      error,
    });
    process.exitCode = 1;
  }
};
