/**
 * minih quickstart — scaffold hello-world + run it in one command.
 *
 * Zero-to-success in 60 seconds. No flags, no editing.
 * DYK #1: Scaffold BEFORE checking GH_TOKEN so user gets value even without auth.
 * DYK #2: Reuses ensurePreamble from init.ts to avoid template drift.
 * DYK #4: Registered first in index.ts so it's top of --help.
 * DYK #5: Single envelope with scaffolded + run data.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  displayEvent,
  displaySummary,
  PrettyDisplay,
  resolveAgent,
  runAgent,
} from '../../runner/index.js';
import { exitWithEnvelope, formatError, formatSuccess } from '../output.js';
import { ensurePreamble } from './init.js';
import { createSdkRuntime } from './sdk-runtime.js';

const HELLO_WORLD_PROMPT = `---
description: Confirm minih is working by reporting your environment and capabilities
tags: [smoke, minimal]
---

# Hello World

You are running inside minih. Confirm this by:

1. Run \`cd {{REPO_ROOT}} && pwd\` and report your working directory
2. Run \`ls\` to see what files are in the project root
3. Report the current date and time
4. Describe what tools you have available

Include your findings in the \`summary\` field of your JSON output.
`;

export function registerQuickstartCommand(program: Command): void {
  program
    .command('quickstart')
    .description('Create and run your first agent in one command')
    .addHelpText('after', '\nExample:\n  minih quickstart\n')
    .action(async () => {
      const agentsDir = path.resolve(program.opts().agentsDir ?? 'agents');
      const isTTY = process.stderr.isTTY;
      const slug = 'hello-world';
      const agentDir = path.join(agentsDir, slug);

      // Step 1: Scaffold (before auth check — DYK #1)
      const files: string[] = [];
      let scaffolded = false;

      if (!fs.existsSync(path.join(agentDir, 'prompt.md'))) {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'prompt.md'), HELLO_WORLD_PROMPT);
        files.push('prompt.md');
        scaffolded = true;

        if (isTTY) {
          process.stderr.write(
            `\n  ${chalk.bold('Creating your first agent...')}\n\n`,
          );
          process.stderr.write(
            `  ${chalk.green('✓')} agents/${slug}/prompt.md\n`,
          );
        }
      } else if (isTTY) {
        process.stderr.write(
          `\n  ${chalk.dim('ℹ')} agents/${slug} already exists — running it...\n`,
        );
      }

      // Ensure preamble exists (DYK #2 — shared with init.ts)
      const preambleCreated = ensurePreamble(agentsDir);
      if (preambleCreated) {
        files.push('_shared/preamble.md');
        if (isTTY) {
          process.stderr.write(
            `  ${chalk.green('✓')} agents/_shared/preamble.md\n`,
          );
        }
      }

      if (isTTY && files.length > 0) {
        process.stderr.write('\n');
      }

      // Step 2: Check GH_TOKEN (after scaffold — DYK #1)
      if (!process.env.GH_TOKEN) {
        if (isTTY) {
          process.stderr.write(
            `  ${chalk.red('✗')} GH_TOKEN not set. To run your agent:\n\n`,
          );
          process.stderr.write(
            `    ${chalk.cyan('export GH_TOKEN=$(gh auth token)')}\n`,
          );
          process.stderr.write(`    ${chalk.cyan(`minih run ${slug}`)}\n\n`);
        }
        exitWithEnvelope(
          formatSuccess('quickstart', {
            slug,
            scaffolded,
            files,
            result: null,
          }),
        );
        return;
      }

      // Step 3: Run the agent
      const definition = resolveAgent(slug, agentsDir);
      if (!definition) {
        exitWithEnvelope(
          formatError(
            'quickstart',
            'E100',
            `Failed to resolve agent "${slug}" after scaffold.`,
          ),
        );
        return;
      }

      if (isTTY) {
        process.stderr.write(`  ${chalk.bold('Running hello-world...')}\n\n`);
      }

      const pretty = isTTY ? new PrettyDisplay() : null;
      const runtime = await createSdkRuntime('quickstart', () =>
        pretty?.cleanup(),
      );

      try {
        const onEvent = pretty
          ? (e: import('../../adapter/events.js').AgentEvent) =>
              pretty.handleEvent(e)
          : displayEvent;

        const result = await runAgent(
          runtime.adapter,
          definition,
          { slug, timeout: 120, cwd: process.cwd(), configDir: process.cwd() },
          onEvent,
          agentsDir,
        );

        pretty?.cleanup();

        if (isTTY) {
          displaySummary(result);

          // Step 4: Celebration + next steps (DYK #3, workshop Q5)
          const succeeded =
            result.metadata.result === 'completed' ||
            result.metadata.result === 'degraded';

          if (succeeded) {
            process.stderr.write(
              `\n  ${chalk.green('🎉')} ${chalk.bold('Your first agent ran successfully!')}\n\n`,
            );
            process.stderr.write(chalk.dim('  What just happened:\n'));
            process.stderr.write(
              chalk.dim(
                `    1. Created agents/${slug}/ with a simple prompt\n`,
              ),
            );
            process.stderr.write(
              chalk.dim('    2. Ran the agent against Copilot SDK\n'),
            );
            process.stderr.write(
              chalk.dim(
                '    3. Agent explored your project and wrote a report\n',
              ),
            );
            process.stderr.write(
              chalk.dim(`    4. Report saved to ${result.runDir}\n\n`),
            );
            process.stderr.write('  Next steps:\n');
            process.stderr.write(
              `    ${chalk.cyan('minih init my-agent')}        ${chalk.dim('# Create your own agent')}\n`,
            );
            process.stderr.write(
              `    ${chalk.cyan(`minih history ${slug}`)}  ${chalk.dim('# See past runs')}\n`,
            );
            process.stderr.write(
              `    ${chalk.cyan(`minih resume ${slug} "Tell me more"'`)}  ${chalk.dim('# Continue the conversation')}\n\n`,
            );
            process.stderr.write(
              `  ${chalk.dim('Tip: Run from a project with source code for a richer experience.')}\n`,
            );
            process.stderr.write(
              `  ${chalk.dim('Docs: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md')}\n\n`,
            );
          }
        }

        exitWithEnvelope(
          formatSuccess('quickstart', {
            slug,
            scaffolded,
            files,
            runId: result.metadata.runId,
            runDir: result.runDir,
            sessionId: result.metadata.sessionId,
            result: result.metadata.result,
            durationMs: result.metadata.durationMs,
            eventCount: result.metadata.eventCount,
            toolCallCount: result.metadata.toolCallCount,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithEnvelope(formatError('quickstart', 'E120', msg));
      } finally {
        await runtime.cleanup();
      }
    });
}
