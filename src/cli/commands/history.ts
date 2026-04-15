/**
 * minih history <slug> — list past runs for an agent.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { Command } from 'commander';
import { resolveAgent, validateSlug } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history <slug>')
    .description('List past runs for an agent')
    .action((slug: string) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';

      const slugError = validateSlug(slug);
      if (slugError) {
        exitWithEnvelope(
          formatError('history', ErrorCodes.INVALID_ARGS, slugError),
        );
      }

      const definition = resolveAgent(slug, agentsDir);
      if (!definition) {
        exitWithEnvelope(
          formatError(
            'history',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }

      const runsDir = path.join(definition.dir, 'runs');
      if (!fs.existsSync(runsDir)) {
        exitWithEnvelope(formatSuccess('history', { runs: [], count: 0 }));
        return;
      }

      const entries = fs
        .readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name));

      const runs = entries.map((e) => {
        const completedPath = path.join(runsDir, e.name, 'completed.json');
        if (fs.existsSync(completedPath)) {
          try {
            return JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
          } catch {
            return { runId: e.name, result: 'unknown' };
          }
        }
        return { runId: e.name, result: 'incomplete' };
      });

      if (process.stderr.isTTY && runs.length > 0) {
        process.stderr.write(
          `\n  ${chalk.bold(`Run History: ${slug}`)} (${runs.length} runs)\n\n`,
        );

        const table = new Table({
          head: [
            chalk.bold('Run ID'),
            chalk.bold('Result'),
            chalk.bold('Duration'),
            chalk.bold('Trend'),
            chalk.bold('Validated'),
          ],
          style: { head: [], border: [] },
        });

        for (const run of runs.slice(0, 20)) {
          const resultColor =
            run.result === 'completed'
              ? chalk.green
              : run.result === 'degraded'
                ? chalk.yellow
                : chalk.red;
          const duration = run.durationMs
            ? `${(run.durationMs / 1000).toFixed(1)}s`
            : '—';
          const validated =
            run.validated === true
              ? chalk.green('✓')
              : run.validated === false
                ? chalk.red('✗')
                : chalk.dim('—');
          const resumeIndicator = run.resumedFromRunId ? chalk.cyan(' ↩') : '';

          // Velocity trend indicator
          let trend = chalk.dim('—');
          if (run.velocity?.changePercent != null) {
            const pct = run.velocity.changePercent;
            if (pct < -5) {
              trend = chalk.green(`▼ ${Math.abs(pct)}%`);
            } else if (pct > 5) {
              trend = chalk.red(`▲ ${pct}%`);
            }
          }

          table.push([
            chalk.dim(run.runId) + resumeIndicator,
            resultColor(run.result),
            duration,
            trend,
            validated,
          ]);
        }

        process.stderr.write(`${table.toString()}\n`);

        // Velocity summary line
        const completedRuns = runs.filter(
          (r: Record<string, unknown>) =>
            r.result === 'completed' && r.durationMs,
        );
        if (completedRuns.length >= 2) {
          const oldest = completedRuns[completedRuns.length - 1];
          const newest = completedRuns[0];
          const oldDur = (oldest.durationMs / 1000).toFixed(1);
          const newDur = (newest.durationMs / 1000).toFixed(1);
          const pct = (
            ((newest.durationMs - oldest.durationMs) / oldest.durationMs) *
            100
          ).toFixed(0);
          const arrow =
            Number(pct) < 0 ? chalk.green(`${pct}%`) : chalk.red(`+${pct}%`);
          process.stderr.write(
            `  ${chalk.dim(`Velocity: ${oldDur}s → ${newDur}s over ${completedRuns.length} runs (${arrow})`)}\n`,
          );
        }

        process.stderr.write('\n');
      }

      exitWithEnvelope(formatSuccess('history', { runs, count: runs.length }));
    });
}
