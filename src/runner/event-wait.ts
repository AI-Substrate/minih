/**
 * Plan 014 — `wait_for_any` event-wait primitive.
 *
 * Settlement race over N watch sources (inbox.message, state.peer.changed,
 * state.self.changed). Single-settle, batched delivery, self-write filter for
 * `state.self.changed`. Reuses `watchFileChanges` (file-watcher.ts) and
 * `readLaneFile`/JSON parsing for inbox/state reads.
 *
 * Design source: docs/plans/014-wait-for-any-events/workshops/001-event-taxonomy-and-envelope.md
 */

import * as fs from 'node:fs';
import {
  type FileWatcher,
  type WatchFactory,
  watchFileChanges,
} from './file-watcher.js';
import {
  type CoordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from './folder.js';
import { InboxPollError, listUnackedVisible } from './inbox-poll.js';
import type {
  EventEnvelope,
  EventKind,
  InboxMessage,
  Side,
  SideState,
  WaitForAnyResult,
  WatchEntry,
} from './types.js';

/** Thrown when a state file exists but contains malformed JSON. */
export class StateFileCorruptError extends Error {
  constructor(
    public readonly side: Side,
    message: string,
  ) {
    super(message);
    this.name = 'StateFileCorruptError';
  }
}

/** Thrown when an inbox lane has malformed JSON / torn final line. */
export class EventWaitInboxCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventWaitInboxCorruptError';
  }
}

export interface WaitForAnyOptions {
  location: CoordinationRunLocation;
  /** Side of the agent calling waitForAny — used to map peer/self for state kinds. */
  side: Side;
  events: WatchEntry[];
  waitMs: number;
  /** Optional injected watch factory for testing (FakeNativeWatcher). */
  watchFactory?: WatchFactory;
  /** Optional injected clock for tests. */
  now?: () => number;
}

/**
 * Watches all registered event sources up to `waitMs`, returning every event
 * that fired during the wait window. Returns `events: []` + `timedOut: true`
 * if nothing fires.
 *
 * Single-settle: every watcher is torn down on first settlement (event-fire,
 * timeout, or error), regardless of path. Cleanup is idempotent.
 */
export function waitForAny(opts: WaitForAnyOptions): Promise<WaitForAnyResult> {
  const startedAt = (opts.now ?? Date.now)();
  const collected: EventEnvelope[] = [];

  // State sources snapshot-at-entry so we only emit on a change observed during
  // the wait window. The inbox source does NOT snapshot — it uses the durable
  // unread/ack model (the immediate pass + watcher below), so a message queued
  // before the call is still delivered (#40).
  const peerStateSnapshot = snapshotState(opts, peerSide(opts.side));
  const selfStateSnapshot = snapshotState(opts, opts.side);

  return new Promise<WaitForAnyResult>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const watchers: FileWatcher[] = [];

    const cleanup = (): void => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // best-effort teardown — never throw from cleanup
        }
      }
      watchers.length = 0;
    };

    const settle = (cb: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      cb();
    };

    const completeWith = (matched: boolean): void => {
      const elapsed = Math.max(0, (opts.now ?? Date.now)() - startedAt);
      // Sort events ascending by envelope ts (multi-event delivery contract).
      collected.sort((a, b) => a.ts.localeCompare(b.ts));
      settle(() =>
        resolve({
          events: collected.slice(),
          wait: {
            requestedMs: opts.waitMs,
            elapsedMs: elapsed,
            timedOut: !matched,
            matched,
          },
        }),
      );
    };

    const onError = (error: unknown): void => {
      settle(() => reject(error));
    };

    // Immediate pass (inbox.message only): deliver matches already queued at
    // entry, mirroring pollInboxLane. Runs BEFORE any watcher/timeout is armed,
    // so an immediate settle leaves nothing to leak (V-2). A torn peer lane here
    // surfaces as EventWaitInboxCorruptError rather than the swallow-to-empty the
    // old snapshot did (V-1).
    try {
      const immediate = collectImmediateInbox(opts);
      if (immediate.length > 0) {
        collected.push(...immediate);
        completeWith(true);
        return;
      }
    } catch (error) {
      onError(error);
      return;
    }

    // No immediate match — register one watch per event entry. Duplicate kinds
    // rejected at the MCP boundary; runner trusts caller to give us a clean list.
    for (const entry of opts.events) {
      try {
        registerWatch(
          entry,
          opts,
          {
            peerStateSnapshot,
            selfStateSnapshot,
          },
          (envelopes) => {
            if (envelopes.length === 0) return;
            collected.push(...envelopes);
            completeWith(true);
          },
          onError,
          watchers,
        );
      } catch (error) {
        // Registration failure tears down anything already set up
        onError(error);
        return;
      }
    }

    timeout = setTimeout(() => completeWith(false), opts.waitMs);
  });
}

interface Snapshots {
  peerStateSnapshot: SideState | null;
  selfStateSnapshot: SideState | null;
}

function registerWatch(
  entry: WatchEntry,
  opts: WaitForAnyOptions,
  snapshots: Snapshots,
  emit: (envelopes: EventEnvelope[]) => void,
  onError: (error: unknown) => void,
  watchers: FileWatcher[],
): void {
  switch (entry.kind) {
    case 'inbox.message': {
      const peerLanePath = inboxLanePath(opts.location, peerSide(opts.side));
      const filterTypes = entry.filter?.types ?? null;
      const watcher = watchFileChanges(
        peerLanePath,
        () => {
          // Re-read the peer lane's UNACKED matches (not an entry snapshot), so
          // delivery is identical to inbox_list and a pre-acked message never
          // re-wakes. Single-settle teardown means the first non-empty read wins.
          let messages: InboxMessage[];
          try {
            messages = readUnackedPeer(opts, filterTypes);
          } catch (error) {
            onError(error);
            return;
          }
          if (messages.length === 0) return;
          emit(
            messages.map(
              (m): EventEnvelope => ({
                kind: 'inbox.message',
                ts: nowIso(opts),
                data: { message: m },
              }),
            ),
          );
        },
        {
          watchFactory: opts.watchFactory,
          onError: (err) => onError(err),
        },
      );
      watchers.push(watcher);
      return;
    }
    case 'state.peer.changed': {
      const targetSide = peerSide(opts.side);
      const targetPath = stateFilePath(opts.location, targetSide);
      const watcher = watchFileChanges(
        targetPath,
        () => {
          let state: SideState | null;
          try {
            state = readStateSafe(targetPath, targetSide);
          } catch (error) {
            onError(error);
            return;
          }
          if (state === null) return; // file removed / torn — wait for next tick
          if (statesEqual(state, snapshots.peerStateSnapshot)) return; // no logical change
          snapshots.peerStateSnapshot = state;
          emit([
            {
              kind: 'state.peer.changed',
              ts: nowIso(opts),
              data: { newState: state },
            },
          ]);
        },
        {
          watchFactory: opts.watchFactory,
          onError: (err) => onError(err),
        },
      );
      watchers.push(watcher);
      return;
    }
    case 'state.self.changed': {
      const targetSide = opts.side;
      const targetPath = stateFilePath(opts.location, targetSide);
      const watcher = watchFileChanges(
        targetPath,
        () => {
          let state: SideState | null;
          try {
            state = readStateSafe(targetPath, targetSide);
          } catch (error) {
            onError(error);
            return;
          }
          if (state === null) return;
          if (statesEqual(state, snapshots.selfStateSnapshot)) return;
          // Self-write filter: if the new state was updated by THIS side, it
          // is the agent's own write; suppress + advance snapshot so the next
          // fire diffs against the new state.
          const isSelfWrite = state.updatedBy === opts.side;
          snapshots.selfStateSnapshot = state;
          if (isSelfWrite) return;
          emit([
            {
              kind: 'state.self.changed',
              ts: nowIso(opts),
              data: { newState: state },
            },
          ]);
        },
        {
          watchFactory: opts.watchFactory,
          onError: (err) => onError(err),
        },
      );
      watchers.push(watcher);
      return;
    }
    default: {
      // Exhaustiveness check
      const _exhaustive: never = entry;
      throw new Error(
        `unhandled WatchEntry kind: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function peerSide(side: Side): Side {
  return side === 'inside' ? 'outside' : 'inside';
}

function nowIso(opts: WaitForAnyOptions): string {
  return new Date((opts.now ?? Date.now)()).toISOString();
}

function collectImmediateInbox(opts: WaitForAnyOptions): EventEnvelope[] {
  const envelopes: EventEnvelope[] = [];
  for (const entry of opts.events) {
    if (entry.kind !== 'inbox.message') continue;
    const filterTypes = entry.filter?.types ?? null;
    for (const m of readUnackedPeer(opts, filterTypes)) {
      envelopes.push({
        kind: 'inbox.message',
        ts: nowIso(opts),
        data: { message: m },
      });
    }
  }
  return envelopes;
}

/**
 * Read the peer lane's UNACKED messages under the given type filter, via the
 * shared inbox-poll helper so wait_for_any and inbox_list never drift. A torn /
 * corrupt lane maps to EventWaitInboxCorruptError — the old snapshotInboxIds
 * swallowed it; the immediate-pass read must surface it (V-1).
 */
function readUnackedPeer(
  opts: WaitForAnyOptions,
  filterTypes: readonly string[] | null,
): InboxMessage[] {
  try {
    return listUnackedVisible(opts.location, peerSide(opts.side), {
      unread: true,
      waitForAny: filterTypes ?? undefined,
    }).messages;
  } catch (error) {
    if (error instanceof InboxPollError && error.code === 'INBOX_POLL_CORRUPT') {
      throw new EventWaitInboxCorruptError(error.message);
    }
    throw error;
  }
}

function snapshotState(
  opts: WaitForAnyOptions,
  targetSide: Side,
): SideState | null {
  const targetPath = stateFilePath(opts.location, targetSide);
  try {
    return readStateSafe(targetPath, targetSide);
  } catch {
    // Corrupt at entry — surface only when the watcher fires (real change).
    return null;
  }
}

function readStateSafe(filePath: string, side: Side): SideState | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new StateFileCorruptError(
      side,
      `state file ${side}.json contains malformed JSON`,
    );
  }
  if (!isSideState(value, side)) {
    throw new StateFileCorruptError(
      side,
      `state file ${side}.json has unexpected shape`,
    );
  }
  return value;
}

function statesEqual(a: SideState | null, b: SideState | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  // Safe: Node.js preserves object key order through JSON.parse → stringify
  // roundtrips for objects written by our own runtime (writeState uses
  // writeFileAtomicAsync over fixed-shape SideState objects). A future
  // refactor that constructs state objects with dynamic / non-deterministic
  // key ordering would need a structural diff here instead.
  return JSON.stringify(a) === JSON.stringify(b);
}

function isSideState(value: unknown, side: Side): value is SideState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === 'string' &&
    typeof v.data === 'object' &&
    v.data !== null &&
    typeof v.updatedAt === 'string' &&
    (v.updatedBy === 'inside' || v.updatedBy === 'outside') &&
    // updatedBy must match the file we're reading
    v.updatedBy === side
  );
}

/** Used by tests to enumerate event kinds without importing the schema. */
export const SUPPORTED_EVENT_KINDS: readonly EventKind[] = [
  'inbox.message',
  'state.peer.changed',
  'state.self.changed',
];
