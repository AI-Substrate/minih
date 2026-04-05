/**
 * minih validate <slug> — re-validate latest run output against current schema.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  resolveAgent,
  validateOutput,
  validateSlug,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate <slug>')
    .description(
      'Re-validate the most recent run output against current schema',
    )
    .action((slug: string) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';

      const slugError = validateSlug(slug);
      if (slugError) {
        exitWithEnvelope(
          formatError('validate', ErrorCodes.INVALID_ARGS, slugError),
        );
      }

      const definition = resolveAgent(slug, agentsDir);
      if (!definition) {
        exitWithEnvelope(
          formatError(
            'validate',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }

      if (!definition.schemaPath) {
        exitWithEnvelope(
          formatSuccess('validate', {
            validated: null,
            message: 'No output-schema.json defined.',
          }),
        );
        return;
      }

      const runsDir = path.join(definition.dir, 'runs');
      if (!fs.existsSync(runsDir)) {
        exitWithEnvelope(
          formatError(
            'validate',
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
            'validate',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            'No runs found.',
          ),
        );
        return;
      }

      const latestRun = entries[0].name;
      const outputPath = path.join(runsDir, latestRun, 'output', 'report.json');
      const result = validateOutput(definition.schemaPath, outputPath);

      // Update completed.json if re-validation changes the result
      const completedPath = path.join(runsDir, latestRun, 'completed.json');
      let previousResult: string | undefined;
      if (fs.existsSync(completedPath)) {
        try {
          const completed = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
          previousResult = completed.result;
          completed.validated = result.valid;
          completed.validationErrors = result.errors;
          if (result.valid && completed.result === 'degraded') {
            completed.result = 'completed';
          }
          fs.writeFileSync(completedPath, JSON.stringify(completed, null, 2));
        } catch {
          /* ignore parse errors */
        }
      }

      if (process.stderr.isTTY) {
        process.stderr.write(
          `\n  Validating: ${chalk.cyan(slug)} (run ${chalk.dim(latestRun)})\n\n`,
        );
        if (result.valid) {
          process.stderr.write(
            `  ${chalk.green('✓')} Output validates against current schema\n`,
          );
          if (previousResult === 'degraded') {
            process.stderr.write(
              `  ${chalk.dim('Updated completed.json:')} ${chalk.yellow('degraded')} → ${chalk.green('completed')}\n`,
            );
          }
        } else {
          process.stderr.write(`  ${chalk.red('✗')} Validation failed:\n`);
          for (const err of result.errors.slice(0, 5)) {
            process.stderr.write(`    ${chalk.red('·')} ${err}\n`);
          }
        }
        process.stderr.write('\n');
      }

      exitWithEnvelope(
        formatSuccess(
          'validate',
          {
            runId: latestRun,
            validated: result.valid,
            errors: result.errors,
            ...(previousResult && { previousResult }),
            ...(previousResult === 'degraded' &&
              result.valid && { updatedResult: 'completed' }),
          },
          result.valid ? 'ok' : 'degraded',
        ),
      );
    });
}
