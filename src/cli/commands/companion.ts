/**
 * `minih companion status <slug> [--run <id>] [--json]` — plan 027 Phase 4 (#36).
 *
 * Read-only outside surface over the SAME pure `deriveCompanionLedger` runner
 * deriver the inside `coordination_status` MCP tool uses, so the two surfaces
 * never diverge. Emits a `MinihEnvelope` to stdout; an optional human table is
 * written to stderr (TTY only, suppressed by `--json`).
 *
 * Import direction: `cli → runner` (legal). Parent+child registration mirrors
 * `commands/runs.ts`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Table from 'cli-table3';
import type { Command } from 'commander';
import {
  buildDraftFarewell,
  type CompanionLedger,
  CompanionLedgerError,
  coordinationRunDir,
  coordinationRunLocation,
  deriveCompanionLedger,
  sortRunIdsNewestFirst,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

interface StatusOpts {
  run?: string;
  json?: boolean;
}

export function registerCompanionCommand(program: Command): void {
  const companion = program
    .command('companion')
    .description('Inspect companion coordination lifecycle');

  companion
    .command('status <slug>')
    .description(
      "Show a companion run's derived coordination lifecycle ledger (#36)",
    )
    .option(
      '--run <id>',
      'Target run id (default: the most recent run for the slug)',
    )
    .option('--json', 'Emit only the JSON envelope (suppress the human table)')
    .action((slug: string, opts: StatusOpts) => {
      const agentsDir: string = program.opts().agentsDir ?? 'agents';

      const runId = opts.run ?? latestRunId(agentsDir, slug);
      if (!runId) {
        exitWithEnvelope(
          formatError(
            'companion.status',
            ErrorCodes.RUN_NOT_FOUND,
            `No runs found for companion "${slug}" under ${agentsDir}.`,
          ),
        );
      }

      const location = coordinationRunLocation(slug, agentsDir, runId);
      if (!fs.existsSync(coordinationRunDir(location))) {
        exitWithEnvelope(
          formatError(
            'companion.status',
            ErrorCodes.RUN_NOT_FOUND,
            `Run "${slug}/${runId}" not found.`,
          ),
        );
      }

      let ledger: CompanionLedger;
      try {
        ledger = deriveCompanionLedger(location);
      } catch (err) {
        if (err instanceof CompanionLedgerError) {
          exitWithEnvelope(
            formatError(
              'companion.status',
              ErrorCodes.INBOX_CORRUPT,
              err.message,
            ),
          );
        }
        throw err;
      }

      const draftFarewell = buildDraftFarewell(ledger);
      if (!opts.json) renderLedgerTable(slug, runId, ledger);

      exitWithEnvelope(
        formatSuccess('companion.status', {
          slug,
          runId,
          ledger,
          draftFarewell,
        }),
      );
    });
}

/**
 * Newest run id under `agents/<slug>/runs`, by recorded startedAt (true UTC) —
 * NOT a lexical folder-name sort: old folders encode local time mislabeled `Z`
 * (defect D), so a name sort could return a stale run as "newest".
 */
function latestRunId(agentsDir: string, slug: string): string | undefined {
  const runsDir = path.join(agentsDir, slug, 'runs');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const runIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  return sortRunIdsNewestFirst(runsDir, runIds)[0];
}

function renderLedgerTable(
  slug: string,
  runId: string,
  ledger: CompanionLedger,
): void {
  if (!process.stderr.isTTY) return;
  const table = new Table({
    head: ['Field', 'Value'],
    style: { head: [], border: [] },
  });
  table.push(
    ['Agent', slug],
    ['Run', runId],
    ['Mode', ledger.coordinationMode],
    ['State', ledger.state ?? '—'],
    ['Reviewed', String(ledger.reviewedIds.length)],
    ['Findings', String(ledger.findingsCount)],
    ['Summaries', String(ledger.summariesCount)],
    ['Unresolved', String(ledger.unresolvedPeerRequests)],
    ['Idle', ledger.idleElapsedMs === null ? '—' : `${ledger.idleElapsedMs}ms`],
  );
  process.stderr.write(`\n${table.toString()}\n`);
}
