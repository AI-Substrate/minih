import * as fs from 'node:fs';
import {
  type FileWatcher,
  type WatchFactory,
  watchFileChanges,
} from './file-watcher.js';
import { type CoordinationRunLocation, inboxLanePath } from './folder.js';
import type { InboxMessage, Side } from './types.js';

/**
 * Runner-side polling primitive for inbox lanes.
 *
 * Plan 010 — HF-001. Extracted from `src/mcp/tools/inbox.ts`
 * `waitForMatchingMessages` so both the inside MCP server and the outside CLI
 * share one source of truth for filter chain order, settlement semantics, and
 * watch debouncing.
 *
 * Filter chain order (LOAD-BEARING — must not drift between consumers):
 *   1. `unread` — filter out read-lane messages whose id appears in any
 *      peer-lane `ack`-type message's `ackOf` field
 *   2. `type` — exact-match on `message.type`
 *   3. `waitForAny` — set-match on `message.type` (mutually exclusive with
 *      `type` at validation layer; here we just apply both if both are set)
 *   4. `after` — slice everything strictly after the given message id (if
 *      the id is not present in the filtered list, returns empty)
 *
 * Wait semantics:
 *   - `waitMs` undefined or 0: synchronous read, no `wait` field in result
 *   - `waitMs > 0` with immediate matches: returns now with `wait.matched=true`
 *   - `waitMs > 0` with no matches: long-poll using parent-dir `fs.watch`
 *     (re-read on every change event, debounced by `watchFileChanges`).
 *     Settles exactly once on first match OR timeout.
 *
 * Cap (`maxWaitMs`) is a required caller-passed ceiling. Inside MCP passes
 * `MAX_INBOX_WAIT_MS` (30s); outside CLI passes 300_000 (5min). The cap is
 * enforced at the primitive — caller doesn't have to validate.
 */

/**
 * Filter inputs shared by `pollInboxLane` and the exported `listUnackedVisible`
 * helper (consumed by `event-wait`). These are the fields the unread/ack filter
 * chain reads — deliberately no wait/cap fields, which only `pollInboxLane` needs.
 */
export interface ListFilterOptions {
  /** Filter to messages with this exact `type`. */
  readonly type?: string;
  /** Filter to messages whose `type` is in this set. */
  readonly waitForAny?: readonly string[];
  /** Exclude messages already acknowledged by the peer lane's `ack` records. */
  readonly unread?: boolean;
  /** Slice everything strictly after the given message id. */
  readonly after?: string;
  /** Maximum messages to return; defaults to 50, max 200. */
  readonly limit?: number;
}

export interface PollInboxOptions extends ListFilterOptions {
  /** Long-poll wait in ms. 0 or undefined = synchronous read. */
  readonly waitMs?: number;
  /**
   * Maximum allowed `waitMs`. REQUIRED — different consumers have different
   * ceilings (MCP=30s, CLI=300s). Validation throws `InboxPollError` if
   * `waitMs > maxWaitMs`.
   */
  readonly maxWaitMs: number;
  /** Optional injection point for tests; defaults to `fs.watch`. */
  readonly watchFactory?: WatchFactory;
}

export interface PollInboxResult {
  readonly messages: InboxMessage[];
  readonly nextAfter: string | null;
  readonly wait?: PollInboxWait;
}

export interface PollInboxWait {
  readonly requestedMs: number;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
  readonly matched: boolean;
}

export type InboxPollErrorCode =
  | 'INBOX_POLL_INVALID_ARGUMENT'
  | 'INBOX_POLL_CORRUPT'
  | 'INBOX_POLL_INTERNAL';

export class InboxPollError extends Error {
  constructor(
    public readonly code: InboxPollErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InboxPollError';
  }
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Read the `readLane` (inbox lane), apply filters, optionally long-poll for
 * new matches. See module doc for filter chain order and wait semantics.
 *
 * `readLane` selects which lane to read; the OTHER lane is treated as the
 * peer lane for `unread` ack-record computation:
 *   - `readLane='outside'` → reads outside lane, computes unread from inside acks
 *     (this is the inside MCP `inbox_list` semantics — agent reading peer messages)
 *   - `readLane='inside'` → reads inside lane (replies), computes unread from outside acks
 *     (this is the outside CLI `inside inbox list` semantics — operator reading replies)
 */
export async function pollInboxLane(
  location: CoordinationRunLocation,
  readLane: Side,
  options: PollInboxOptions,
): Promise<PollInboxResult> {
  const startedAt = Date.now();
  const limit = normalizeLimit(options.limit);
  const waitMs = normalizeWaitMs(options.waitMs, options.maxWaitMs);
  const peerLane: Side = readLane === 'outside' ? 'inside' : 'outside';

  const immediate = listUnackedVisible(
    location,
    readLane,
    options,
    peerLane,
    limit,
  );

  if (waitMs === undefined || waitMs === 0) {
    return immediate;
  }

  if (immediate.messages.length > 0) {
    return withWait(immediate, waitMs, startedAt, true);
  }

  return waitForMatching(
    location,
    readLane,
    peerLane,
    options,
    limit,
    waitMs,
    startedAt,
  );
}

/**
 * The shared unread/ack visibility filter — the single source of truth for which
 * inbox messages are "unacked + visible" under a given filter. Consumed by
 * `pollInboxLane` (this module) and `event-wait` (the `wait_for_any` primitive)
 * so the two surfaces can never drift. NOT for ledger/drain consumers, which
 * derive over raw `folder.ts` lanes — a visible-message list is the wrong shape
 * for ack-chain/count work.
 *
 * `readLane` is the lane to read; `peerLane` (the OTHER lane, derived if omitted)
 * holds the `ack` records that drive the `unread` filter. Filter chain order is
 * LOAD-BEARING (see module doc): unread -> type -> waitForAny -> after.
 */
export function listUnackedVisible(
  location: CoordinationRunLocation,
  readLane: Side,
  options: ListFilterOptions,
  peerLane: Side = readLane === 'outside' ? 'inside' : 'outside',
  limit: number = normalizeLimit(options.limit),
): PollInboxResult {
  const readMessages = readLaneFile(location, readLane);
  const peerMessages = readLaneFile(location, peerLane);
  const acknowledged = new Set(
    peerMessages
      .filter((m) => m.type === 'ack' && m.ackOf)
      .map((m) => m.ackOf as string),
  );

  let visible = options.unread
    ? readMessages.filter((m) => !acknowledged.has(m.id))
    : readMessages;

  if (options.type !== undefined) {
    visible = visible.filter((m) => m.type === options.type);
  }
  if (options.waitForAny !== undefined) {
    const types = new Set(options.waitForAny);
    visible = visible.filter((m) => types.has(m.type));
  }
  if (options.after !== undefined) {
    const index = visible.findIndex((m) => m.id === options.after);
    visible = index === -1 ? [] : visible.slice(index + 1);
  }

  const messages = visible.slice(0, limit);
  return {
    messages,
    nextAfter: visible.length > limit ? (messages.at(-1)?.id ?? null) : null,
  };
}

function waitForMatching(
  location: CoordinationRunLocation,
  readLane: Side,
  peerLane: Side,
  options: PollInboxOptions,
  limit: number,
  waitMs: number,
  startedAt: number,
): Promise<PollInboxResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let watcher: FileWatcher | null = null;

    const cleanup = (): void => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      watcher?.close();
      watcher = null;
    };
    const settle = (cb: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      cb();
    };
    const completeIfMatched = (): void => {
      let output: PollInboxResult;
      try {
        output = listUnackedVisible(
          location,
          readLane,
          options,
          peerLane,
          limit,
        );
      } catch (error) {
        settle(() => reject(toPollError(error)));
        return;
      }
      if (output.messages.length > 0) {
        settle(() => resolve(withWait(output, waitMs, startedAt, true)));
      }
    };
    const completeWithTimeout = (): void => {
      let output: PollInboxResult;
      try {
        output = listUnackedVisible(
          location,
          readLane,
          options,
          peerLane,
          limit,
        );
      } catch (error) {
        settle(() => reject(toPollError(error)));
        return;
      }
      settle(() =>
        resolve(
          output.messages.length > 0
            ? withWait(output, waitMs, startedAt, true)
            : withWait(
                { messages: [], nextAfter: null },
                waitMs,
                startedAt,
                false,
              ),
        ),
      );
    };

    try {
      watcher = watchFileChanges(
        inboxLanePath(location, readLane),
        completeIfMatched,
        {
          debounceMs: 0,
          watchFactory: options.watchFactory,
          onError: (error) => {
            settle(() =>
              reject(
                new InboxPollError(
                  'INBOX_POLL_INTERNAL',
                  `inbox wait watcher failed: ${error.message}`,
                ),
              ),
            );
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(
        new InboxPollError(
          'INBOX_POLL_INTERNAL',
          `inbox wait watcher failed: ${message}`,
        ),
      );
      return;
    }

    timeout = setTimeout(completeWithTimeout, waitMs);
    completeIfMatched();
  });
}

function withWait(
  output: PollInboxResult,
  requestedMs: number,
  startedAt: number,
  matched: boolean,
): PollInboxResult {
  return {
    ...output,
    wait: {
      requestedMs,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      timedOut: !matched,
      matched,
    },
  };
}

function readLaneFile(
  location: CoordinationRunLocation,
  lane: Side,
): InboxMessage[] {
  const filePath = inboxLanePath(location, lane);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw === '') return [];
  if (!raw.endsWith('\n')) {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      'inbox lane has a torn final line',
    );
  }

  const messages: InboxMessage[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    messages.push(parseMessageLine(lines[i], lane, i + 1));
  }
  return messages;
}

function parseMessageLine(
  line: string,
  lane: Side,
  lineNumber: number,
): InboxMessage {
  if (line.trim() === '') {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox lane contains an empty line at ${lineNumber}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox lane contains malformed JSON at line ${lineNumber}`,
    );
  }
  if (!isRecord(value)) {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox message at line ${lineNumber} must be an object`,
    );
  }

  const message: InboxMessage = {
    id: requireStringField(value, 'id', lineNumber),
    sender: requireSender(value, lineNumber),
    type: requireStringField(value, 'type', lineNumber),
    subject: requireStringField(value, 'subject', lineNumber),
    body: requireStringField(value, 'body', lineNumber),
    ts: requireStringField(value, 'ts', lineNumber),
  };

  if (message.sender !== lane) {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox message at line ${lineNumber} is in the wrong lane`,
    );
  }
  if (Number.isNaN(Date.parse(message.ts))) {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox message at line ${lineNumber} has invalid ts`,
    );
  }
  if (value.ackOf !== undefined) {
    if (typeof value.ackOf !== 'string' || value.ackOf === '') {
      throw new InboxPollError(
        'INBOX_POLL_CORRUPT',
        `inbox message at line ${lineNumber} has invalid ackOf`,
      );
    }
    message.ackOf = value.ackOf;
  }
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) {
      throw new InboxPollError(
        'INBOX_POLL_CORRUPT',
        `inbox message at line ${lineNumber} has invalid meta`,
      );
    }
    message.meta = value.meta;
  }
  if (value.traceparent !== undefined) {
    if (typeof value.traceparent !== 'string') {
      throw new InboxPollError(
        'INBOX_POLL_CORRUPT',
        `inbox message at line ${lineNumber} has invalid traceparent`,
      );
    }
    message.traceparent = value.traceparent;
  }
  if (value.tracestate !== undefined) {
    if (typeof value.tracestate !== 'string') {
      throw new InboxPollError(
        'INBOX_POLL_CORRUPT',
        `inbox message at line ${lineNumber} has invalid tracestate`,
      );
    }
    message.tracestate = value.tracestate;
  }
  return message;
}

function requireStringField(
  record: Record<string, unknown>,
  field: string,
  lineNumber: number,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value === '') {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox message at line ${lineNumber} missing required field '${field}'`,
    );
  }
  return value;
}

function requireSender(
  record: Record<string, unknown>,
  lineNumber: number,
): Side {
  const sender = record.sender;
  if (sender !== 'inside' && sender !== 'outside') {
    throw new InboxPollError(
      'INBOX_POLL_CORRUPT',
      `inbox message at line ${lineNumber} has invalid sender`,
    );
  }
  return sender;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new InboxPollError(
      'INBOX_POLL_INVALID_ARGUMENT',
      `limit must be an integer from 1 to ${MAX_LIST_LIMIT}`,
    );
  }
  return limit;
}

function normalizeWaitMs(
  waitMs: number | undefined,
  maxWaitMs: number,
): number | undefined {
  if (waitMs === undefined) return undefined;
  if (
    !Number.isFinite(waitMs) ||
    !Number.isInteger(waitMs) ||
    waitMs < 0 ||
    waitMs > maxWaitMs
  ) {
    throw new InboxPollError(
      'INBOX_POLL_INVALID_ARGUMENT',
      `waitMs must be an integer from 0 to ${maxWaitMs}`,
    );
  }
  return waitMs;
}

function toPollError(error: unknown): Error {
  if (error instanceof InboxPollError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new InboxPollError('INBOX_POLL_INTERNAL', message);
}
