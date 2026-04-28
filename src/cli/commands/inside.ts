/**
 * `minih inside <verb> <slug>` — agent-owned lane (R-only from CLI).
 *
 * Plan 010 — HF-002. Read-only access to the inside lane (replies, state, retros).
 * Inside writes are MCP-only (only the agent process can author them); CLI
 * write attempts are rejected with E143 INSIDE_READ_ONLY.
 *
 * Verbs:
 *   inside inbox list  <slug> [--wait <ms>] [--type <t>] [--unread] [--after <id>]
 *   inside state get   <slug> [--key <dot.path>]
 *   inside retro show  <slug>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { readStateLazy } from '../../runner/index.js';
import { resolveCoordinationRunOrExit } from '../coordination.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';
import {
  emitListResult,
  listLane,
  parseOptionalKey,
  parseWaitMs,
  pollLaneAndEmit,
  readStateKey,
  withStateErrors,
} from './outside.js';

export function registerInsideCommand(program: Command): void {
  const inside = program
    .command('inside')
    .description(
      'Agent-owned lane (R-only) — read what the agent sent / its state / its retro',
    );

  registerInsideInbox(inside, program);
  registerInsideState(inside, program);
  registerInsideRetro(inside, program);
}

function registerInsideInbox(parent: Command, root: Command): void {
  const inbox = parent
    .command('inbox')
    .description('Inside lane inbox (read-only)');

  inbox
    .command('list <slug>')
    .description('List inside-lane messages — what the agent sent back')
    .option('--type <type>', 'Return only messages with this exact type')
    .option('--unread', 'Exclude messages acknowledged by outside ack records')
    .option(
      '--after <msgId>',
      'Slice everything strictly after this message id',
    )
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .option(
      '--wait [ms]',
      'Long-poll up to <ms> ms (bare = 60_000, max 300_000)',
    )
    .action(handleInsideInboxList(root));

  // Explicit write rejection — guides operators to the agent's MCP tool surface.
  inbox
    .command('send <slug>')
    .description(
      '(NOT SUPPORTED) inside lane is read-only from CLI; use the agent MCP tool surface',
    )
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action((slug: string) => {
      exitWithEnvelope(
        formatError(
          'inside.inbox.send',
          ErrorCodes.INSIDE_READ_ONLY,
          `inside lane is read-only from CLI; '${slug}' inbox writes must come from the agent process via the MCP tool 'inbox_send'.`,
        ),
      );
    });
}

const INSIDE_INBOX_LIST_CMD = 'inside.inbox.list';

function handleInsideInboxList(root: Command) {
  return async (
    slug: string,
    opts: {
      type?: string;
      unread?: boolean;
      after?: string;
      run?: string;
      wait?: string | true;
    },
  ) => {
    const agentsDir = root.opts().agentsDir ?? 'agents';

    let waitMs: number | undefined;
    try {
      waitMs = parseWaitMs(opts.wait);
    } catch (error) {
      if (error instanceof Error) {
        exitWithEnvelope(
          formatError(
            INSIDE_INBOX_LIST_CMD,
            ErrorCodes.WAIT_OUT_OF_RANGE,
            error.message,
          ),
        );
      }
      throw error;
    }

    const target = resolveCoordinationRunOrExit(
      INSIDE_INBOX_LIST_CMD,
      slug,
      agentsDir,
      opts.run,
    );

    if (waitMs === undefined || waitMs === 0) {
      const messages = listLane(target, 'inside', {
        ...(opts.type && { type: opts.type }),
        unread: opts.unread === true,
        ...(opts.after && { after: opts.after }),
      });
      emitListResult(INSIDE_INBOX_LIST_CMD, slug, target, messages, opts);
      return;
    }

    await pollLaneAndEmit(
      INSIDE_INBOX_LIST_CMD,
      slug,
      target,
      'inside',
      opts,
      waitMs,
    );
  };
}

function registerInsideState(parent: Command, root: Command): void {
  const state = parent
    .command('state')
    .description('Inside-side coordination state (read-only)');

  state
    .command('get <slug>')
    .description('Read inside coordination state')
    .option('--key <dotPath>', 'Optional dot-path to read')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action((slug: string, opts: { key?: string; run?: string }) => {
      const cmd = 'inside.state.get';
      const agentsDir = root.opts().agentsDir ?? 'agents';
      const target = resolveCoordinationRunOrExit(
        cmd,
        slug,
        agentsDir,
        opts.run,
      );
      const key = parseOptionalKey(cmd, opts.key);

      withStateErrors(cmd, () => {
        const state = readStateLazy(target.location, 'inside');
        const payload =
          key !== undefined
            ? { side: 'inside', key, value: readStateKey(state, key) ?? null }
            : { side: 'inside', state };
        exitWithEnvelope(
          formatSuccess(cmd, { slug, runId: target.runId, ...payload }),
        );
      });
    });

  // Explicit write rejections — inside writes are MCP-only.
  for (const verb of ['set', 'transition'] as const) {
    state
      .command(`${verb} <slug>`)
      .description(
        `(NOT SUPPORTED) inside lane is read-only from CLI; use the agent MCP tool 'state_${verb}'`,
      )
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action((slug: string) => {
        exitWithEnvelope(
          formatError(
            `inside.state.${verb}`,
            ErrorCodes.INSIDE_READ_ONLY,
            `inside lane is read-only from CLI; '${slug}' state writes must come from the agent process via the MCP tool 'state_${verb}'.`,
          ),
        );
      });
  }
}

function registerInsideRetro(parent: Command, root: Command): void {
  const retro = parent
    .command('retro')
    .description('Inside-side retrospective (read-only)');

  retro
    .command('show <slug>')
    .description("Read the inside retro from the agent's farewell envelope")
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action((slug: string, opts: { run?: string }) => {
      const cmd = 'inside.retro.show';
      const agentsDir = root.opts().agentsDir ?? 'agents';
      const target = resolveCoordinationRunOrExit(
        cmd,
        slug,
        agentsDir,
        opts.run,
      );

      // Standard output envelope path: agents/<slug>/runs/<runId>/output/report.json
      const outputPath = path.join(target.runDir, 'output', 'report.json');
      if (!fs.existsSync(outputPath)) {
        exitWithEnvelope(
          formatError(
            cmd,
            ErrorCodes.AGENT_VALIDATION_FAILED,
            `No farewell envelope found at ${outputPath}. The run may not have produced an output report yet.`,
          ),
        );
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithEnvelope(
          formatError(
            cmd,
            ErrorCodes.AGENT_VALIDATION_FAILED,
            `Failed to parse farewell envelope at ${outputPath}: ${message}`,
          ),
        );
      }

      const retro =
        typeof envelope === 'object' && envelope !== null
          ? (envelope as { retrospective?: unknown }).retrospective
          : undefined;

      if (process.stderr.isTTY && retro !== undefined) {
        process.stderr.write(
          `\n  ${chalk.bold('Inside retro:')} ${chalk.cyan(slug)}\n\n`,
        );
        process.stderr.write(`${JSON.stringify(retro, null, 2)}\n\n`);
      }

      exitWithEnvelope(
        formatSuccess(cmd, {
          slug,
          runId: target.runId,
          retro: retro ?? null,
          present: retro !== undefined,
        }),
      );
    });
}
