/**
 * minih reconcile [slug] [--run <id>] [--all] — plan 025 FX011.
 *
 * Thin shell over the runner's `reconcileRuns` healer, guarded by the
 * reconcile lock (one pass per agents dir; E190 on contention). Heals
 * non-terminal run records whose process is gone: status → 'crashed',
 * terminalReason → 'pid-vanished' (existing diagnoses preserved).
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import {
  ReconcileLockHeldError,
  reconcileRuns,
  validateSlug,
  withReconcileLock,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

/** A wedged reconcile pass should not block healing for long. */
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000;

export function registerReconcileCommand(program: Command): void {
  program
    .command('reconcile [slug]')
    .description(
      'Heal run records whose process is gone (dead pid → status crashed)',
    )
    .option('--run <runId>', 'Limit to one run id (requires a slug)')
    .option(
      '--all',
      'Reconcile every agent under the agents dir (cannot combine with a slug or --run)',
    )
    .action(
      async (
        slug: string | undefined,
        opts: { run?: string; all?: boolean },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        if (!slug && !opts.all) {
          exitWithEnvelope(
            formatError(
              'reconcile',
              ErrorCodes.INVALID_ARGS,
              'Provide an agent slug or pass --all to reconcile every agent.',
            ),
          );
        }
        // --all and slug/--run are contradictory scopes — refuse rather than
        // silently scoping down while reporting `all: true` (plan 025 F001).
        if (opts.all && (slug || opts.run)) {
          exitWithEnvelope(
            formatError(
              'reconcile',
              ErrorCodes.INVALID_ARGS,
              '--all reconciles every agent; do not combine it with a slug or --run.',
            ),
          );
        }
        if (opts.run && !slug) {
          exitWithEnvelope(
            formatError(
              'reconcile',
              ErrorCodes.INVALID_ARGS,
              '--run requires an agent slug.',
            ),
          );
        }
        if (slug) {
          const slugError = validateSlug(slug);
          if (slugError) {
            exitWithEnvelope(
              formatError('reconcile', ErrorCodes.INVALID_ARGS, slugError),
            );
          }
        }

        try {
          const report = await withReconcileLock(
            { agentsDir, staleAfterMs: LOCK_STALE_AFTER_MS },
            async () =>
              reconcileRuns({
                agentsDir,
                ...(slug && { slug }),
                ...(opts.run && { runId: opts.run }),
              }),
          );

          if (process.stderr.isTTY) {
            if (report.healed.length === 0) {
              process.stderr.write(
                `\n  Nothing to heal (${report.scanned} run${report.scanned === 1 ? '' : 's'} scanned).\n\n`,
              );
            } else {
              process.stderr.write(
                `\n  ${chalk.bold(`Healed ${report.healed.length} run${report.healed.length === 1 ? '' : 's'}:`)}\n`,
              );
              for (const healed of report.healed) {
                process.stderr.write(
                  `  ${chalk.red('☠')} ${healed.slug}/${healed.runId}  pid ${healed.pid ?? '?'} gone → crashed\n`,
                );
              }
              process.stderr.write('\n');
            }
          }

          exitWithEnvelope(
            formatSuccess('reconcile', {
              filters: {
                slug: slug ?? null,
                runId: opts.run ?? null,
                all: opts.all === true,
              },
              scanned: report.scanned,
              healed: report.healed,
              healedCount: report.healed.length,
              skipped: report.skipped,
            }),
          );
        } catch (err) {
          if (err instanceof ReconcileLockHeldError) {
            exitWithEnvelope(
              formatError(
                'reconcile',
                ErrorCodes.RECONCILE_IN_PROGRESS,
                err.message,
                { lockPath: err.lockPath },
              ),
            );
            return;
          }
          throw err;
        }
      },
    );
}
