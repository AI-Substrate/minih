/**
 * minih view <slug> — read-only attached human view of an agent run.
 *
 * Plan 009 Phase 2. Resolves the run via `resolveRun` with fallback chain
 * `latest-active` → `latest-completed` (per validation 2026-04-30 Completeness E2).
 * Mounts the Ink renderer to stderr; does NOT take input write capability
 * (cross-process attach is `attached-read-only` per finding 03).
 *
 * Snapshot mode (`--snapshot`) is deferred to Phase 3.
 */

import type { Command } from 'commander';
import {
  MultipleActiveRunsError,
  type ResolvedRun,
  resolveRun,
} from '../../runner/index.js';
import { mountHumanApp, pushHumanModel } from '../human/app.js';
import { createInputBridge } from '../human/input-bridge.js';
import { createRunFeed } from '../human/run-feed.js';
import { ErrorCodes, exitWithEnvelope, formatError } from '../output.js';

export function registerViewCommand(program: Command): void {
  program
    .command('view <slug>')
    .description(
      'Attach to an agent run as a read-only human view (renders to stderr; deferred --snapshot in Phase 3)',
    )
    .option(
      '--run <id>',
      'Target run id (forces by-id resolution; otherwise latest-active falls back to latest-completed)',
    )
    .option(
      '--agents-dir <dir>',
      'Override agents directory (default cwd/agents)',
    )
    .action(
      async (
        slug: string,
        opts: { run?: string; agentsDir?: string },
      ): Promise<void> => {
        let resolved: ResolvedRun | null = null;
        try {
          resolved = await resolveRunWithFallback(
            slug,
            opts.run,
            opts.agentsDir,
          );
        } catch (err) {
          if (err instanceof MultipleActiveRunsError) {
            const envelope = formatError(
              'view',
              ErrorCodes.AMBIGUOUS_RUN_ID,
              `Multiple active runs found for "${slug}". Pass --run <id>.`,
              { candidates: err.candidates },
            );
            exitWithEnvelope(envelope);
            return;
          }
          const envelope = formatError(
            'view',
            ErrorCodes.RUN_NOT_FOUND,
            `Could not resolve run for "${slug}": ${(err as Error).message}`,
            { slug, runIdFlag: opts.run ?? null },
          );
          exitWithEnvelope(envelope);
          return;
        }

        if (!resolved) {
          const envelope = formatError(
            'view',
            ErrorCodes.RUN_NOT_FOUND,
            `No active or completed run found for "${slug}".`,
            {
              slug,
              tried: ['latest-active', 'latest-completed'],
            },
          );
          exitWithEnvelope(envelope);
          return;
        }

        const runDir = resolved.runDir;
        const runStatus = resolved.manifest?.status ?? 'unknown';
        const isTerminal = runStatus === 'completed' || runStatus === 'failed';

        const feed = await createRunFeed({
          runDir,
          onUpdate: (model) => {
            pushHumanModel(model);
          },
        });

        const initial = await feed.readSnapshot();
        const initialModel = await import('../../runner/index.js').then((m) =>
          m.buildHumanViewModel(initial),
        );

        const bridge = createInputBridge({
          sender: undefined,
          attached: true,
          runStatus: isTerminal ? 'completed' : 'active',
        });

        const handle = mountHumanApp({
          feed,
          bridge,
          initial: initialModel,
        });

        const onSignal = (): void => {
          handle.unmount();
        };
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);

        await handle.waitUntilExit();
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
      },
    );
}

async function resolveRunWithFallback(
  slug: string,
  runIdFlag: string | undefined,
  agentsDirOverride: string | undefined,
): Promise<ResolvedRun | null> {
  if (runIdFlag) {
    return resolveRun({
      slug,
      mode: { kind: 'by-id', runId: runIdFlag },
      agentsDir: agentsDirOverride,
    });
  }
  // Try latest-active first; on miss, fall back to latest-completed.
  try {
    const active = await resolveRun({
      slug,
      mode: { kind: 'latest-active' },
      agentsDir: agentsDirOverride,
    });
    if (active) return active;
  } catch (err) {
    // MultipleActiveRunsError must propagate; "no active run" should fall through.
    if (err instanceof MultipleActiveRunsError) throw err;
  }
  try {
    return await resolveRun({
      slug,
      mode: { kind: 'latest-completed' },
      agentsDir: agentsDirOverride,
    });
  } catch {
    return null;
  }
}
