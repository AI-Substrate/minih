import chalk from 'chalk';
import type { Command } from 'commander';
import {
  invalidArgs,
  requireNonEmptyOption,
  resolveAgentOrExit,
} from '../coordination.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';
import { appendOutsideMessage, buildOutsideMessage } from './outside-send.js';

const COMMAND = 'outside-retro';
const TARGETS = ['project', 'minih', 'coordination'] as const;
type MagicWandTarget = (typeof TARGETS)[number];

export function registerOutsideRetroCommand(program: Command): void {
  program
    .command(`${COMMAND} <slug>`)
    .description('Record outside-side coordination retrospective feedback')
    .option('--body <body>', 'Retro body')
    .option(
      '--target <target>',
      'project, minih, or coordination',
      'coordination',
    )
    .action((slug: string, opts: { body?: string; target?: string }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      resolveAgentOrExit(COMMAND, slug, agentsDir);
      const body = requireNonEmptyOption(COMMAND, opts.body, '--body');
      const target = parseTarget(opts.target ?? 'coordination');

      const message = buildOutsideMessage({
        type: 'retro',
        subject: 'outside session retro',
        body,
        meta: { magicWandTarget: target },
      });
      appendOutsideMessage(slug, agentsDir, message, COMMAND);

      if (process.stderr.isTTY) {
        process.stderr.write(
          `\n  ${chalk.green('✓')} Recorded outside retro for ${chalk.cyan(slug)} (${target})\n\n`,
        );
      }

      exitWithEnvelope(
        formatSuccess(COMMAND, {
          slug,
          messageId: message.id,
          target: 'inside',
          timestamp: message.ts,
          message,
        }),
      );
    });
}

function parseTarget(value: string): MagicWandTarget {
  if ((TARGETS as readonly string[]).includes(value)) {
    return value as MagicWandTarget;
  }
  exitWithEnvelope(
    invalidArgs(COMMAND, '--target must be project, minih, or coordination'),
  );
}
