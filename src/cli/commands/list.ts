/**
 * minih list — show available agents with descriptions.
 */

import * as fs from 'node:fs';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { Command } from 'commander';
import { listAgents } from '../../runner/index.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List available agent definitions')
    .action(() => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const agents = listAgents(agentsDir);

      if (!process.stdout.isTTY) {
        exitWithEnvelope(
          formatSuccess('list', {
            agents: agents.map((a) => {
              const requiredParams = getRequiredParams(a.inputSchemaPath);
              return {
                slug: a.slug,
                description: a.description,
                tags: a.tags,
                hasOutputSchema: a.schemaPath !== null,
                hasInstructions: a.instructionsPath !== null,
                hasInputSchema: a.inputSchemaPath !== null,
                ...(requiredParams.length > 0 && { requiredParams }),
              };
            }),
            count: agents.length,
          }),
        );
      }

      if (agents.length === 0) {
        process.stderr.write(
          chalk.yellow(
            '\n  No agents found. Run `minih init <slug>` to create one.\n\n',
          ),
        );
        exitWithEnvelope(formatSuccess('list', { agents: [], count: 0 }));
      }

      const table = new Table({
        head: [
          chalk.bold('Agent'),
          chalk.bold('Description'),
          chalk.bold('Params'),
        ],
        style: { head: [], border: [] },
      });

      for (const agent of agents) {
        const params = getRequiredParams(agent.inputSchemaPath);
        const paramsStr =
          params.length > 0 ? chalk.dim(params.join(', ')) : chalk.dim('—');
        table.push([chalk.cyan(agent.slug), agent.description, paramsStr]);
      }

      process.stderr.write(`\n${table.toString()}\n\n`);

      exitWithEnvelope(
        formatSuccess('list', {
          agents: agents.map((a) => ({
            slug: a.slug,
            description: a.description,
            tags: a.tags,
            hasOutputSchema: a.schemaPath !== null,
            hasInstructions: a.instructionsPath !== null,
            hasInputSchema: a.inputSchemaPath !== null,
          })),
          count: agents.length,
        }),
      );
    });
}

function getRequiredParams(inputSchemaPath: string | null): string[] {
  if (!inputSchemaPath || !fs.existsSync(inputSchemaPath)) return [];
  try {
    const schema = JSON.parse(fs.readFileSync(inputSchemaPath, 'utf-8'));
    return schema.required ?? [];
  } catch {
    return [];
  }
}
