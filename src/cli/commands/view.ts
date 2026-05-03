/**
 * minih view <slug> — read-only attached human view of an agent run.
 *
 * Plan 009 Phase 2. Resolves the run via `resolveRun` with fallback chain
 * `latest-active` → `latest-completed` (per validation 2026-04-30 Completeness E2).
 * Mounts the Ink renderer to stderr; does NOT take input write capability
 * (cross-process attach is `attached-read-only` per finding 03).
 *
 * FX008 (Plan 016) — `view` retains its read-only contract; the new
 * `minih attach` command (separate file) wires the cross-process write
 * path. `view` now loads the agent definition so the input bridge can
 * resolve to `'input read-only — non-coordinated'` or `'input read-only — completed'`
 * deterministically (vs the old generic `'input read-only'`).
 *
 * Snapshot mode (`--snapshot`) is deferred to Phase 3.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import {
  MultipleActiveRunsError,
  type ResolvedRun,
  resolveAgent,
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

        // FX009 — surface resolver diagnostics (e.g. stale-active runs
        // skipped by the PID-liveness filter) so operators learn about
        // them without being blocked. Single dimmed line per diagnostic.
        for (const diag of resolved.diagnostics) {
          process.stderr.write(
            `[skipped run ${diag.runId}: ${diag.message}]\n`,
          );
        }

        // FX008 — load the agent definition so the bridge resolves to
        // an informative read-only capability label. `view` is read-only
        // by design; we never enable the inbox-write path here. The
        // companion command `minih attach` is the writable counterpart.
        const agentsDir = path.resolve(opts.agentsDir ?? 'agents');
        let coordinated = false;
        try {
          const definition = resolveAgent(slug, agentsDir);
          if (definition !== null) {
            coordinated = definition.coordination?.enabled === true;
          }
        } catch {
          // If we can't resolve the agent (deleted, renamed, ...) we still
          // want to mount the read-only view — keep coordinated=false.
        }

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
          runDir,
          agentSlug: slug,
          coordinated,
        });

        // FX002-5 + F002 — single shared exit guard across all three exit paths
        // (Ctrl-C in TUI, SIGINT/SIGTERM signal, completed-run auto-exit).
        // `setImmediate` gives Ink's `cli-cursor` show + raw-mode reset a tick
        // to land before exit. clearTimeout prevents the auto-exit timer from
        // firing after a Ctrl-C / signal already triggered the exit.
        const exitState: {
          exited: boolean;
          timer: NodeJS.Timeout | null;
          handle: { unmount(): void } | null;
        } = { exited: false, timer: null, handle: null };
        const exit = (code: number): void => {
          if (exitState.exited) return;
          exitState.exited = true;
          if (exitState.timer) clearTimeout(exitState.timer);
          exitState.handle?.unmount();
          setImmediate(() => process.exit(code));
        };

        const handle = mountHumanApp({
          feed,
          bridge,
          initial: initialModel,
          onExitRequest: () => exit(130),
        });
        exitState.handle = handle;

        process.once('SIGINT', () => exit(130));
        process.once('SIGTERM', () => exit(143));

        // FX002-5 — completed-run auto-exit. Without this, viewing a finished
        // run shows a static frame forever.
        if (isTerminal && process.stdin.isTTY) {
          const waitMs = 5000;
          process.stdin.setRawMode?.(true);
          process.stdin.resume();
          process.stdin.once('data', () => exit(0));
          exitState.timer = setTimeout(() => exit(0), waitMs);
        }

        await handle.waitUntilExit();
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
