/**
 * Per-agent state helpers — pure data layer over `agents/<slug>/state/`.
 *
 * Workshop 002 + didyouknow #2: minih is an enabler, not an orchestrator.
 * This module is **types + pure helpers only**. NO rule engine, NO transition
 * predicates, NO `requiresPeer` enforcement. Per-agent state schemas (P6)
 * provide the constraint at MCP `state_transition` time; outside negotiates
 * via inbox messages if it disagrees.
 *
 * Workshop 001 §Initial State Behavior: when the side state file is absent,
 * `readStateLazy` returns a synthetic default — never persisted, never written.
 *
 * Corruption is NOT silently masked: a present-but-invalid state file throws
 * `StateCorruptError`. Callers must decide whether to recover (read history,
 * reset) or fail loudly. Silently defaulting on corruption is a data-loss
 * footgun.
 *
 * `appendHistory` enforces line size ≤ PIPE_BUF (4096 bytes) so POSIX
 * single-call append atomicity holds.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';
import type { CoordinationRunLocation } from './folder.js';
import {
  historyPath,
  InvalidSlugError,
  stateFilePath,
  validateSlug,
} from './folder.js';
import type {
  InsideState,
  OutsideState,
  Side,
  SideState,
  StateHistoryEntry,
} from './types.js';

const PIPE_BUF = 4096;

export class StateCorruptError extends Error {
  constructor(filePath: string, cause: string) {
    super(`state file is corrupt: ${filePath} — ${cause}`);
    this.name = 'StateCorruptError';
  }
}

export class HistoryLineTooLargeError extends Error {
  constructor(byteLen: number) {
    super(
      `history line exceeds PIPE_BUF (${byteLen} bytes > ${PIPE_BUF}); single-call appendFile atomicity not guaranteed`,
    );
    this.name = 'HistoryLineTooLargeError';
  }
}

export { InvalidSlugError } from './folder.js';

function ensureValidSlug(slug: string): void {
  const err = validateSlug(slug);
  if (err !== null) throw new InvalidSlugError(slug, err);
}

function syntheticDefault(side: Side): SideState {
  const base = {
    status: 'idle',
    data: {},
    updatedAt: new Date().toISOString(),
  };
  return side === 'outside'
    ? ({ ...base, updatedBy: 'outside' } as OutsideState)
    : ({ ...base, updatedBy: 'inside' } as InsideState);
}

/**
 * Read the state for `side`. Returns a synthetic default `{status: 'idle', ...}`
 * when the file is absent — NOT persisted; NOT side-effecting. Throws
 * `StateCorruptError` if the file is present but invalid JSON or missing the
 * minimum required fields.
 */
export function readStateLazy(
  location: CoordinationRunLocation,
  side: Side,
): SideState {
  ensureValidSlug(location.slug);
  const file = stateFilePath(location, side);
  if (!fs.existsSync(file)) return syntheticDefault(side);

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new StateCorruptError(file, `read failed: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StateCorruptError(
      file,
      `invalid JSON: ${(err as Error).message}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StateCorruptError(file, 'not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  for (const required of ['status', 'data', 'updatedAt', 'updatedBy']) {
    if (!(required in obj)) {
      throw new StateCorruptError(file, `missing required field: ${required}`);
    }
  }
  // Type-check the field values, not just key presence (per code-review F002).
  // Without this, persisted state like `{status: 42, data: [], updatedAt: 'not-a-date'}`
  // would pass the four-key check and be silently returned as `SideState`.
  if (typeof obj.status !== 'string' || obj.status.length === 0) {
    throw new StateCorruptError(
      file,
      `field 'status' must be a non-empty string, got ${typeof obj.status}`,
    );
  }
  if (
    obj.data === null ||
    typeof obj.data !== 'object' ||
    Array.isArray(obj.data)
  ) {
    throw new StateCorruptError(
      file,
      `field 'data' must be a JSON object, got ${
        Array.isArray(obj.data) ? 'array' : typeof obj.data
      }`,
    );
  }
  if (typeof obj.updatedAt !== 'string') {
    throw new StateCorruptError(
      file,
      `field 'updatedAt' must be a string, got ${typeof obj.updatedAt}`,
    );
  }
  // Cheap ISO-8601 sanity check — full date-time validation happens at AJV
  // boundaries; here we just refuse obvious garbage like 'not-a-date'.
  if (Number.isNaN(Date.parse(obj.updatedAt))) {
    throw new StateCorruptError(
      file,
      `field 'updatedAt' is not a parseable date-time: '${obj.updatedAt}'`,
    );
  }
  if (obj.updatedBy !== side) {
    throw new StateCorruptError(
      file,
      `updatedBy mismatch: expected '${side}', got '${String(obj.updatedBy)}'`,
    );
  }
  return obj as unknown as SideState;
}

/**
 * Write `state` to the side file. Validates slug; ensures parent dir exists;
 * uses atomic write-then-rename (POSIX). Concurrent writers exhibit
 * last-write-wins on the file (workshop 001 §Concurrent-Access Semantics).
 */
export function writeState(
  location: CoordinationRunLocation,
  side: Side,
  state: SideState,
): void {
  ensureValidSlug(location.slug);
  const file = stateFilePath(location, side);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(state));
}

/**
 * Append a single transition to `state/history.ndjson`. Auto-populates
 * `peerStateAtTime` from the peer side's lazy-read state when caller omits it
 * — first-ever transitions consistently record `{status: 'idle'}`.
 *
 * Enforces line size ≤ 4096 bytes (PIPE_BUF floor) so POSIX guarantees the
 * single `appendFileSync` call is atomic against concurrent appenders.
 */
export function appendHistory(
  location: CoordinationRunLocation,
  entry: Omit<StateHistoryEntry, 'peerStateAtTime'> &
    Partial<Pick<StateHistoryEntry, 'peerStateAtTime'>>,
): void {
  ensureValidSlug(location.slug);
  const file = historyPath(location);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Auto-populate peerStateAtTime if absent: snapshot the OTHER side now.
  const peerStateAtTime =
    entry.peerStateAtTime ??
    (() => {
      const otherSide: Side = entry.side === 'outside' ? 'inside' : 'outside';
      const peer = readStateLazy(location, otherSide);
      return { status: peer.status };
    })();

  const fullEntry: StateHistoryEntry = {
    ts: entry.ts,
    side: entry.side,
    from: entry.from,
    to: entry.to,
    reason: entry.reason,
    peerStateAtTime,
  };

  const line = `${JSON.stringify(fullEntry)}\n`;
  const byteLen = Buffer.byteLength(line, 'utf8');
  if (byteLen > PIPE_BUF) throw new HistoryLineTooLargeError(byteLen);

  fs.appendFileSync(file, line);
}
