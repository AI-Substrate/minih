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
          table.push([
            chalk.dim(run.runId),
            resultColor(run.result),
            duration,
            validated,
          ]);
        }

        process.stderr.write(`${table.toString()}\n\n`);
      }

      exitWithEnvelope(formatSuccess('history', { runs, count: runs.length }));
    });
}
