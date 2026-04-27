import chalk from 'chalk';
import type { Command } from 'commander';
import type { InboxMessage } from '../../runner/index.js';
import type { CoordinationRunTarget } from '../coordination.js';
import {
  readInboxLaneOrExit,
  resolveCoordinationRunOrExit,
} from '../coordination.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';

const COMMAND = 'outside-inbox-list';

export function listInsideReplies(
  target: CoordinationRunTarget,
  filters: { type?: string; unread?: boolean },
): InboxMessage[] {
  const insideMessages = readInboxLaneOrExit(
    COMMAND,
    target.location,
    'inside',
  );
  const acknowledged = filters.unread
    ? new Set(
        readInboxLaneOrExit(COMMAND, target.location, 'outside')
          .filter((message) => message.type === 'ack' && message.ackOf)
          .map((message) => message.ackOf as string),
      )
    : new Set<string>();

  return insideMessages.filter((message) => {
    if (filters.type !== undefined && message.type !== filters.type) {
      return false;
    }
    if (filters.unread && acknowledged.has(message.id)) return false;
    return true;
  });
}

export function registerOutsideInboxListCommand(program: Command): void {
  program
    .command(`${COMMAND} <slug>`)
    .description('List inside-lane coordination replies from an agent')
    .option('--type <type>', 'Return only messages with this exact type')
    .option('--unread', 'Exclude messages acknowledged by outside ack records')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action(
      (
        slug: string,
        opts: { type?: string; unread?: boolean; run?: string },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';
        const target = resolveCoordinationRunOrExit(
          COMMAND,
          slug,
          agentsDir,
          opts.run,
        );

        const messages = listInsideReplies(target, {
          ...(opts.type && { type: opts.type }),
          unread: opts.unread === true,
        });

        if (process.stderr.isTTY) {
          process.stderr.write(
            `\n  ${chalk.bold('Inside replies:')} ${chalk.cyan(slug)} (${messages.length})\n\n`,
          );
        }

        exitWithEnvelope(
          formatSuccess(COMMAND, {
            slug,
            runId: target.runId,
            messages,
            count: messages.length,
            filters: {
              type: opts.type ?? null,
              unread: opts.unread === true,
            },
          }),
        );
      },
    );
}
