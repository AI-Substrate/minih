/**
 * minih attach <slug> — cross-process read+write TUI for any running agent.
 *
 * FX008 (Plan 016) — workshop 005. The companion to `view`:
 * - `view` is read-only (snapshot inspection / completed-run review)
 * - `attach` is read+write (drop in, follow live, type to the agent, leave)
 *
 * For COORDINATED agents, footer input writes to the outside inbox lane
 * via `appendInboxMessage` (same call path as `outside inbox send`); the
 * agent's inbox forwarder picks it up and delivers to the SDK conversation.
 *
 * For NON-COORDINATED agents, footer input is read-only — the TUI mounts
 * and shows the transcript, but submit refuses with a clear label.
 *
 * Lifecycle invariant — the hard rule:
 *   Ctrl-C / Ctrl-D / SIGINT / SIGTERM in `attach` ALWAYS DETACHES.
 *   It NEVER stops the agent. The run is owned by `minih run`, not by us.
 *   To stop the agent: `outside inbox send --type control --body 'stop'`
 *   or kill its PID directly.
 *
 * Reuses `view.ts`'s exit-state guard pattern verbatim — already correct
 * for read-only and stays correct for read+write because the bridge's
 * write path never triggers signals to other processes.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import {
  coordinationRunLocation,
  MultipleActiveRunsError,
  type ResolvedRun,
  resolveAgent,
  resolveRun,
} from '../../runner/index.js';
import { mountHumanApp, pushHumanModel } from '../human/app.js';
import { createInputBridge } from '../human/input-bridge.js';
import { createRunFeed } from '../human/run-feed.js';
import { ErrorCodes, exitWithEnvelope, formatError } from '../output.js';

export function registerAttachCommand(program: Command): void {
  program
    .command('attach <slug>')
    .description(
      "Attach to a running agent's TUI (read+write for coordinated agents). Ctrl-C detaches without stopping the agent.",
    )
    .option(
      '--run <id>',
      'Target run id (forces by-id resolution; otherwise latest-active)',
    )
    .option(
      '--read-only',
      'Force read-only attach (skip input wiring even if writable)',
      false,
    )
    .option(
      '--agents-dir <dir>',
      'Override agents directory (default cwd/agents)',
    )
    .action(
      async (
        slug: string,
        opts: {
          run?: string;
          readOnly?: boolean;
          agentsDir?: string;
        },
      ): Promise<void> => {
        let resolved: ResolvedRun | null = null;
        try {
          resolved = await resolveAttachRun(slug, opts.run, opts.agentsDir);
        } catch (err) {
          if (err instanceof MultipleActiveRunsError) {
            exitWithEnvelope(
              formatError(
                'attach',
                ErrorCodes.AMBIGUOUS_RUN_ID,
                `Multiple active runs found for "${slug}". Pass --run <id>.`,
                { candidates: err.candidates },
              ),
            );
            return;
          }
          exitWithEnvelope(
            formatError(
              'attach',
              ErrorCodes.RUN_NOT_FOUND,
              `Could not resolve run for "${slug}": ${(err as Error).message}`,
              { slug, runIdFlag: opts.run ?? null },
            ),
          );
          return;
        }

        if (!resolved) {
          exitWithEnvelope(
            formatError(
              'attach',
              ErrorCodes.RUN_NOT_FOUND,
              `No active run found for "${slug}". Use \`minih view\` for completed runs.`,
              { slug, tried: ['latest-active'] },
            ),
          );
          return;
        }

        const runDir = resolved.runDir;
        const runId = resolved.runId;
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

        const agentsDir = path.resolve(opts.agentsDir ?? 'agents');
        let coordinated = false;
        try {
          const definition = resolveAgent(slug, agentsDir);
          if (definition !== null) {
            coordinated = definition.coordination?.enabled === true;
          }
        } catch {
          // Definition unresolvable → keep coordinated=false → read-only fallback.
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

        // The bridge wiring is the heart of `attach`:
        //   attached: true  → cross-process; no SessionSender available
        //   coordinated     → drives whether we get 'input → inbox' or
        //                      'input read-only — non-coordinated'
        //   --read-only     → force read-only by withholding `location`
        const bridge = createInputBridge({
          sender: undefined,
          attached: true,
          runStatus: isTerminal ? 'completed' : 'active',
          runDir,
          agentSlug: slug,
          coordinated,
          commandName: 'attach.input',
          ...(coordinated &&
            !opts.readOnly && {
              location: coordinationRunLocation(slug, agentsDir, runId),
            }),
        });

        // Shared exit guard — copied verbatim from view.ts's correct
        // pattern. Ctrl-C in TUI / SIGINT / SIGTERM all funnel through
        // `exit(code)`. We NEVER signal the run process; this is the
        // load-bearing lifecycle invariant for `attach`.
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
          process.stderr.write(
            `\n[detached at ${runId} — agent continues. To re-attach: minih attach ${slug} --run ${runId}]\n`,
          );
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

async function resolveAttachRun(
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
  // attach prefers a live run only — fallback to completed makes no sense
  // for a write-mode tool. If no active run exists, the operator should
  // use `view` instead. (View's resolver already covers latest-completed.)
  return resolveRun({
    slug,
    mode: { kind: 'latest-active' },
    agentsDir: agentsDirOverride,
  });
}
