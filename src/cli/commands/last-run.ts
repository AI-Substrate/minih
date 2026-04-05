/**
 * minih last-run <slug> — show latest run directory and report path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveAgent, validateSlug } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerLastRunCommand(program: Command): void {
  program
    .command('last-run <slug>')
    .description('Print the latest run directory and report path')
    .action((slug: string) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';

      const slugError = validateSlug(slug);
      if (slugError) {
        exitWithEnvelope(
          formatError('last-run', ErrorCodes.INVALID_ARGS, slugError),
        );
      }

      const definition = resolveAgent(slug, agentsDir);
      if (!definition) {
        exitWithEnvelope(
          formatError(
            'last-run',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }

      const runsDir = path.join(definition.dir, 'runs');
      if (!fs.existsSync(runsDir)) {
        exitWithEnvelope(
          formatError(
            'last-run',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            'No runs found.',
          ),
        );
        return;
      }

      const entries = fs
        .readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name));

      if (entries.length === 0) {
        exitWithEnvelope(
          formatError(
            'last-run',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            'No runs found.',
          ),
        );
        return;
      }

      const latestRun = entries[0].name;
      const runDir = path.join(runsDir, latestRun);
      const reportPath = path.join(runDir, 'output', 'report.json');
      const completedPath = path.join(runDir, 'completed.json');

      let metadata = null;
      if (fs.existsSync(completedPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
        } catch {
          /* ignore */
        }
      }

      if (process.stderr.isTTY) {
        const resultColor =
          metadata?.result === 'completed'
            ? chalk.green
            : metadata?.result === 'degraded'
              ? chalk.yellow
              : chalk.red;
        process.stderr.write(`\n  ${chalk.bold(`Last Run: ${slug}`)}\n\n`);
        process.stderr.write(`  Run ID:  ${chalk.dim(latestRun)}\n`);
        process.stderr.write(
          `  Result:  ${resultColor(metadata?.result ?? 'unknown')}\n`,
        );
        process.stderr.write(`  Dir:     ${chalk.dim(runDir)}\n`);
        if (fs.existsSync(reportPath)) {
          process.stderr.write(`  Report:  ${chalk.dim(reportPath)}\n`);
        }
        process.stderr.write('\n');
      }

      exitWithEnvelope(
        formatSuccess('last-run', {
          runId: latestRun,
          runDir,
          reportPath: fs.existsSync(reportPath) ? reportPath : null,
          result: metadata?.result ?? 'unknown',
        }),
      );
    });
}
