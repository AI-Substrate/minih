/**
 * minih check — validate a file against an agent's schema.
 *
 * Designed to be called mid-run by agents for self-validation.
 * Detects MINIH_* env vars for zero-arg usage (Workshop 007).
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import {
  resolveAgent,
  validateOutput,
  validateSlug,
  validateSystemOutput,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerCheckCommand(program: Command): void {
  program
    .command('check [slug]')
    .description('Validate a file against an agent schema')
    .option('--file <path>', 'File to validate')
    .option('--input', 'Validate against input-schema.json instead')
    .action(
      (
        slugArg: string | undefined,
        opts: { file?: string; input?: boolean },
      ) => {
        const agentsDir =
          program.opts().agentsDir ?? process.env.MINIH_AGENTS_DIR ?? 'agents';

        // Resolve slug: explicit arg > env var
        const slug = slugArg ?? process.env.MINIH_AGENT_SLUG;
        if (!slug) {
          exitWithEnvelope(
            formatError(
              'check',
              ErrorCodes.INVALID_ARGS,
              'Provide an agent slug or run inside a minih agent (MINIH_AGENT_SLUG env var).',
            ),
          );
          return;
        }

        const slugError = validateSlug(slug);
        if (slugError) {
          exitWithEnvelope(
            formatError('check', ErrorCodes.INVALID_ARGS, slugError),
          );
          return;
        }

        // Resolve file: --file flag > env var
        const file = opts.file ?? process.env.MINIH_OUTPUT_PATH;
        if (!file) {
          exitWithEnvelope(
            formatError(
              'check',
              ErrorCodes.INVALID_ARGS,
              'Provide --file <path> or run inside a minih agent (MINIH_OUTPUT_PATH env var).',
            ),
          );
          return;
        }

        const definition = resolveAgent(slug, agentsDir);

        // System validation (always)
        const systemResult = validateSystemOutput(file);

        // User schema validation (if requested and schema exists)
        let userResult = null;
        if (opts.input) {
          if (!definition?.inputSchemaPath) {
            exitWithEnvelope(
              formatError(
                'check',
                ErrorCodes.AGENT_VALIDATION_FAILED,
                `Agent "${slug}" has no input-schema.json.`,
              ),
            );
            return;
          }
          userResult = validateOutput(definition.inputSchemaPath, file);
        } else if (definition?.schemaPath) {
          userResult = validateOutput(definition.schemaPath, file);
        }

        const allErrors = [
          ...systemResult.errors,
          ...(userResult?.errors ?? []),
        ];
        const valid =
          systemResult.valid && (userResult ? userResult.valid : true);

        if (process.stderr.isTTY) {
          process.stderr.write(`\n  Checking: ${chalk.dim(file)}\n\n`);

          if (systemResult.valid) {
            process.stderr.write(
              `  ${chalk.green('✓')} System validation passed\n`,
            );
          } else {
            process.stderr.write(
              `  ${chalk.red('✗')} System validation failed:\n`,
            );
            for (const err of systemResult.errors.slice(0, 5)) {
              process.stderr.write(`    ${chalk.red('·')} ${err}\n`);
            }
          }

          if (userResult) {
            if (userResult.valid) {
              process.stderr.write(
                `  ${chalk.green('✓')} Schema validation passed\n`,
              );
            } else {
              process.stderr.write(
                `  ${chalk.red('✗')} Schema validation failed:\n`,
              );
              for (const err of userResult.errors.slice(0, 5)) {
                process.stderr.write(`    ${chalk.red('·')} ${err}\n`);
              }
            }
          }
          process.stderr.write('\n');
        }

        exitWithEnvelope(
          formatSuccess(
            'check',
            {
              slug,
              file,
              valid,
              systemValid: systemResult.valid,
              userValid: userResult ? userResult.valid : null,
              errors: allErrors,
            },
            valid ? 'ok' : 'degraded',
          ),
        );
      },
    );
}
