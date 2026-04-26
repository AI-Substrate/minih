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
import type {
  CopilotModelInfo,
  CopilotReasoningEffort,
  ICopilotClient,
} from '../../adapter/index.js';
import { SdkCopilotAdapter } from '../../adapter/index.js';
import { ErrorCodes, exitWithEnvelope, formatError } from '../output.js';

export interface SdkRuntime {
  adapter: SdkCopilotAdapter;
  /**
   * Pre-flight: confirm the model exists in copilot-sdk's registry and that
   * the requested reasoning effort is supported. Best-effort — silently
   * passes if listModels() fails (network, older SDK, etc.).
   */
  validateModelConfig: (input: {
    model?: string;
    reasoningEffort?: CopilotReasoningEffort;
  }) => Promise<ModelValidation>;
  cleanup: () => void;
}

export type ModelValidation =
  | { ok: true }
  | { ok: false; message: string; details?: Record<string, unknown> };

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

  // Dynamic SDK import — try minih's node_modules first, then the user's project.
  // The SDK's CopilotClient shape doesn't quite line up with our local
  // ICopilotClient (the SDK uses richer types for session/model config), so
  // we keep the constructor typed loosely here and narrow downstream.
  // biome-ignore lint/suspicious/noExplicitAny: SDK constructor shape varies
  let CopilotClient: new () => any;
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
  const sdkClient = new CopilotClient();
  // biome-ignore lint/suspicious/noExplicitAny: CopilotClient doesn't implement our ICopilotClient exactly
  const adapter = new SdkCopilotAdapter(sdkClient as any);
  const client = sdkClient as ICopilotClient;

  // Cache models lookup — listModels() requires the SDK subprocess to be
  // started first (createSession does this implicitly, listModels does not).
  // Best-effort: if the start/lookup fails we silently skip the pre-flight.
  let modelsCache: CopilotModelInfo[] | null | undefined;
  let started = false;
  const loadModels = async (): Promise<CopilotModelInfo[] | null> => {
    if (modelsCache !== undefined) return modelsCache;
    try {
      if (!started && client.start) {
        await client.start();
        started = true;
      }
      modelsCache = client.listModels ? await client.listModels() : null;
    } catch (err) {
      if (process.env.MINIH_DEBUG) {
        process.stderr.write(
          `[minih:debug] listModels failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      modelsCache = null;
    }
    return modelsCache;
  };

  const validateModelConfig: SdkRuntime['validateModelConfig'] = async ({
    model,
    reasoningEffort,
  }) => {
    if (!model) return { ok: true };
    const models = await loadModels();
    if (!models || models.length === 0) return { ok: true }; // best-effort

    const entry = models.find((m) => m.id === model);
    if (!entry) {
      const available = models.map((m) => m.id);
      const suggestion = nearest(model, available);
      // Unknown model + reasoning is a guaranteed server rejection (the
      // backend treats unknown ids as a no-reasoning fallback). Block it
      // with an actionable message.
      if (reasoningEffort) {
        return {
          ok: false,
          message: `Model '${model}' is not registered with Copilot, so --reasoning '${reasoningEffort}' will be rejected by the server. Drop --reasoning (or --no-reasoning to clear the agent's default), or pick a registered model.${
            suggestion ? ` Closest match: '${suggestion}'.` : ''
          } Available: ${available.join(', ')}`,
          details: { model, reasoningEffort, available, suggestion },
        };
      }
      // Unknown model, no reasoning — let the request through. The server
      // may accept it (e.g. newly-rolled-out models that haven't landed in
      // models.list yet), or reject with its own error.
      process.stderr.write(
        chalk.yellow(
          `  ⚠ Model '${model}' is not in copilot-sdk's models.list — continuing anyway.${
            suggestion ? ` (Closest registered: '${suggestion}'.)` : ''
          }\n`,
        ),
      );
      return { ok: true };
    }

    if (reasoningEffort) {
      const supports = entry.capabilities?.supports?.reasoningEffort === true;
      const allowed = entry.supportedReasoningEfforts ?? [];
      if (!supports) {
        return {
          ok: false,
          message: `Model '${model}' does not support --reasoning. Remove the --reasoning flag (or the 'reasoning:' frontmatter on the agent), or pick a model that supports reasoning effort.`,
          details: { model, reasoningEffort },
        };
      }
      if (allowed.length > 0 && !allowed.includes(reasoningEffort)) {
        return {
          ok: false,
          message: `Model '${model}' does not support reasoning effort '${reasoningEffort}'. Supported: ${allowed.join(', ')}.`,
          details: { model, reasoningEffort, supported: allowed },
        };
      }
    }
    return { ok: true };
  };

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

  return { adapter, validateModelConfig, cleanup };
}

/** Pick the closest known model id by Levenshtein distance — null if no plausible match. */
function nearest(target: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Math.max(3, Math.floor(target.length / 2));
  for (const c of candidates) {
    const d = levenshtein(target.toLowerCase(), c.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
