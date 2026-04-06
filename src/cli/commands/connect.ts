/**
 * minih connect <slug> — print copilot CLI resume command for session handoff.
 *
 * No SDK interaction. Just reads completed.json, gets sessionId,
 * and prints a ready-to-paste command. The user can then drop into
 * the Copilot CLI for free-form interactive conversation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { Command } from 'commander';
import {
  findRunSession,
  resolveAgent,
  validateSlug,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerConnectCommand(program: Command): void {
  program
    .command('connect <slug>')
    .description(
      'Print copilot CLI command to resume an agent session interactively',
    )
    .option('--run <runId>', 'Connect to a specific run (default: latest)')
    .option('--list', 'List all runs with their session IDs')
    .action(
      (
        slug: string,
        opts: {
          run?: string;
          list?: boolean;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        const slugError = validateSlug(slug);
        if (slugError) {
          exitWithEnvelope(
            formatError('connect', ErrorCodes.INVALID_ARGS, slugError),
          );
        }

        const definition = resolveAgent(slug, agentsDir);
        if (!definition) {
          exitWithEnvelope(
            formatError(
              'connect',
              ErrorCodes.AGENT_NOT_FOUND,
              `Agent "${slug}" not found.`,
            ),
          );
          return;
        }

        // --list mode: show all runs with session IDs
        if (opts.list) {
          const runsDir = path.join(definition.dir, 'runs');
          if (!fs.existsSync(runsDir)) {
            exitWithEnvelope(formatSuccess('connect', { runs: [], count: 0 }));
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
                const meta = JSON.parse(
                  fs.readFileSync(completedPath, 'utf-8'),
                );
                return {
                  runId: e.name,
                  sessionId: meta.sessionId ?? null,
                  completedAt: meta.completedAt ?? null,
                  result: meta.result ?? 'unknown',
                  durationMs: meta.durationMs ?? null,
                  resumedFromRunId: meta.resumedFromRunId ?? null,
                };
              } catch {
                return {
                  runId: e.name,
                  sessionId: null,
                  completedAt: null,
                  result: 'unknown',
                };
              }
            }
            return {
              runId: e.name,
              sessionId: null,
              completedAt: null,
              result: 'incomplete',
            };
          });

          if (process.stderr.isTTY && runs.length > 0) {
            process.stderr.write(
              `\n  ${chalk.bold(`Sessions: ${slug}`)} (${runs.length} runs)\n\n`,
            );

            const table = new Table({
              head: [
                chalk.bold('Run ID'),
                chalk.bold('Timestamp'),
                chalk.bold('Session ID'),
                chalk.bold('Result'),
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
              const timestamp = run.completedAt
                ? new Date(run.completedAt).toLocaleString()
                : '—';
              table.push([
                chalk.dim(run.runId),
                chalk.dim(timestamp),
                run.sessionId ? chalk.dim(run.sessionId) : chalk.red('—'),
                resultColor(run.result),
              ]);
            }

            process.stderr.write(`${table.toString()}\n\n`);
          }

          exitWithEnvelope(
            formatSuccess('connect', { runs, count: runs.length }),
          );
          return;
        }

        // Default: print connect command for latest (or specific) run
        const session = findRunSession(slug, agentsDir, opts.run);
        if (!session) {
          const hint = opts.run
            ? `Run "${opts.run}" not found or has no session.`
            : `No completed runs found for "${slug}".`;
          exitWithEnvelope(
            formatError(
              'connect',
              ErrorCodes.AGENT_VALIDATION_FAILED,
              `${hint} Run \`minih run ${slug}\` first.`,
            ),
          );
          return;
        }

        const shellQuote = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;
        const command = `cd ${shellQuote(session.runDir)} && copilot --yolo --resume=${session.sessionId}`;

        if (process.stderr.isTTY) {
          process.stderr.write(`\n  ${chalk.bold(`Connect: ${slug}`)}\n\n`);
          process.stderr.write(
            `  ${chalk.dim('Session:')} ${session.sessionId}\n`,
          );
          process.stderr.write(
            `  ${chalk.dim('Run:')}     ${session.runId}\n\n`,
          );
          process.stderr.write(`  ${chalk.cyan(command)}\n\n`);
        }

        exitWithEnvelope(
          formatSuccess('connect', {
            slug,
            sessionId: session.sessionId,
            runId: session.runId,
            runDir: session.runDir,
            command,
          }),
        );
      },
    );
}
