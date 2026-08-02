import path from 'node:path';
import { render } from 'ink';
import rawSettings from '../../settings.js';
import { init } from '../constants/initialization.js';
import { ConcreteErrorStream } from '../stream/concrete-error-stream.js';
import { JsonlLogRouter } from '../stream/logging/jsonl-log-router.js';
import { App } from './app.js';
import {
  connectErrorTelemetry,
  telemetryLogStream,
} from '../stream/logging/loggable-streams.js';
import { TelemetryRecorder } from '../telemetry/telemetry-recorder.js';
import type { LegionSettings } from '../types/legion-settings.js';

export const main = async (): Promise<void> => {
  const settings: LegionSettings = rawSettings;
  const logRouter = new JsonlLogRouter({
    directory: path.join(rawSettings.saveLocation, 'logs'),
  });
  const errorStream = new ConcreteErrorStream();
  const telemetry = new TelemetryRecorder({
    includeDiagnostics: settings.telemetryDiagnostics ?? false,
    ...(settings.telemetryMaxTextLength === undefined
      ? {}
      : { maxTextLength: settings.telemetryMaxTextLength }),
  });
  logRouter.consume(telemetryLogStream(telemetry));
  connectErrorTelemetry(errorStream, telemetry);
  telemetry.startRun();
  let runCompleted = false;
  const completeRun = (status: 'success' | 'failure'): void => {
    if (!runCompleted) {
      runCompleted = true;
      telemetry.completeRun(status);
    }
  };

  try {
    if (!process.stdin.isTTY) {
      errorStream.publish({
        source: 'TUI',
        message:
          'The Legion TUI needs an interactive terminal (TTY). Run it directly in your terminal.',
      });
      process.exitCode = 1;
      completeRun('failure');
      await logRouter.close();
      return;
    }

    const { orchestrator, mcpClients, eventStream } = await init({
      errorStream,
      telemetry,
    });

    let teardownPromise: Promise<void> | undefined;
    const teardown = (): Promise<void> => {
      teardownPromise ??= (async () => {
        let epochFailure: { readonly error: unknown } | undefined;
        try {
          await orchestrator.waitForIdle();
        } catch (error) {
          epochFailure = { error };
        }
        await Promise.all(mcpClients.map((client) => client.close())).catch(
          (error: unknown) => {
            eventStream.reportError?.({
              source: 'TUI',
              message:
                'Failed to close one or more MCP clients during teardown.',
              error,
            });
          },
        );
        if (epochFailure !== undefined) {
          throw epochFailure.error;
        }
      })();
      return teardownPromise;
    };

    const { waitUntilExit } = render(
      <App
        orchestrator={orchestrator}
        eventStream={eventStream}
        onExit={teardown}
      />,
    );

    await waitUntilExit();
    await teardown();
    completeRun('success');
    await logRouter.close();
    process.exit(0);
  } catch (error) {
    errorStream.publish({
      source: 'TUI',
      message: 'The Legion TUI exited unexpectedly.',
      error,
    });
    completeRun('failure');
    await logRouter.close();
    process.exitCode = 1;
  }
};
