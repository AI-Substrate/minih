/**
 * minih tail <slug> — follow a running agent's event stream.
 *
 * Not an envelope command — interactive, writes directly to stderr.
 * DYK #2: Polls events.ndjson every 200ms, exits on completed.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  displayEvent,
  resolveAgent,
  validateSlug,
} from '../../runner/index.js';
import { assertOutsideContext } from '../preaction-context.js';

export function registerTailCommand(program: Command): void {
  program
    .command('tail <slug>')
    .description("Follow a running agent's event stream in real-time")
    .hook('preAction', () => {
      assertOutsideContext({
        commandName: 'tail',
        alternatives: [
          'Use the current session transcript or MCP tool results from inside the session.',
          'Run `minih status <slug>` or `minih tail <slug>` from an outside shell.',
        ],
      });
    })
    .option('--run <runId>', 'Specific run ID (default: latest)')
    .action((slug: string, opts: { run?: string }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';

      const slugError = validateSlug(slug);
      if (slugError) {
        process.stderr.write(chalk.red(`Error: ${slugError}\n`));
        process.exit(1);
      }

      const definition = resolveAgent(slug, agentsDir);
      if (!definition) {
        process.stderr.write(chalk.red(`Agent "${slug}" not found.\n`));
        process.exit(1);
      }

      const runsDir = path.join(definition.dir, 'runs');
      if (!fs.existsSync(runsDir)) {
        process.stderr.write(chalk.red(`No runs found for "${slug}".\n`));
        process.exit(1);
      }

      // Find target run
      let runId: string;
      if (opts.run) {
        runId = opts.run;
      } else {
        const entries = fs
          .readdirSync(runsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .sort((a, b) => b.name.localeCompare(a.name));
        if (entries.length === 0) {
          process.stderr.write(chalk.red(`No runs found for "${slug}".\n`));
          process.exit(1);
        }
        runId = entries[0].name;
      }

      const eventsPath = path.join(runsDir, runId, 'events.ndjson');
      const completedPath = path.join(runsDir, runId, 'completed.json');

      process.stderr.write(
        `\n  ${chalk.bold('Tailing:')} ${chalk.cyan(slug)} / ${chalk.dim(runId)}\n`,
      );
      process.stderr.write(
        `  ${chalk.bold('Events:')}  ${chalk.dim(eventsPath)}\n`,
      );
      process.stderr.write(`  Press ${chalk.bold('Ctrl+C')} to stop\n\n`);

      // Read existing events first
      let bytesRead = 0;
      if (fs.existsSync(eventsPath)) {
        const existing = fs.readFileSync(eventsPath, 'utf-8');
        bytesRead = Buffer.byteLength(existing, 'utf-8');
        const lines = existing.split('\n').filter(Boolean);
        const recent = lines.slice(-20);
        if (lines.length > 20) {
          process.stderr.write(
            chalk.dim(`  ... (${lines.length - 20} earlier events)\n\n`),
          );
        }
        for (const line of recent) {
          try {
            displayEvent(JSON.parse(line));
          } catch {
            /* skip malformed */
          }
        }
      }

      // Poll for new events
      const poll = setInterval(() => {
        if (!fs.existsSync(eventsPath)) return;
        const stat = fs.statSync(eventsPath);
        if (stat.size <= bytesRead) return;

        const fd = fs.openSync(eventsPath, 'r');
        const buf = Buffer.alloc(stat.size - bytesRead);
        fs.readSync(fd, buf, 0, buf.length, bytesRead);
        fs.closeSync(fd);
        bytesRead = stat.size;

        for (const line of buf.toString('utf-8').split('\n').filter(Boolean)) {
          try {
            displayEvent(JSON.parse(line));
          } catch {
            /* skip malformed */
          }
        }
      }, 200);

      // Watch for completion
      const completionPoll = setInterval(() => {
        if (fs.existsSync(completedPath)) {
          clearInterval(poll);
          clearInterval(completionPoll);
          try {
            const completed = JSON.parse(
              fs.readFileSync(completedPath, 'utf-8'),
            );
            const resultColor =
              completed.result === 'completed'
                ? chalk.green
                : completed.result === 'degraded'
                  ? chalk.yellow
                  : chalk.red;
            process.stderr.write(`\n${chalk.bold('─── Run Complete ───')}\n`);
            process.stderr.write(
              `  Result:     ${resultColor(completed.result)}\n`,
            );
            process.stderr.write(
              `  Duration:   ${(completed.durationMs / 1000).toFixed(1)}s\n`,
            );
            process.stderr.write(
              `  Events:     ${completed.eventCount} (${completed.toolCallCount} tool calls)\n`,
            );
            const vIcon =
              completed.validated === true
                ? chalk.green('✓')
                : completed.validated === false
                  ? chalk.red('✗')
                  : '—';
            process.stderr.write(`  Validated:  ${vIcon}\n`);
          } catch {
            /* ignore */
          }
          process.exit(0);
        }
      }, 500);

      // Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(poll);
        clearInterval(completionPoll);
        process.stderr.write(chalk.dim('\n  Stopped tailing.\n'));
        process.exit(0);
      });
    });
}
