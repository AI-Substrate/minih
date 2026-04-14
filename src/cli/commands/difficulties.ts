/**
 * minih difficulties — aggregate difficulty reports across all agent runs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { Command } from 'commander';
import { listAgents, resolveAgent, validateSlug } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

interface DifficultyEntry {
  id: string;
  category: string;
  description: string;
  workaround: string | null;
  severity: string;
  agent: string;
  runId: string;
}

export function registerDifficultiesCommand(program: Command): void {
  program
    .command('difficulties')
    .description('Aggregate difficulty reports across all agent runs')
    .option('--agent <slug>', 'Filter to a specific agent')
    .action((opts: { agent?: string }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';

      // Validate --agent flag if provided
      if (opts.agent) {
        const slugError = validateSlug(opts.agent);
        if (slugError) {
          exitWithEnvelope(
            formatError('difficulties', ErrorCodes.INVALID_ARGS, slugError),
          );
        }
        if (!resolveAgent(opts.agent, agentsDir)) {
          exitWithEnvelope(
            formatError(
              'difficulties',
              ErrorCodes.AGENT_NOT_FOUND,
              `Agent "${opts.agent}" not found.`,
            ),
          );
          return;
        }
      }

      const agents = listAgents(agentsDir);
      const filteredAgents = opts.agent
        ? agents.filter((a) => a.slug === opts.agent)
        : agents;

      const entries: DifficultyEntry[] = [];
      let idCounter = 1;

      for (const agent of filteredAgents) {
        const runsDir = path.join(agent.dir, 'runs');
        if (!fs.existsSync(runsDir)) continue;

        const runDirs = fs
          .readdirSync(runsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .sort((a, b) => b.name.localeCompare(a.name));

        for (const runDir of runDirs) {
          // Only read completed runs
          const completedPath = path.join(
            runsDir,
            runDir.name,
            'completed.json',
          );
          try {
            if (!fs.existsSync(completedPath)) continue;
            const meta = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
            if (meta.result !== 'completed' && meta.result !== 'degraded')
              continue;
          } catch {
            continue;
          }

          // Read report.json for difficulties
          const reportPath = path.join(
            runsDir,
            runDir.name,
            'output',
            'report.json',
          );
          try {
            if (!fs.existsSync(reportPath)) continue;
            const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
            const difficulties = report?.retrospective?.difficulties;
            if (!Array.isArray(difficulties)) continue;

            for (const d of difficulties) {
              if (
                typeof d !== 'object' ||
                !d ||
                typeof d.description !== 'string'
              )
                continue;
              entries.push({
                id: `MH-${String(idCounter++).padStart(3, '0')}`,
                category: String(d.category ?? 'unknown'),
                description: d.description,
                workaround: d.workaround ?? null,
                severity: String(d.severity ?? 'unknown'),
                agent: agent.slug,
                runId: runDir.name,
              });
            }
          } catch {}
        }
      }

      // Compute frequency by exact description
      const freqMap = new Map<string, number>();
      for (const e of entries) {
        freqMap.set(e.description, (freqMap.get(e.description) ?? 0) + 1);
      }

      if (process.stderr.isTTY) {
        if (entries.length === 0) {
          process.stderr.write(
            `\n  ${chalk.dim('No difficulties reported across agent runs.')}\n\n`,
          );
        } else {
          process.stderr.write(
            `\n  ${chalk.bold('Difficulty Ledger')} (${entries.length} entries)\n\n`,
          );

          const table = new Table({
            head: [
              chalk.bold('ID'),
              chalk.bold('Category'),
              chalk.bold('Description'),
              chalk.bold('Agent'),
              chalk.bold('Freq'),
              chalk.bold('Severity'),
            ],
            style: { head: [], border: [] },
            colWidths: [10, 12, 50, 16, 6, 12],
            wordWrap: true,
          });

          for (const e of entries) {
            const sevColor =
              e.severity === 'blocking'
                ? chalk.red
                : e.severity === 'degrading'
                  ? chalk.yellow
                  : chalk.dim;
            table.push([
              chalk.cyan(e.id),
              e.category,
              e.description.slice(0, 100),
              chalk.dim(e.agent),
              String(freqMap.get(e.description) ?? 1),
              sevColor(e.severity),
            ]);
          }

          process.stderr.write(`${table.toString()}\n\n`);
        }
      }

      exitWithEnvelope(
        formatSuccess('difficulties', {
          entries,
          count: entries.length,
          ...(opts.agent && { agent: opts.agent }),
        }),
      );
    });
}
