import { render } from 'ink';
import { init } from '../constants/initialization.js';
import { App } from './app.js';

export const main = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    console.error(
      'The Legion TUI needs an interactive terminal (TTY). Run it directly in your terminal.',
    );
    process.exit(1);
  }

  // attachConsoleLogging: false — keep the console subscribers off so they
  // don't fight Ink for the screen. The TUI surfaces activity itself.
  const { orchestrator, mcpClients, eventStream } = await init({
    attachConsoleLogging: false,
  });

  let tornDown = false;
  const teardown = async (): Promise<void> => {
    if (tornDown) return;
    tornDown = true;
    await Promise.all(mcpClients.map((client) => client.close())).catch(
      () => undefined,
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
};
