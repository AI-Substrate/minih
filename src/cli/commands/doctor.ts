/**
 * minih doctor — validate the entire agents directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  derivePeerActivity,
  hasOutsideMd,
  OutsideAgentsDirError,
  outsideMdPath,
  type PeerActivity,
  parseFrontmatter,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

interface CheckResult {
  check: string;
  status: 'pass' | 'warning' | 'fail' | 'skip';
  message?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Validate all agents and harness structure')
    .option('--strict', 'Treat warnings as errors')
    .action(async (opts: { strict?: boolean }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const resolvedDir = path.resolve(agentsDir);

      if (!fs.existsSync(resolvedDir)) {
        exitWithEnvelope(
          formatError(
            'doctor',
            ErrorCodes.INVALID_ARGS,
            `Agents directory not found: ${resolvedDir}`,
          ),
        );
        return;
      }

      const agentResults: Array<{ slug: string; checks: CheckResult[] }> = [];

      // Scan all directories (including ones listAgents might skip)
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

        const dir = path.join(resolvedDir, entry.name);
        const promptPath = path.join(dir, 'prompt.md');
        const checks: CheckResult[] = [];

        // Check prompt.md exists
        if (!fs.existsSync(promptPath)) {
          checks.push({
            check: 'prompt.md',
            status: 'fail',
            message: 'No prompt.md found',
          });
          agentResults.push({ slug: entry.name, checks });
          continue;
        }
        checks.push({ check: 'prompt.md', status: 'pass' });

        // Check frontmatter
        const content = fs.readFileSync(promptPath, 'utf-8');
        const { description, coordination } = parseFrontmatter(content);
        if (!description.trim()) {
          checks.push({
            check: 'frontmatter',
            status: 'warning',
            message: 'Missing frontmatter with description',
          });
        } else {
          checks.push({
            check: 'frontmatter',
            status: 'pass',
            message: description,
          });
        }

        // Check output-schema.json
        const schemaPath = path.join(dir, 'output-schema.json');
        if (fs.existsSync(schemaPath)) {
          try {
            const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
            const ajv = createRefAwareAjv();
            ajv.compile(schema);
            checks.push({ check: 'output-schema', status: 'pass' });

            // Check for retrospective in schema
            const hasRetro =
              schema.required?.includes('retrospective') ||
              schema.properties?.retrospective;
            checks.push({
              check: 'retrospective',
              status: hasRetro ? 'pass' : 'warning',
              message: hasRetro
                ? undefined
                : 'retrospective not in output schema (system validation still enforces it)',
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            checks.push({
              check: 'output-schema',
              status: 'fail',
              message: `Schema error: ${msg}`,
            });
          }
        } else {
          checks.push({
            check: 'output-schema',
            status: 'skip',
            message: 'No output-schema.json',
          });
        }

        // Check input-schema.json
        const inputPath = path.join(dir, 'input-schema.json');
        if (fs.existsSync(inputPath)) {
          try {
            const schema = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
            const ajv = createRefAwareAjv();
            ajv.compile(schema);
            checks.push({ check: 'input-schema', status: 'pass' });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            checks.push({
              check: 'input-schema',
              status: 'fail',
              message: `Schema error: ${msg}`,
            });
          }
        }

        // Check instructions
        const instrPath = path.join(dir, 'instructions.md');
        if (fs.existsSync(instrPath)) {
          checks.push({ check: 'instructions', status: 'pass' });
        }

        checks.push(
          ...checkOutsideContract(
            entry.name,
            resolvedDir,
            promptPath,
            coordination.enabled,
          ),
        );

        agentResults.push({ slug: entry.name, checks });
      }

      // Check preamble
      const preamblePath = path.join(resolvedDir, '_shared', 'preamble.md');
      const preamble = {
        exists: fs.existsSync(preamblePath),
        path: preamblePath,
      };

      // Plan 011 — audit the retro ledger. resolvedDir is the agents dir;
      // the project root is its parent.
      const projectRoot = path.dirname(resolvedDir);
      const retroChecks = auditRetroLedger(resolvedDir, projectRoot);

      // Plan 012 — audit peer activity for active coordinated runs.
      const peerAudit = await auditPeerActivity(resolvedDir);

      // Summarize
      let warnings = 0;
      let errors = 0;
      for (const agent of agentResults) {
        for (const check of agent.checks) {
          if (check.status === 'warning') warnings++;
          if (check.status === 'fail') errors++;
        }
      }
      for (const check of retroChecks) {
        if (check.status === 'warning') warnings++;
        if (check.status === 'fail') errors++;
      }
      for (const row of peerAudit.rows) {
        if (row.status === 'warning') warnings++;
      }
      const healthy = agentResults.filter((a) =>
        a.checks.every((c) => c.status === 'pass' || c.status === 'skip'),
      ).length;

      // TTY display
      if (process.stderr.isTTY) {
        process.stderr.write(
          `\n  ${chalk.bold('Checking agents directory:')} ${chalk.dim(resolvedDir)}\n\n`,
        );

        for (const agent of agentResults) {
          process.stderr.write(`  ${chalk.cyan(agent.slug)}\n`);
          for (const check of agent.checks) {
            const icon =
              check.status === 'pass'
                ? chalk.green('✓')
                : check.status === 'warning'
                  ? chalk.yellow('⚠')
                  : check.status === 'fail'
                    ? chalk.red('✗')
                    : chalk.dim('—');
            const msg = check.message ? ` ${chalk.dim(check.message)}` : '';
            process.stderr.write(`    ${icon} ${check.check}${msg}\n`);
          }
          process.stderr.write('\n');
        }

        if (preamble.exists) {
          process.stderr.write(`  ${chalk.green('✓')} _shared/preamble.md\n\n`);
        } else {
          process.stderr.write(
            `  ${chalk.dim('—')} _shared/preamble.md (not found)\n\n`,
          );
        }

        // Plan 011 — render retro audit findings
        if (retroChecks.length > 0) {
          process.stderr.write(`  ${chalk.bold('docs/retros/')}\n`);
          for (const check of retroChecks) {
            const icon =
              check.status === 'pass'
                ? chalk.green('✓')
                : check.status === 'warning'
                  ? chalk.yellow('⚠')
                  : check.status === 'fail'
                    ? chalk.red('✗')
                    : chalk.dim('—');
            const msg = check.message ? ` ${chalk.dim(check.message)}` : '';
            process.stderr.write(`    ${icon} ${check.check}${msg}\n`);
          }
          process.stderr.write('\n');
        }

        // Plan 012 — render peer activity audit
        if (peerAudit.rows.length > 0) {
          process.stderr.write(
            `  ${chalk.bold('🔇 Coordination peer activity')}\n`,
          );
          for (const row of peerAudit.rows) {
            const colour =
              row.verdict === 'deaf'
                ? chalk.red
                : row.verdict === 'silent'
                  ? chalk.yellow
                  : chalk.dim;
            process.stderr.write(
              `    ${colour('⚠')} ${row.slug}/${row.runId}: ${colour(row.verdict)} — ${row.reason}\n`,
            );
          }
          process.stderr.write('\n');
        } else if (peerAudit.activeRuns > 0) {
          process.stderr.write(
            `  ${chalk.green('✓')} ${peerAudit.activeRuns} active coordinated run(s) healthy\n\n`,
          );
        }

        process.stderr.write(`  ${chalk.bold('─── Results ───')}\n`);
        process.stderr.write(`  Agents:   ${agentResults.length} found\n`);
        process.stderr.write(`  Healthy:  ${healthy}\n`);
        if (warnings > 0)
          process.stderr.write(
            `  Warnings: ${chalk.yellow(String(warnings))}\n`,
          );
        if (errors > 0)
          process.stderr.write(`  Errors:   ${chalk.red(String(errors))}\n`);
        process.stderr.write('\n');
      }

      const hasErrors = errors > 0 || (opts.strict && warnings > 0);
      const status = hasErrors ? 'error' : warnings > 0 ? 'degraded' : 'ok';

      if (hasErrors) {
        exitWithEnvelope(
          formatError(
            'doctor',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            `${errors} errors, ${warnings} warnings found`,
            {
              agents: agentResults,
              preamble,
              retros: retroChecks,
              peer: peerAudit.rows,
              summary: {
                total: agentResults.length,
                healthy,
                warnings,
                errors,
              },
            },
          ),
        );
      } else {
        exitWithEnvelope(
          formatSuccess(
            'doctor',
            {
              agents: agentResults,
              preamble,
              retros: retroChecks,
              peer: peerAudit.rows,
              summary: {
                total: agentResults.length,
                healthy,
                warnings,
                errors,
              },
            },
            status as 'ok' | 'degraded',
          ),
        );
      }
    });
}

function checkOutsideContract(
  slug: string,
  agentsDir: string,
  promptPath: string,
  coordinationEnabled: boolean,
): CheckResult[] {
  if (!coordinationEnabled) return [];

  let exists: boolean;
  try {
    exists = hasOutsideMd(slug, agentsDir);
  } catch (error) {
    if (error instanceof OutsideAgentsDirError) {
      return [
        {
          check: 'outside.md',
          status: 'fail',
          message: error.message,
        },
      ];
    }
    throw error;
  }
  if (!exists) return [];

  const outsidePath = outsideMdPath(slug, agentsDir);
  const outsideStats = fs.statSync(outsidePath);
  const promptStats = fs.statSync(promptPath);
  const results: CheckResult[] = [{ check: 'outside.md', status: 'pass' }];

  if (outsideStats.mtimeMs < promptStats.mtimeMs) {
    results.push({
      check: 'outside.md-drift',
      status: 'warning',
      message: 'outside.md is older than prompt.md; review the peer contract.',
    });
  }

  if (outsideStats.size > 8 * 1024) {
    results.push({
      check: 'outside.md-size',
      status: 'fail',
      message: `outside.md is ${outsideStats.size} bytes (> 8192 byte limit).`,
    });
  } else if (outsideStats.size > 4 * 1024) {
    results.push({
      check: 'outside.md-size',
      status: 'warning',
      message: `outside.md is ${outsideStats.size} bytes (> 4096 byte warning threshold).`,
    });
  }

  return results;
}

/**
 * Plan 011 / Workshop 002 — audit retro ledger health.
 *
 * Walks `<agentsDir>/<slug>/runs/` and reports:
 *   - Runs whose `output/report.json` contains a `retrospective.magicWand`
 *     but whose `runId` does NOT appear in `<projectRoot>/docs/retros/<slug>.md`.
 *   - Ledger files in `docs/retros/` exceeding the soft-warn size threshold.
 *
 * Returns `CheckResult` rows added to a synthetic `_retros` slug bucket so
 * doctor's TTY summary surfaces them under their own heading.
 */
const LEDGER_SIZE_WARN_BYTES = 1 * 1024 * 1024; // 1 MB

function auditRetroLedger(
  agentsDir: string,
  projectRoot: string,
): CheckResult[] {
  const results: CheckResult[] = [];
  const ledgerDir = path.join(projectRoot, 'docs', 'retros');

  const ledgerFiles: Record<string, string> = {};
  if (fs.existsSync(ledgerDir)) {
    const files = fs.readdirSync(ledgerDir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(ledgerDir, f);
      try {
        ledgerFiles[f.replace(/\.md$/, '')] = fs.readFileSync(full, 'utf-8');
        const stat = fs.statSync(full);
        if (stat.size > LEDGER_SIZE_WARN_BYTES) {
          results.push({
            check: `ledger/${f}`,
            status: 'warning',
            message: `ledger ${f} is ${(stat.size / 1024 / 1024).toFixed(1)}MB — consider rotating`,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Walk run dirs looking for unharvested retros
  if (!fs.existsSync(agentsDir)) return results;
  const slugDirs = fs.readdirSync(agentsDir, { withFileTypes: true });
  let totalUnharvested = 0;
  for (const slugEntry of slugDirs) {
    if (!slugEntry.isDirectory() || slugEntry.name.startsWith('_')) continue;
    const runsDir = path.join(agentsDir, slugEntry.name, 'runs');
    if (!fs.existsSync(runsDir)) continue;
    const ledgerContent = ledgerFiles[slugEntry.name] ?? '';

    const runEntries = fs.readdirSync(runsDir, { withFileTypes: true });
    for (const runEntry of runEntries) {
      if (!runEntry.isDirectory()) continue;
      const runId = runEntry.name;
      const runDir = path.join(runsDir, runId);
      const reportPath = path.join(runDir, 'output', 'report.json');
      if (!fs.existsSync(reportPath)) continue;

      let report: { retrospective?: { magicWand?: string } } | null = null;
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      } catch {
        continue;
      }
      const wand = report?.retrospective?.magicWand;
      if (!wand) continue;

      if (!ledgerContent.includes(`runId: ${runId}`)) {
        totalUnharvested++;
        results.push({
          check: `unharvested/${slugEntry.name}/${runId}`,
          status: 'warning',
          message: `unharvested retro — run \`minih harvest ${slugEntry.name}\` (or with --since)`,
        });
      }
    }
  }

  if (totalUnharvested === 0 && results.length === 0) {
    results.push({ check: 'retros', status: 'pass' });
  }
  return results;
}

function createRefAwareAjv(): InstanceType<typeof Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true });
  const schemasDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'schemas',
  );
  for (const name of ['retrospective.json', 'system-output.json']) {
    const p = path.join(schemasDir, name);
    if (fs.existsSync(p)) {
      try {
        ajv.addSchema(JSON.parse(fs.readFileSync(p, 'utf-8')));
      } catch {
        // Schema might already be loaded or invalid — skip
      }
    }
  }
  return ajv;
}

// ─── plan 012 peer activity audit ─────────────────────────────────────

interface PeerAuditRow {
  slug: string;
  runId: string;
  verdict: PeerActivity['verdict'];
  reason: string;
  status: 'warning' | 'pass';
}

interface PeerAuditResult {
  rows: PeerAuditRow[];
  activeRuns: number;
}

async function auditPeerActivity(agentsDir: string): Promise<PeerAuditResult> {
  const rows: PeerAuditRow[] = [];
  let activeRuns = 0;

  if (!fs.existsSync(agentsDir)) return { rows, activeRuns };

  const slugDirs = fs.readdirSync(agentsDir, { withFileTypes: true });
  for (const slugEntry of slugDirs) {
    if (!slugEntry.isDirectory() || slugEntry.name.startsWith('_')) continue;
    const runsDir = path.join(agentsDir, slugEntry.name, 'runs');
    if (!fs.existsSync(runsDir)) continue;

    const runEntries = fs.readdirSync(runsDir, { withFileTypes: true });
    for (const runEntry of runEntries) {
      if (!runEntry.isDirectory()) continue;
      const runDir = path.join(runsDir, runEntry.name);

      // Skip completed runs (completed.json present means the run wrapped up)
      if (fs.existsSync(path.join(runDir, 'completed.json'))) continue;

      // Read run.json to determine if active and coordinated
      const runJsonPath = path.join(runDir, 'run.json');
      if (!fs.existsSync(runJsonPath)) continue;
      let manifest: { status?: string } = {};
      try {
        manifest = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
      } catch {
        continue;
      }
      // Skip non-active states (we already skipped completed.json above; the
      // remaining 'completed'/'failed'/'stale' here means a manifest-only
      // termination — also not interesting for live audit)
      if (
        manifest.status &&
        manifest.status !== 'active' &&
        manifest.status !== 'idle' &&
        manifest.status !== 'starting'
      ) {
        continue;
      }

      // Only audit coordinated runs (have state/inside.json)
      if (!fs.existsSync(path.join(runDir, 'state', 'inside.json'))) continue;

      activeRuns++;
      try {
        const peer = await derivePeerActivity({
          runDir,
          messageType: null,
        });
        if (peer.verdict === 'deaf' || peer.verdict === 'silent') {
          rows.push({
            slug: slugEntry.name,
            runId: runEntry.name,
            verdict: peer.verdict,
            reason: peer.reason,
            status: 'warning',
          });
        }
      } catch {
        // tolerate per-run derivation errors silently
      }
    }
  }

  return { rows, activeRuns };
}
