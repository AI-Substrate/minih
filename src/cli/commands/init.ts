/**
 * minih init <slug> — scaffold a new agent folder with templates.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { validateSlug } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

const PROMPT_TEMPLATE = (slug: string) => `---
description: "TODO: describe what this agent does"
tags: []
---

# ${slug}

## Objective

Describe what this agent should accomplish.

## Tasks

### 1. [First Task]

Describe the first step the agent should take.

## Output

Write your structured JSON report to $MINIH_OUTPUT_PATH.
After writing, validate with: minih check
`;

const INSTRUCTIONS_TEMPLATE = (slug: string) => `# ${slug}

You are a [describe role]. Your job is to [describe purpose].

## Rules

1. Be thorough and specific
2. Include evidence for your findings
`;

const OUTPUT_SCHEMA_TEMPLATE = () =>
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Agent Report',
      type: 'object',
      required: ['result', 'summary', 'retrospective'],
      additionalProperties: true,
      properties: {
        result: {
          type: 'object',
          description: 'Your agent-specific output goes here.',
        },
        summary: {
          type: 'string',
          minLength: 20,
          description: 'Single paragraph summarizing what happened.',
        },
        retrospective: {
          type: 'object',
          required: ['workedWell', 'confusing', 'magicWand'],
          additionalProperties: true,
          properties: {
            workedWell: { type: 'string', minLength: 10 },
            confusing: { type: 'string', minLength: 10 },
            magicWand: { type: 'string', minLength: 20 },
          },
        },
      },
    },
    null,
    2,
  );

const INPUT_SCHEMA_TEMPLATE = () =>
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Agent Input',
      type: 'object',
      required: [],
      properties: {},
    },
    null,
    2,
  );

const PREAMBLE_TEMPLATE = () => `# Agent Preamble

Your working directory is the run folder. The project root is: {{REPO_ROOT}}

Run \`cd {{REPO_ROOT}}\` before executing commands against the project.

## Feedback — The Self-Improving Loop

You are not just running a task. You are helping build a better system.
Every time you run, you have two responsibilities:

1. Complete your task well
2. Feed back honestly on the experience of doing it

Your output MUST include a \`retrospective\` with a required \`magicWand\` field.

**What makes good feedback:**

Bad: "Everything was fine."
Good: "The input params were validated before execution, which saved me from
discovering the wrong file_path halfway through a 5-minute run."

**The retrospective fields:**

- **workedWell**: What about the tools, workflow, or environment was smooth?
- **confusing**: What required trial-and-error? What information was hard to find?
- **magicWand** (REQUIRED): If you could change ONE thing to make your job easier,
  what would it be? Be concrete.
`;

/**
 * Ensure _shared/preamble.md exists in the agents directory.
 * @returns true if preamble was created, false if it already existed
 */
export function ensurePreamble(agentsDir: string): boolean {
  const preambleDir = path.join(agentsDir, '_shared');
  const preamblePath = path.join(preambleDir, 'preamble.md');
  if (fs.existsSync(preamblePath)) return false;
  fs.mkdirSync(preambleDir, { recursive: true });
  fs.writeFileSync(preamblePath, PREAMBLE_TEMPLATE());
  return true;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init <slug>')
    .description('Scaffold a new agent folder')
    .option('--with-input', 'Also create input-schema.json')
    .option('--no-output', 'Skip output-schema.json')
    .option('--no-instructions', 'Skip instructions.md')
    .action(
      (
        slug: string,
        opts: { withInput?: boolean; output?: boolean; instructions?: boolean },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';
        const resolvedDir = path.resolve(agentsDir);

        const slugError = validateSlug(slug);
        if (slugError) {
          exitWithEnvelope(
            formatError('init', ErrorCodes.INVALID_ARGS, slugError),
          );
          return;
        }

        const agentDir = path.join(resolvedDir, slug);
        if (fs.existsSync(agentDir)) {
          exitWithEnvelope(
            formatError(
              'init',
              ErrorCodes.INIT_ALREADY_EXISTS,
              `Agent "${slug}" already exists at ${agentDir}`,
            ),
          );
          return;
        }

        // Create agent directory + files
        fs.mkdirSync(agentDir, { recursive: true });

        const files: string[] = [];

        // prompt.md (always)
        fs.writeFileSync(
          path.join(agentDir, 'prompt.md'),
          PROMPT_TEMPLATE(slug),
        );
        files.push('prompt.md');

        // output-schema.json (default: yes)
        if (opts.output !== false) {
          fs.writeFileSync(
            path.join(agentDir, 'output-schema.json'),
            OUTPUT_SCHEMA_TEMPLATE(),
          );
          files.push('output-schema.json');
        }

        // instructions.md (default: yes)
        if (opts.instructions !== false) {
          fs.writeFileSync(
            path.join(agentDir, 'instructions.md'),
            INSTRUCTIONS_TEMPLATE(slug),
          );
          files.push('instructions.md');
        }

        // input-schema.json (opt-in)
        if (opts.withInput) {
          fs.writeFileSync(
            path.join(agentDir, 'input-schema.json'),
            INPUT_SCHEMA_TEMPLATE(),
          );
          files.push('input-schema.json');
        }

        // Create preamble on first init (if doesn't exist)
        const preambleCreated = ensurePreamble(resolvedDir);

        if (process.stderr.isTTY) {
          process.stderr.write(
            `\n  ${chalk.bold('Created agent:')} ${chalk.cyan(slug)}\n`,
          );
          process.stderr.write(
            `  ${chalk.bold('Directory:')} ${chalk.dim(agentDir)}\n\n`,
          );
          for (const f of files) {
            process.stderr.write(`  ${chalk.green('✓')} ${f}\n`);
          }
          if (preambleCreated) {
            process.stderr.write(
              `  ${chalk.green('✓')} _shared/preamble.md ${chalk.dim('(created)')}\n`,
            );
          }
          process.stderr.write('\n');
        }

        exitWithEnvelope(
          formatSuccess('init', {
            slug,
            dir: agentDir,
            files,
            preambleCreated,
          }),
        );
      },
    );
}
