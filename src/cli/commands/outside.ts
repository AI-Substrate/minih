/**
 * `minih outside <verb> <slug>` — operator-owned lane (R/W).
 *
 * Plan 010 — HF-002 hard rename. Replaces the flat `outside-send`,
 * `outside-inbox-list` (the version that wrote outside lane), `outside-context`,
 * `outside-retro` commands AND `state set`/`state transition` (now under
 * `outside state`).
 *
 * Verbs:
 *   outside inbox  send  <slug> --type --subject --body [--ack-of <id>]
 *   outside inbox  list  <slug> [--wait <ms>] [--type <t>] [--unread] [--after <id>]
 *   outside state  get   <slug> [--key <dot.path>]
 *   outside state  set   <slug> --status --data-json [--key --value --value-json]
 *   outside state  transition <slug> --to <status> [--reason]
 *   outside context      <slug>
 *   outside retro  add   <slug> --body [--target]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  type AgentDefinition,
  appendHistory,
  type CoordinationRunLocation,
  derivePeerActivity,
  HistoryLineTooLargeError,
  type InboxMessage,
  InboxPollError,
  type OutsideState,
  type PeerActivity,
  pollInboxLane,
  readStateLazy,
  StateCorruptError,
  ulid,
  writeState,
} from '../../runner/index.js';
import {
  appendInboxMessage,
  type CoordinationRunTarget,
  invalidArgs,
  readInboxLaneOrExit,
  requireNonEmptyOption,
  requireStringOption,
  resolveAgentOrExit,
  resolveCoordinationRunOrExit,
  validateJsonSchema,
} from '../coordination.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';
import { buildOutsideContext } from './outside-context-helper.js';

const DEFAULT_OUTSIDE_STATE_SCHEMA = fileURLToPath(
  new URL('../../schemas/outside-state.json', import.meta.url),
);

const MAX_OUTSIDE_WAIT_MS = 300_000;
const BARE_WAIT_DEFAULT_MS = 60_000;
const MIN_NONZERO_WAIT_MS = 100;
const STATUS_POLL_INTERVAL_MS = 250;

const RETRO_TARGETS = ['project', 'minih', 'coordination'] as const;
type RetroTarget = (typeof RETRO_TARGETS)[number];

// ─── peer activity helpers (plan 012) ─────────────────────────────────

/**
 * Derive peer activity, swallowing errors. Returns null if anything goes wrong.
 * Keeps peer purely additive — never blocks the underlying command.
 */
async function derivePeerOrNull(
  runDir: string,
  messageType: string | null,
): Promise<PeerActivity | null> {
  try {
    return await derivePeerActivity({ runDir, messageType });
  } catch {
    return null;
  }
}

/**
 * Render the peer verdict on stderr in TTY mode.
 * Silent in piped mode (preserves clean stdout).
 */
function renderPeerVerdict(peer: PeerActivity): void {
  if (!process.stderr.isTTY) return;
  if (peer.verdict === 'n/a' || peer.verdict === 'unknown') return;
  const colour =
    peer.verdict === 'deaf' || peer.verdict === 'dead'
      ? chalk.red
      : peer.verdict === 'silent'
        ? chalk.yellow
        : chalk.green;
  const icon =
    peer.verdict === 'listening' || peer.verdict === 'between-polls'
      ? '✓'
      : '⚠';
  process.stderr.write(
    `  ${colour(icon)} peer: ${colour(peer.verdict)} — ${peer.reason}\n`,
  );
}

export function registerOutsideCommand(program: Command): void {
  const outside = program
    .command('outside')
    .description(
      'Operator-owned lane (R/W) — write to and read from the outside lane',
    );

  registerOutsideInbox(outside, program);
  registerOutsideState(outside, program);
  registerOutsideContext(outside, program);
  registerOutsideRetro(outside, program);
}

// ─── outside inbox ────────────────────────────────────────────────────

function registerOutsideInbox(parent: Command, root: Command): void {
  const inbox = parent
    .command('inbox')
    .description(
      'Outside lane inbox: send messages to the agent, list what you sent',
    );

  inbox
    .command('send <slug>')
    .description('Send an outside-lane coordination message to an agent')
    .option('--type <type>', 'Message type, e.g. note, ack, retro')
    .option('--subject <subject>', 'Short message subject')
    .option('--body <body>', 'Message body')
    .option('--ack-of <msgId>', 'Message id this ack acknowledges')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .option(
      '--strict-peer',
      "Refuse to send when peer.verdict is 'deaf' (exit E150)",
    )
    .action(handleOutsideInboxSend(root));

  inbox
    .command('list <slug>')
    .description('List outside-lane messages — what you have sent to the agent')
    .option('--type <type>', 'Return only messages with this exact type')
    .option('--unread', 'Exclude messages acknowledged by inside ack records')
    .option(
      '--after <msgId>',
      'Slice everything strictly after this message id',
    )
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .option(
      '--wait [ms]',
      'Long-poll up to <ms> ms (bare = 60_000, max 300_000)',
    )
    .action(handleOutsideInboxList(root));
}

const OUTSIDE_INBOX_SEND_CMD = 'outside.inbox.send';
const OUTSIDE_INBOX_LIST_CMD = 'outside.inbox.list';

function handleOutsideInboxSend(root: Command) {
  return async (
    slug: string,
    opts: {
      type?: string;
      subject?: string;
      body?: string;
      ackOf?: string;
      run?: string;
      strictPeer?: boolean;
    },
  ) => {
    const agentsDir = root.opts().agentsDir ?? 'agents';
    const target = resolveCoordinationRunOrExit(
      OUTSIDE_INBOX_SEND_CMD,
      slug,
      agentsDir,
      opts.run,
    );

    const type = requireNonEmptyOption(
      OUTSIDE_INBOX_SEND_CMD,
      opts.type,
      '--type',
    );
    const subject = requireNonEmptyOption(
      OUTSIDE_INBOX_SEND_CMD,
      opts.subject,
      '--subject',
    );
    const body = requireStringOption(
      OUTSIDE_INBOX_SEND_CMD,
      opts.body,
      '--body',
    );
    if (type === 'ack' && !opts.ackOf) {
      exitWithEnvelope(
        invalidArgs(
          OUTSIDE_INBOX_SEND_CMD,
          '--ack-of is required when --type is ack',
        ),
      );
    }
    // --ack-of is now allowed for any --type to form reply chains (plan 013).
    // The inverse check (ack requires ack-of) is preserved above.

    const message = buildOutsideMessage({
      type,
      subject,
      body,
      ...(opts.ackOf && { ackOf: opts.ackOf }),
    });

    // --strict-peer: derive peer BEFORE the append so we can refuse delivery
    // outright when the agent is deaf. The non-strict path defers derivation
    // until after the append (so the snapshot reflects the moment the
    // message lands).
    if (opts.strictPeer) {
      const preCheckPeer = await derivePeerOrNull(target.runDir, type);
      if (preCheckPeer && preCheckPeer.verdict === 'deaf') {
        exitWithEnvelope(
          formatError(
            OUTSIDE_INBOX_SEND_CMD,
            ErrorCodes.DEAF_PEER,
            `Refusing to send: peer.verdict is 'deaf' (${preCheckPeer.reason}). Use a different --type or omit --strict-peer.`,
            { slug, runId: target.runId, peer: preCheckPeer },
          ),
        );
      }
    }

    appendInboxMessage(
      OUTSIDE_INBOX_SEND_CMD,
      target.location,
      'outside',
      message,
    );

    // Derive peer activity AFTER append so the snapshot reflects observed state
    // at the moment the message lands. Tolerates any errors silently — peer is
    // additive, never blocks the send.
    const peer = await derivePeerOrNull(target.runDir, type);

    if (process.stderr.isTTY) {
      process.stderr.write(
        `\n  ${chalk.green('✓')} Sent ${chalk.cyan(type)} message to ${chalk.cyan(slug)}\n`,
      );
      if (peer) renderPeerVerdict(peer);
      process.stderr.write('\n');
    }

    exitWithEnvelope(
      formatSuccess(OUTSIDE_INBOX_SEND_CMD, {
        slug,
        runId: target.runId,
        messageId: message.id,
        target: 'inside',
        timestamp: message.ts,
        message,
        ...(peer && { peer }),
      }),
    );
  };
}

function handleOutsideInboxList(root: Command) {
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
            OUTSIDE_INBOX_LIST_CMD,
            ErrorCodes.WAIT_OUT_OF_RANGE,
            error.message,
          ),
        );
      }
      throw error;
    }

    const target = resolveCoordinationRunOrExit(
      OUTSIDE_INBOX_LIST_CMD,
      slug,
      agentsDir,
      opts.run,
    );

    if (waitMs === undefined || waitMs === 0) {
      const messages = listLane(target, 'outside', {
        ...(opts.type && { type: opts.type }),
        unread: opts.unread === true,
        ...(opts.after && { after: opts.after }),
      });
      emitListResult(OUTSIDE_INBOX_LIST_CMD, slug, target, messages, opts);
      return;
    }

    await pollLaneAndEmit(
      OUTSIDE_INBOX_LIST_CMD,
      slug,
      target,
      'outside',
      opts,
      waitMs,
      true, // derivePeer — workshop §"Where it's invoked": list --wait wants peer
    );
  };
}

// ─── outside state ────────────────────────────────────────────────────

function registerOutsideState(parent: Command, root: Command): void {
  const state = parent
    .command('state')
    .description('Outside-owned coordination state (R/W)');

  state
    .command('get <slug>')
    .description('Read outside coordination state')
    .option('--key <dotPath>', 'Optional dot-path to read')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action((slug: string, opts: { key?: string; run?: string }) => {
      const cmd = 'outside.state.get';
      const agentsDir = root.opts().agentsDir ?? 'agents';
      const target = resolveCoordinationRunOrExit(
        cmd,
        slug,
        agentsDir,
        opts.run,
      );
      const key = parseOptionalKey(cmd, opts.key);

      withStateErrors(cmd, () => {
        const state = readStateLazy(target.location, 'outside');
        const payload =
          key !== undefined
            ? { side: 'outside', key, value: readStateKey(state, key) }
            : { side: 'outside', state };
        exitWithEnvelope(
          formatSuccess(cmd, { slug, runId: target.runId, ...payload }),
        );
      });
    });

  state
    .command('set <slug>')
    .description('Update outside-owned coordination state')
    .option('--status <status>', 'New outside status')
    .option('--data-json <json>', 'Replacement outside data object')
    .option('--key <dotPath>', 'State key to set: status, data, or data.<path>')
    .option('--value <value>', 'String value for --key')
    .option('--value-json <json>', 'JSON value for --key')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action(async (slug: string, opts: StateSetOptions) => {
      const cmd = 'outside.state.set';
      const agentsDir = root.opts().agentsDir ?? 'agents';
      const target = resolveCoordinationRunOrExit(
        cmd,
        slug,
        agentsDir,
        opts.run,
      );

      withStateErrors(cmd, () => {
        const current = readStateLazy(
          target.location,
          'outside',
        ) as OutsideState;
        const next = buildSetState(cmd, current, opts);
        validateOutsideStateOrExit(cmd, target.definition, next);
        writeOutsideStateAndHistory(target.location, current, next, null);
      });

      const peer = await derivePeerOrNull(target.runDir, null);

      if (process.stderr.isTTY) {
        const next = readStateLazy(target.location, 'outside') as OutsideState;
        process.stderr.write(
          `\n  ${chalk.green('✓')} outside state for ${chalk.cyan(slug)} is ${chalk.cyan(next.status)}\n`,
        );
        if (peer) renderPeerVerdict(peer);
        process.stderr.write('\n');
      }
      const finalState = readStateLazy(
        target.location,
        'outside',
      ) as OutsideState;
      exitWithEnvelope(
        formatSuccess(cmd, {
          slug,
          runId: target.runId,
          state: finalState,
          ...(peer && { peer }),
        }),
      );
    });

  state
    .command('transition <slug>')
    .description('Transition outside-owned status and append history')
    .option('--to <status>', 'Target outside status')
    .option('--reason <text>', 'Optional transition reason')
    .option('--data-json <json>', 'Replacement outside data object')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action(
      async (
        slug: string,
        opts: { to?: string; reason?: string; dataJson?: string; run?: string },
      ) => {
        const cmd = 'outside.state.transition';
        const agentsDir = root.opts().agentsDir ?? 'agents';
        const target = resolveCoordinationRunOrExit(
          cmd,
          slug,
          agentsDir,
          opts.run,
        );
        const to = requireNonEmptyOption(cmd, opts.to, '--to');

        let transitioned = false;
        let from = '';
        let nextState: OutsideState | null = null;

        withStateErrors(cmd, () => {
          const current = readStateLazy(
            target.location,
            'outside',
          ) as OutsideState;
          const data =
            opts.dataJson === undefined
              ? current.data
              : parseJsonObject(cmd, opts.dataJson, '--data-json');
          const next = buildOutsideState(to, data);
          validateOutsideStateOrExit(cmd, target.definition, next);

          from = current.status;
          if (current.status === next.status && deepEqual(current.data, data)) {
            nextState = current;
            return; // transitioned stays false
          }

          writeOutsideStateAndHistory(
            target.location,
            current,
            next,
            opts.reason ?? null,
          );
          nextState = next;
          transitioned = true;
        });

        const peer = await derivePeerOrNull(target.runDir, null);

        if (process.stderr.isTTY) {
          if (transitioned) {
            process.stderr.write(
              `\n  ${chalk.green('✓')} transitioned ${chalk.cyan(slug)} outside state ${chalk.dim(from)} → ${chalk.cyan(to)}\n`,
            );
          }
          if (peer) renderPeerVerdict(peer);
          if (transitioned) process.stderr.write('\n');
        }
        exitWithEnvelope(
          formatSuccess(cmd, {
            slug,
            runId: target.runId,
            state: nextState,
            transitioned,
            from,
            to,
            ...(peer && { peer }),
          }),
        );
      },
    );
}

// ─── outside context ──────────────────────────────────────────────────

function registerOutsideContext(parent: Command, root: Command): void {
  parent
    .command('context [slug]')
    .description('Print the outside coordination context markdown')
    .action((slug: string | undefined) => {
      const cmd = 'outside.context';
      const agentsDir = root.opts().agentsDir ?? 'agents';
      const definition = slug ? resolveAgentOrExit(cmd, slug, agentsDir) : null;
      const built = buildOutsideContext(definition);

      process.stderr.write(`${built.context}\n`);

      exitWithEnvelope(formatSuccess(cmd, { slug: slug ?? null, ...built }));
    });
}

// ─── outside retro ────────────────────────────────────────────────────

function registerOutsideRetro(parent: Command, root: Command): void {
  const retro = parent
    .command('retro')
    .description('Outside-side coordination retrospective feedback');

  retro
    .command('add <slug>')
    .description('Record outside-side coordination retrospective feedback')
    .option('--body <body>', 'Retro body')
    .option(
      '--target <target>',
      'project, minih, or coordination',
      'coordination',
    )
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action(
      async (
        slug: string,
        opts: { body?: string; target?: string; run?: string },
      ) => {
        const cmd = 'outside.retro.add';
        const agentsDir = root.opts().agentsDir ?? 'agents';
        const runTarget = resolveCoordinationRunOrExit(
          cmd,
          slug,
          agentsDir,
          opts.run,
        );
        const body = requireNonEmptyOption(cmd, opts.body, '--body');
        const target = parseRetroTarget(cmd, opts.target ?? 'coordination');

        const message = buildOutsideMessage({
          type: 'retro',
          subject: 'outside session retro',
          body,
          meta: { magicWandTarget: target },
        });
        appendInboxMessage(cmd, runTarget.location, 'outside', message);

        const peer = await derivePeerOrNull(runTarget.runDir, 'retro');

        if (process.stderr.isTTY) {
          process.stderr.write(
            `\n  ${chalk.green('✓')} Recorded outside retro for ${chalk.cyan(slug)} (${target})\n`,
          );
          if (peer) renderPeerVerdict(peer);
          process.stderr.write('\n');
        }
        exitWithEnvelope(
          formatSuccess(cmd, {
            slug,
            runId: runTarget.runId,
            messageId: message.id,
            target: 'inside',
            timestamp: message.ts,
            message,
            ...(peer && { peer }),
          }),
        );
      },
    );
}

function parseRetroTarget(cmd: string, value: string): RetroTarget {
  if ((RETRO_TARGETS as readonly string[]).includes(value)) {
    return value as RetroTarget;
  }
  exitWithEnvelope(
    invalidArgs(cmd, '--target must be project, minih, or coordination'),
  );
}

// ─── shared helpers (also consumed by inside.ts) ──────────────────────

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

export function parseWaitMs(
  raw: string | true | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (raw === true) return BARE_WAIT_DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`--wait must be a non-negative integer; got '${raw}'`);
  }
  if (n === 0) return 0;
  if (n < MIN_NONZERO_WAIT_MS || n > MAX_OUTSIDE_WAIT_MS) {
    throw new Error(
      `--wait must be 0 or an integer between ${MIN_NONZERO_WAIT_MS} and ${MAX_OUTSIDE_WAIT_MS}; got ${n}`,
    );
  }
  return n;
}

export function listLane(
  target: CoordinationRunTarget,
  readLane: 'inside' | 'outside',
  filters: { type?: string; unread?: boolean; after?: string },
): InboxMessage[] {
  const cmd = `${readLane}.inbox.list`;
  const messages = readInboxLaneOrExit(cmd, target.location, readLane);
  const peerLane: 'inside' | 'outside' =
    readLane === 'outside' ? 'inside' : 'outside';
  const acknowledged = filters.unread
    ? new Set(
        readInboxLaneOrExit(cmd, target.location, peerLane)
          .filter((m) => m.type === 'ack' && m.ackOf)
          .map((m) => m.ackOf as string),
      )
    : new Set<string>();

  let visible = messages.filter((m) => {
    if (filters.type !== undefined && m.type !== filters.type) return false;
    if (filters.unread && acknowledged.has(m.id)) return false;
    return true;
  });

  if (filters.after !== undefined) {
    const idx = visible.findIndex((m) => m.id === filters.after);
    visible = idx === -1 ? [] : visible.slice(idx + 1);
  }

  return visible;
}

export function emitListResult(
  cmd: string,
  slug: string,
  target: CoordinationRunTarget,
  messages: InboxMessage[],
  opts: { type?: string; unread?: boolean; after?: string },
  wait?: {
    requestedMs: number;
    elapsedMs: number;
    timedOut: boolean;
    matched: boolean;
  },
  peer?: PeerActivity | null,
): void {
  if (process.stderr.isTTY) {
    const tag = wait
      ? wait.matched
        ? chalk.green('matched')
        : chalk.yellow('timed out')
      : '';
    process.stderr.write(
      `\n  ${chalk.bold('Messages:')} ${chalk.cyan(slug)} (${messages.length}${tag ? `, ${tag}` : ''})\n`,
    );
    if (peer) renderPeerVerdict(peer);
    process.stderr.write('\n');
  }

  exitWithEnvelope(
    formatSuccess(cmd, {
      slug,
      runId: target.runId,
      messages,
      count: messages.length,
      filters: {
        type: opts.type ?? null,
        unread: opts.unread === true,
        after: opts.after ?? null,
      },
      ...(wait && { wait }),
      ...(peer && { peer }),
    }),
  );
}

export async function pollLaneAndEmit(
  cmd: string,
  slug: string,
  target: CoordinationRunTarget,
  readLane: 'inside' | 'outside',
  opts: { type?: string; unread?: boolean; after?: string },
  waitMs: number,
  derivePeer = false,
): Promise<void> {
  const livenessAbort = new AbortController();
  let pollResult: Awaited<ReturnType<typeof pollInboxLane>>;
  try {
    const pollPromise = pollInboxLane(target.location, readLane, {
      ...(opts.type && { type: opts.type }),
      unread: opts.unread === true,
      ...(opts.after && { after: opts.after }),
      waitMs,
      maxWaitMs: MAX_OUTSIDE_WAIT_MS,
    });
    const livenessPromise = watchAgentLiveness(
      target.runDir,
      livenessAbort.signal,
    );
    pollResult = (await Promise.race([
      pollPromise,
      livenessPromise,
    ])) as Awaited<ReturnType<typeof pollInboxLane>>;
  } catch (error) {
    livenessAbort.abort();
    if (error instanceof AgentGoneError) {
      exitWithEnvelope(formatError(cmd, ErrorCodes.AGENT_GONE, error.message));
    }
    if (error instanceof InboxPollError) {
      exitWithEnvelope(
        formatError(
          cmd,
          error.code === 'INBOX_POLL_INVALID_ARGUMENT'
            ? ErrorCodes.WAIT_OUT_OF_RANGE
            : error.code === 'INBOX_POLL_CORRUPT'
              ? ErrorCodes.INBOX_CORRUPT
              : ErrorCodes.UNKNOWN,
          error.message,
        ),
      );
    }
    throw error;
  }
  livenessAbort.abort();

  // Derive peer at envelope-construction time (post-poll), not at call entry,
  // so the snapshot reflects what the agent is doing right now.
  const peer = derivePeer ? await derivePeerOrNull(target.runDir, null) : null;

  emitListResult(
    cmd,
    slug,
    target,
    pollResult.messages,
    opts,
    pollResult.wait,
    peer,
  );
}

class AgentGoneError extends Error {}

async function watchAgentLiveness(
  runDir: string,
  signal: AbortSignal,
): Promise<void> {
  const runJsonPath = path.join(runDir, 'run.json');
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) {
        resolve();
        return;
      }
      try {
        const raw = fs.readFileSync(runJsonPath, 'utf8');
        const manifest = JSON.parse(raw) as { status?: string };
        if (manifest.status && manifest.status !== 'active') {
          reject(
            new AgentGoneError(
              `agent run is no longer active (status: '${manifest.status}')`,
            ),
          );
          return;
        }
      } catch {
        // run.json missing or unreadable; keep polling
      }
      setTimeout(tick, STATUS_POLL_INTERVAL_MS);
    };
    tick();
  });
}

// ─── outside-state helpers (extracted from old state.ts) ──────────────

interface StateSetOptions {
  status?: string;
  dataJson?: string;
  key?: string;
  value?: string;
  valueJson?: string;
  run?: string;
}

function buildSetState(
  cmd: string,
  current: OutsideState,
  opts: StateSetOptions,
): OutsideState {
  const hasKey = opts.key !== undefined;
  const hasStatus = opts.status !== undefined;
  const hasDataJson = opts.dataJson !== undefined;

  if (hasKey) {
    if (hasStatus || hasDataJson) {
      exitWithEnvelope(
        invalidArgs(
          cmd,
          '--key cannot be combined with --status or --data-json',
        ),
      );
    }
    const hasValue = opts.value !== undefined;
    const hasValueJson = opts.valueJson !== undefined;
    if (hasValue === hasValueJson) {
      exitWithEnvelope(
        invalidArgs(
          cmd,
          '--key requires exactly one of --value or --value-json',
        ),
      );
    }
    const value = hasValue
      ? (opts.value as string)
      : parseJsonValue(cmd, opts.valueJson as string, '--value-json');
    return setStateKey(cmd, current, opts.key as string, value);
  }

  if (!hasStatus && !hasDataJson) {
    exitWithEnvelope(
      invalidArgs(cmd, 'state set requires --status, --data-json, or --key'),
    );
  }
  if (opts.value !== undefined || opts.valueJson !== undefined) {
    exitWithEnvelope(
      invalidArgs(cmd, '--value and --value-json require --key'),
    );
  }

  return buildOutsideState(
    hasStatus
      ? requireNonEmptyOption(cmd, opts.status, '--status')
      : current.status,
    hasDataJson
      ? parseJsonObject(cmd, opts.dataJson as string, '--data-json')
      : current.data,
  );
}

export function buildOutsideState(
  status: string,
  data: Record<string, unknown>,
): OutsideState {
  return {
    status,
    data,
    updatedAt: new Date().toISOString(),
    updatedBy: 'outside',
  };
}

export function writeOutsideStateAndHistory(
  location: CoordinationRunLocation,
  current: OutsideState,
  next: OutsideState,
  reason: string | null,
): void {
  appendHistory(location, {
    ts: next.updatedAt,
    side: 'outside',
    from: current.status,
    to: next.status,
    reason,
  });
  writeState(location, 'outside', next);
}

function validateOutsideStateOrExit(
  cmd: string,
  definition: AgentDefinition,
  state: OutsideState,
): void {
  const schemaPath = outsideStateSchemaPath(definition);
  const errors = validateJsonSchema(schemaPath, state, 'OutsideState');
  if (errors.length === 0) return;
  exitWithEnvelope(
    formatError(
      cmd,
      ErrorCodes.INVALID_ARGS,
      'State does not match outside state schema.',
      {
        schemaPath,
        errors,
      },
    ),
  );
}

function outsideStateSchemaPath(definition: AgentDefinition): string {
  const localSchema = path.join(definition.dir, 'outside-state.schema.json');
  return fs.existsSync(localSchema)
    ? localSchema
    : DEFAULT_OUTSIDE_STATE_SCHEMA;
}

function setStateKey(
  cmd: string,
  current: OutsideState,
  key: string,
  value: unknown,
): OutsideState {
  const segments = parseKeySegments(cmd, key);
  const next = buildOutsideState(current.status, deepCloneRecord(current.data));

  if (segments[0] === 'status') {
    if (
      segments.length !== 1 ||
      typeof value !== 'string' ||
      value.trim() === ''
    ) {
      exitWithEnvelope(
        invalidArgs(cmd, '--key status requires a non-empty string value'),
      );
    }
    return { ...next, status: value };
  }

  if (segments[0] !== 'data') {
    exitWithEnvelope(
      invalidArgs(cmd, '--key supports only status, data, or data.<path>'),
    );
  }

  if (segments.length === 1) {
    if (!isRecord(value)) {
      exitWithEnvelope(
        invalidArgs(cmd, '--key data requires an object JSON value'),
      );
    }
    return { ...next, data: value };
  }

  setNestedData(next.data, segments.slice(1), value);
  return next;
}

function setNestedData(
  root: Record<string, unknown>,
  segments: string[],
  value: unknown,
): void {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!isRecord(existing)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] as string] = value;
}

export function parseOptionalKey(
  cmd: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  parseKeySegments(cmd, value);
  return value;
}

function parseKeySegments(cmd: string, key: string): string[] {
  if (key.trim() === '') {
    exitWithEnvelope(invalidArgs(cmd, '--key must be non-empty'));
  }
  const segments = key.split('.');
  if (segments.some((s) => s === '')) {
    exitWithEnvelope(
      invalidArgs(cmd, '--key must be a dot path without empty segments'),
    );
  }
  return segments;
}

function parseJsonObject(
  cmd: string,
  raw: string,
  flag: string,
): Record<string, unknown> {
  const value = parseJsonValue(cmd, raw, flag);
  if (!isRecord(value)) {
    exitWithEnvelope(invalidArgs(cmd, `${flag} must be a JSON object`));
  }
  return value;
}

function parseJsonValue(cmd: string, raw: string, flag: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    exitWithEnvelope(invalidArgs(cmd, `${flag} must be valid JSON`));
  }
}

export function readStateKey(state: unknown, key: string): unknown {
  const segments = key.split('.');
  let current: unknown = state;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepCloneRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function withStateErrors(cmd: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof StateCorruptError) {
      exitWithEnvelope(
        formatError(cmd, ErrorCodes.AGENT_VALIDATION_FAILED, error.message),
      );
    }
    if (error instanceof HistoryLineTooLargeError) {
      exitWithEnvelope(
        formatError(cmd, ErrorCodes.AGENT_VALIDATION_FAILED, error.message),
      );
    }
    throw error;
  }
}
