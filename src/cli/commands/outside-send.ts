import chalk from 'chalk';
import type { Command } from 'commander';
import type { InboxMessage } from '../../runner/index.js';
import { ulid } from '../../runner/index.js';
import {
  appendInboxMessage,
  invalidArgs,
  requireNonEmptyOption,
  requireStringOption,
  resolveAgentOrExit,
} from '../coordination.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';

const COMMAND = 'outside-send';

export interface OutsideMessageInput {
  type: string;
  subject: string;
  body: string;
  ackOf?: string;
  meta?: Record<string, unknown>;
}

export function buildOutsideMessage(input: OutsideMessageInput): InboxMessage {
  const message: InboxMessage = {
    id: ulid(),
    sender: 'outside',
    type: input.type,
    subject: input.subject,
    body: input.body,
    ts: new Date().toISOString(),
  };
  if (input.ackOf !== undefined) message.ackOf = input.ackOf;
  if (input.meta !== undefined) message.meta = input.meta;
  return message;
}

export function appendOutsideMessage(
  slug: string,
  agentsDir: string,
  message: InboxMessage,
  commandName = COMMAND,
): void {
  appendInboxMessage(commandName, slug, agentsDir, 'outside', message);
}

export function registerOutsideSendCommand(program: Command): void {
  program
    .command(`${COMMAND} <slug>`)
    .description('Send an outside-lane coordination message to an agent')
    .option('--type <type>', 'Message type, e.g. note, ack, retro')
    .option('--subject <subject>', 'Short message subject')
    .option('--body <body>', 'Message body')
    .option('--ack-of <msgId>', 'Message id this ack acknowledges')
    .action(
      (
        slug: string,
        opts: {
          type?: string;
          subject?: string;
          body?: string;
          ackOf?: string;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';
        resolveAgentOrExit(COMMAND, slug, agentsDir);

        const type = requireNonEmptyOption(COMMAND, opts.type, '--type');
        const subject = requireNonEmptyOption(
          COMMAND,
          opts.subject,
          '--subject',
        );
        const body = requireStringOption(COMMAND, opts.body, '--body');
        if (type === 'ack' && !opts.ackOf) {
          exitWithEnvelope(
            invalidArgs(COMMAND, '--ack-of is required when --type is ack'),
          );
        }
        if (type !== 'ack' && opts.ackOf) {
          exitWithEnvelope(
            invalidArgs(COMMAND, '--ack-of is only supported for --type ack'),
          );
        }

        const message = buildOutsideMessage({
          type,
          subject,
          body,
          ...(opts.ackOf && { ackOf: opts.ackOf }),
        });
        appendOutsideMessage(slug, agentsDir, message);

        if (process.stderr.isTTY) {
          process.stderr.write(
            `\n  ${chalk.green('✓')} Sent ${chalk.cyan(type)} message to ${chalk.cyan(slug)}\n\n`,
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
      },
    );
}
