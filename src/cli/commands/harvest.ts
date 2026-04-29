/**
 * minih harvest <slug> — capture an agent's retrospective into the project ledger.
 *
 * Plan 011 / Workshop 002 — the explicit operator-side surface for moving
 * an agent's `retrospective` (from `output/report.json`) into the
 * project-level retro ledger at `docs/retros/<slug>.md` (and
 * `docs/retros/<plan-id>.md` when `MINIH_PLAN_ID` is set in the run's env
 * at execution time, which we read from completed.json's environment context
 * — for now we read MINIH_PLAN_ID directly from the calling process env,
 * matching the runner's auto-append behavior).
 *
 * Modes:
 *   - Single (default): harvest the latest run for <slug>.
 *   - Batch (`--since <ref>`): harvest every run whose
 *     `completed.json.completedAt` is newer than <ref>. <ref> may be an ISO
 *     timestamp (`Date.parse`-compatible).
 *
 * Always idempotent (the writer scans for `runId: <id>` before appending).
 *
 * `MINIH_NO_AUTO_HARVEST` is IGNORED by this command — it is a kill-switch
 * for runtime auto-append only; the explicit verb is the operator's escape
 * hatch and always writes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import {
  appendRetroEntry,
  appendRetroStub,
  RetroLedgerError,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

interface HarvestOpts {
  run?: string;
  since?: string;
  agentsDir?: string;
  ledgerDir?: string;
}

interface HarvestedEntry {
  runId: string;
  slug: string;
  ledgerPaths: string[];
  kind: 'retro' | 'stub';
}

interface SkippedEntry {
  runId: string;
  reason: string;
}

interface ParsedRetroFromReport {
  summary: string | null;
  magicWand: string | null;
  magicWandTarget: string | null;
  difficulties: Array<{
    category: string;
    description: string;
    workaround: string | null;
    severity: string;
  }> | null;
}

function readJsonOrNull<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function extractRetrospective(
  reportPath: string,
): ParsedRetroFromReport | null {
  const report = readJsonOrNull<{ retrospective?: ParsedRetroFromReport }>(
    reportPath,
  );
  if (!report?.retrospective) return null;
  return report.retrospective;
}

function listRunDirs(slug: string, agentsDir: string): string[] {
  const runsDir = path.join(agentsDir, slug, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .map((id) => path.join(runsDir, id))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

function latestRunDir(slug: string, agentsDir: string): string | null {
  const dirs = listRunDirs(slug, agentsDir);
  if (dirs.length === 0) return null;
  // Run IDs sort lexicographically by ISO timestamp prefix.
  return dirs.sort().reverse()[0] ?? null;
}

function buildLedgerPaths(
  ledgerDir: string,
  slug: string,
  planId: string | null,
): string[] {
  const paths = [path.join(ledgerDir, `${slug}.md`)];
  if (planId) paths.push(path.join(ledgerDir, `${planId}.md`));
  return paths;
}

async function harvestOne(
  slug: string,
  runDir: string,
  ledgerDir: string,
  planId: string | null,
): Promise<HarvestedEntry | SkippedEntry> {
  const runId = path.basename(runDir);
  const completed = readJsonOrNull<{ result?: string }>(
    path.join(runDir, 'completed.json'),
  );
  const reportPath = path.join(runDir, 'output', 'report.json');
  const retrospective = extractRetrospective(reportPath);

  try {
    if (retrospective) {
      await appendRetroEntry({
        slug,
        runId,
        runDir,
        retrospective,
        planId: planId ?? undefined,
        ledgerDir,
      });
      return {
        runId,
        slug,
        ledgerPaths: buildLedgerPaths(ledgerDir, slug, planId),
        kind: 'retro',
      };
    }
    // No retrospective — write a stub if completed.json says terminal failure
    if (completed?.result && completed.result !== 'completed') {
      const result =
        completed.result === 'timeout'
          ? 'timeout'
          : completed.result === 'degraded'
            ? 'failed'
            : 'failed';
      const stderrPath = path.join(runDir, 'stderr.log');
      let stderrTail = '';
      try {
        const tail = fs.readFileSync(stderrPath, 'utf-8').split('\n');
        stderrTail = tail.filter((l) => l.trim().length > 0).slice(-1)[0] ?? '';
      } catch {
        /* ignore */
      }
      await appendRetroStub({
        slug,
        runId,
        runDir,
        result,
        stderrTail,
        planId: planId ?? undefined,
        ledgerDir,
      });
      return {
        runId,
        slug,
        ledgerPaths: buildLedgerPaths(ledgerDir, slug, planId),
        kind: 'stub',
      };
    }
    return { runId, reason: 'no retrospective and no terminal failure marker' };
  } catch (err) {
    if (err instanceof RetroLedgerError) {
      return { runId, reason: err.message };
    }
    return {
      runId,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function isSkipped(e: HarvestedEntry | SkippedEntry): e is SkippedEntry {
  return 'reason' in e;
}

export function registerHarvestCommand(program: Command): void {
  program
    .command('harvest <slug>')
    .description(
      "Capture an agent's retrospective into docs/retros/<slug>.md (and per-plan ledger when MINIH_PLAN_ID is set)",
    )
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  minih harvest code-review-companion              # latest run\n' +
        '  minih harvest code-review-companion --run <id>   # specific run\n' +
        '  minih harvest code-review-companion --since 2026-04-29  # batch since ISO date\n' +
        '\nNote: MINIH_NO_AUTO_HARVEST is IGNORED — explicit harvest always writes.\n',
    )
    .option('--run <runId>', 'Harvest a specific run (default: latest)')
    .option(
      '--since <ref>',
      'Batch mode: harvest every run with completedAt newer than <ref> (ISO timestamp)',
    )
    .option(
      '--agents-dir <path>',
      'Override the agents directory (default: ./agents)',
    )
    .option(
      '--ledger-dir <path>',
      'Override the ledger directory (default: ./docs/retros)',
    )
    .action(async (slug: string, opts: HarvestOpts) => {
      const cwd = process.cwd();
      const agentsDir = path.resolve(
        opts.agentsDir ?? path.join(cwd, 'agents'),
      );
      const ledgerDir = path.resolve(
        opts.ledgerDir ?? path.join(cwd, 'docs', 'retros'),
      );
      const planId = process.env.MINIH_PLAN_ID ?? null;

      // Resolve target run dirs
      let runDirs: string[];
      if (opts.run) {
        const dir = path.join(agentsDir, slug, 'runs', opts.run);
        if (!fs.existsSync(dir)) {
          exitWithEnvelope(
            formatError(
              'harvest',
              ErrorCodes.AGENT_VALIDATION_FAILED,
              `Run "${opts.run}" not found for agent "${slug}".`,
            ),
          );
          return;
        }
        runDirs = [dir];
      } else if (opts.since) {
        const sinceMs = Date.parse(opts.since);
        if (Number.isNaN(sinceMs)) {
          exitWithEnvelope(
            formatError(
              'harvest',
              ErrorCodes.INVALID_ARGS,
              `--since <ref> must be an ISO timestamp; got: ${opts.since}`,
            ),
          );
          return;
        }
        runDirs = listRunDirs(slug, agentsDir).filter((dir) => {
          const completed = readJsonOrNull<{ completedAt?: string }>(
            path.join(dir, 'completed.json'),
          );
          if (!completed?.completedAt) return false;
          const t = Date.parse(completed.completedAt);
          return Number.isFinite(t) && t > sinceMs;
        });
      } else {
        const latest = latestRunDir(slug, agentsDir);
        if (!latest) {
          exitWithEnvelope(
            formatError(
              'harvest',
              ErrorCodes.AGENT_VALIDATION_FAILED,
              `No runs found for agent "${slug}".`,
            ),
          );
          return;
        }
        runDirs = [latest];
      }

      const harvested: HarvestedEntry[] = [];
      const skipped: SkippedEntry[] = [];

      for (const dir of runDirs) {
        const result = await harvestOne(slug, dir, ledgerDir, planId);
        if (isSkipped(result)) {
          skipped.push(result);
        } else {
          harvested.push(result);
        }
      }

      if (process.stderr.isTTY) {
        process.stderr.write(
          `\nHarvested ${harvested.length} run(s) for ${slug}` +
            (skipped.length > 0 ? `; ${skipped.length} skipped` : '') +
            '\n',
        );
        for (const h of harvested) {
          process.stderr.write(
            `  ✓ ${h.runId} → ${h.ledgerPaths.join(', ')} (${h.kind})\n`,
          );
        }
        for (const s of skipped) {
          process.stderr.write(`  · ${s.runId} skipped: ${s.reason}\n`);
        }
      }

      exitWithEnvelope(
        formatSuccess('harvest', {
          slug,
          ledgerDir,
          planId,
          harvested,
          skipped,
        }),
      );
    });
}
