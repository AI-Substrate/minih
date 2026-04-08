/**
 * Shared SDK runtime helper — used by both `run` and `resume` commands.
 *
 * Handles: GH_TOKEN check, dynamic SDK import, CopilotClient creation,
 * SdkCopilotAdapter wiring, SIGINT cleanup, and client.stop() in finally.
 *
 * DYK #2 (003-resume-prompt): Extract shared composition root to avoid
 * duplicating ~80 lines of SDK wiring between run.ts and resume.ts.
 */

import chalk from 'chalk';
import { SdkCopilotAdapter } from '../../adapter/index.js';
import { ErrorCodes, exitWithEnvelope, formatError } from '../output.js';

export interface SdkRuntime {
  adapter: SdkCopilotAdapter;
  cleanup: () => void;
}

/**
 * Bootstrap the SDK runtime: check auth, import SDK, create client + adapter,
 * install SIGINT handler. Call `cleanup()` when done.
 *
 * @param commandName - CLI command name for error envelopes (e.g., 'run', 'resume')
 * @param onSigint - Optional callback before SIGINT exit (e.g., pretty.cleanup())
 * @returns SdkRuntime with adapter and cleanup function
 */
export async function createSdkRuntime(
  commandName: string,
  onSigint?: () => void,
): Promise<SdkRuntime> {
  // Pre-flight: check GH_TOKEN
  if (!process.env.GH_TOKEN) {
    exitWithEnvelope(
      formatError(
        commandName,
        ErrorCodes.AGENT_AUTH_MISSING,
        'GH_TOKEN environment variable is not set. Required for Copilot SDK.',
        { fix: 'export GH_TOKEN=$(gh auth token)' },
      ),
    );
  }

  // Dynamic SDK import — try minih's node_modules first, then the user's project
  let CopilotClient: new () => { stop(): Promise<unknown> };
  try {
    const sdk = await import('@github/copilot-sdk');
    CopilotClient = sdk.CopilotClient;
  } catch (err: unknown) {
    const code =
      (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
      (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
    if (code) {
      // When running via npx, minih is in a separate cache dir and can't see
      // the project's node_modules. Try resolving from the project root.
      try {
        const projectRoot = process.cwd();
        const { createRequire } = await import('node:module');
        const require = createRequire(projectRoot + '/');
        const sdkPath = require.resolve('@github/copilot-sdk');
        const sdk = await import(sdkPath);
        CopilotClient = sdk.CopilotClient;
      } catch {
        exitWithEnvelope(
          formatError(
            commandName,
            ErrorCodes.AGENT_SDK_MISSING,
            'Install @github/copilot-sdk in your project first: npm install @github/copilot-sdk',
          ),
        );
      }
    } else {
      throw err;
    }
  }

  // Suppress Node.js ExperimentalWarning in SDK subprocess (SQLite warning)
  process.env.NODE_NO_WARNINGS = '1';

  // Create client + adapter
  const client = new CopilotClient();
  // biome-ignore lint/suspicious/noExplicitAny: CopilotClient doesn't implement our ICopilotClient exactly
  const adapter = new SdkCopilotAdapter(client as any);

  // SIGINT handler for instant Ctrl+C kill
  const sigintHandler = () => {
    onSigint?.();
    process.stderr.write(chalk.dim('\n  Interrupted.\n'));
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  const cleanup = () => {
    process.removeListener('SIGINT', sigintHandler);
    delete process.env.NODE_NO_WARNINGS;
    client.stop().catch(() => {});
  };

  return { adapter, cleanup };
}
