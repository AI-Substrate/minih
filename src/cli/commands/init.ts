/**
 * minih init <slug> — scaffold a new agent folder with templates.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';
import { validateSlug } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';
import { assertOutsideContext } from '../preaction-context.js';

const PROMPT_TEMPLATE = (slug: string, coordinated = false) => `---
description: "TODO: describe what this agent does"
tags: []
permissions: restricted
${coordinated ? 'coordination: enabled\n' : ''}---

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

const OUTSIDE_TEMPLATE = (slug: string) => `# ${slug} outside contract

Use this contract when coordinating with the inside minih agent.

## How to drive this agent

1. Send requests with \`minih outside inbox send ${slug} --subject "..." --body "..."\`.
2. Track outside progress with \`minih outside state set ${slug} --status in-progress\`.
3. Read inside replies with \`minih inside inbox list ${slug}\`.

## Expected completion signal

The inside agent should send a final inbox message and publish inside state before writing its report.
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

const INSIDE_STATE_SCHEMA_TEMPLATE = () =>
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Inside State',
      type: 'object',
      required: ['status', 'data', 'updatedAt', 'updatedBy'],
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          enum: ['idle', 'working', 'reviewing', 'complete', 'blocked'],
        },
        data: { type: 'object' },
        updatedAt: { type: 'string', format: 'date-time' },
        updatedBy: { const: 'inside' },
      },
    },
    null,
    2,
  );

const OUTSIDE_STATE_SCHEMA_TEMPLATE = () =>
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Outside State',
      type: 'object',
      required: ['status', 'data', 'updatedAt', 'updatedBy'],
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          enum: ['idle', 'in-progress', 'review-requested', 'done', 'blocked'],
        },
        data: { type: 'object' },
        updatedAt: { type: 'string', format: 'date-time' },
        updatedBy: { const: 'outside' },
      },
    },
    null,
    2,
  );

const DEFAULT_SHARED_PREAMBLE_PATH = fileURLToPath(
  new URL('../../templates/shared-preamble.md', import.meta.url),
);

const DEFAULT_RETROS_README_PATH = fileURLToPath(
  new URL('../../templates/retros-readme.md', import.meta.url),
);

function readDefaultSharedPreamble(): string {
  return fs.readFileSync(DEFAULT_SHARED_PREAMBLE_PATH, 'utf-8');
}

function readDefaultRetrosReadme(): string {
  return fs.readFileSync(DEFAULT_RETROS_README_PATH, 'utf-8');
}

/**
 * Ensure docs/retros/README.md exists in the project root.
 * Plan 011: scaffolds the retro-ledger directory with bundled convention guide.
 * Idempotent — does not overwrite an existing README.
 *
 * @returns true if the README was created, false if it already existed.
 */
export function ensureRetrosLedger(projectRoot: string): boolean {
  const retrosDir = path.join(projectRoot, 'docs', 'retros');
  const readmePath = path.join(retrosDir, 'README.md');
  if (fs.existsSync(readmePath)) return false;
  fs.mkdirSync(retrosDir, { recursive: true });
  fs.writeFileSync(readmePath, readDefaultRetrosReadme());
  return true;
}

/**
 * Ensure _shared/preamble.md exists in the agents directory.
 * @returns true if preamble was created, false if it already existed
 */
export function ensurePreamble(agentsDir: string): boolean {
  const preambleDir = path.join(agentsDir, '_shared');
  const preamblePath = path.join(preambleDir, 'preamble.md');
  if (fs.existsSync(preamblePath)) return false;
  fs.mkdirSync(preambleDir, { recursive: true });
  fs.writeFileSync(preamblePath, readDefaultSharedPreamble());
  return true;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init <slug>')
    .description('Scaffold a new agent folder')
    .hook('preAction', () => {
      assertOutsideContext({
        commandName: 'init',
        alternatives: [
          'Create or edit agent files from the outside project shell.',
          'Use `minih outside context <slug>` to inspect an existing coordination contract.',
        ],
      });
    })
    .option('--with-input', 'Also create input-schema.json')
    .option('--coordinated', 'Scaffold outside contract and state schemas')
    .option('--no-output', 'Skip output-schema.json')
    .option('--no-instructions', 'Skip instructions.md')
    .action(
      (
        slug: string,
        opts: {
          withInput?: boolean;
          coordinated?: boolean;
          output?: boolean;
          instructions?: boolean;
        },
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
          PROMPT_TEMPLATE(slug, opts.coordinated === true),
        );
        files.push('prompt.md');

        if (opts.coordinated === true) {
          fs.writeFileSync(
            path.join(agentDir, 'outside.md'),
            OUTSIDE_TEMPLATE(slug),
          );
          files.push('outside.md');
          fs.writeFileSync(
            path.join(agentDir, 'inside-state.schema.json'),
            INSIDE_STATE_SCHEMA_TEMPLATE(),
          );
          files.push('inside-state.schema.json');
          fs.writeFileSync(
            path.join(agentDir, 'outside-state.schema.json'),
            OUTSIDE_STATE_SCHEMA_TEMPLATE(),
          );
          files.push('outside-state.schema.json');
        }

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

        // Plan 011 — scaffold docs/retros/ ledger with bundled README.
        // resolvedDir is the agents dir (e.g. <project>/agents); the project
        // root is its parent. Idempotent on re-init.
        const projectRoot = path.dirname(resolvedDir);
        const retrosCreated = ensureRetrosLedger(projectRoot);

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
          if (retrosCreated) {
            process.stderr.write(
              `  ${chalk.green('✓')} docs/retros/README.md ${chalk.dim('(created)')}\n`,
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
            retrosCreated,
          }),
        );
      },
    );
}
