/**
 * Peer activity telemetry — derive ground-truth peer verdict from observed events.
 *
 * Pure verdict ladder lives in `derivePeerVerdict` (no I/O).
 * I/O wrapper `derivePeerActivity` reads events.ndjson + state/inside.json + run.json.
 *
 * minih is the messenger, not the police: this module observes and labels.
 * It never enforces, blocks, or coerces.
 *
 * Workshop: docs/plans/012-peer-activity-telemetry/workshops/001-verdict-derivation-rules.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readManifest } from './run-manifest.js';
import type { LiveRunStatus } from './types.js';

export type PeerVerdict =
  | 'listening'
  | 'between-polls'
  | 'deaf'
  | 'silent'
  | 'dead'
  | 'n/a'
  | 'unknown';

/**
 * Inputs to the pure verdict function. All fields are pre-derived from the run dir
 * (events.ndjson tail, state/inside.json, run.json) or supplied by the caller.
 */
export interface DerivePeerInputs {
  /** True when reading <runDir>/events.ndjson failed (missing/torn/permission). */
  eventsReadFailed: boolean;

  /** True when <runDir>/state/inside.json exists (i.e. agent is coordination-enabled). */
  hasInsideState: boolean;

  /** From <runDir>/run.json `status`. Null if run.json missing or unparseable. */
  runStatus: LiveRunStatus | null;

  /** now - run.json.startedAt (ms). */
  runAgeMs: number;

  /** Newest inbox_list timestamp (ms since epoch); null if none observed in tail. */
  lastPollAt: number | null;

  /** Newest inbox_list `waitForAny` argument; null = open filter. */
  lastPollFilter: string[] | null;

  /** Newest inbox_list `waitMs` argument; null when absent. */
  lastPollWaitMs: number | null;

  /** Median delta between recent inbox_list calls; null if <2 calls in tail. */
  pollCadenceMs: number | null;

  /** Newest inside-side inbox_send timestamp; null if none. */
  lastSendAt: number | null;

  /** Newest inbox_ack messageId; null if none. */
  lastAckOf: string | null;

  /** Most recent non-coordination tool name (e.g. "bash"); null if not mid-tool. */
  currentlyRunningTool: string | null;

  /** state/inside.json status field. */
  selfReportedState: string | null;

  /** now - state/inside.json updatedAt (ms). */
  selfReportedStateAge: number | null;

  /** Type of message being sent (drives type-match check). Null for non-send commands. */
  messageType: string | null;

  /** Current time (ms since epoch). Injectable for tests. */
  now: number;

  /** Override silent threshold; default = max(2 * pollCadenceMs, 5min). */
  silentThresholdMs?: number;

  /** Override dead threshold; default = 30min. */
  deadThresholdMs?: number;

  /** Override grace period; default = 60s. */
  newRunGracePeriodMs?: number;
}

/** Output of the pure verdict function. */
export interface PeerActivity {
  verdict: PeerVerdict;
  reason: string;

  // Behavioural facts (objective, from telemetry)
  lastPollAt: string | null;
  lastPollFilter: string[] | null;
  lastPollWaitMs: number | null;
  pollWindowEndsAt: string | null;
  currentlyPolling: boolean;
  willMatchType: boolean | null;
  pollCadenceMs: number | null;
  idleSinceMs: number | null;
  lastSendAt: string | null;
  lastAckOf: string | null;
  currentlyRunningTool: string | null;

  // Self-reported state (informational, lower-trust)
  selfReportedState: string | null;
  selfReportedStateAge: number | null;
}

const DEFAULTS = {
  silentThresholdFloorMs: 5 * 60_000,
  deadThresholdMs: 30 * 60_000,
  newRunGracePeriodMs: 60_000,
  defaultCadenceMs: 30_000,
};

const DEAD_RUN_STATUSES: ReadonlyArray<LiveRunStatus> = [
  'completed',
  'failed',
  'stale',
];

/**
 * Compute whether a poll filter would match the message type.
 * - null filter or empty filter → open (matches anything).
 * - null messageType → "n/a" semantically; returns null so callers know type-match is irrelevant.
 */
export function computeWillMatch(
  lastPollFilter: string[] | null,
  messageType: string | null,
): boolean | null {
  if (messageType === null) return null;
  if (lastPollFilter === null) return true;
  if (lastPollFilter.length === 0) return true;
  return lastPollFilter.includes(messageType);
}

/**
 * Pure verdict ladder per workshop §"Decision Ladder".
 * First-match-wins. 10 rules. No I/O. Deterministic.
 */
export function derivePeerVerdict(input: DerivePeerInputs): {
  verdict: PeerVerdict;
  reason: string;
} {
  // Rule 1 — unknown
  if (input.eventsReadFailed) {
    return { verdict: 'unknown', reason: 'could not read events.ndjson' };
  }

  // Rule 2 — n/a
  if (!input.hasInsideState) {
    return { verdict: 'n/a', reason: 'agent is not coordination-enabled' };
  }

  // Rule 3 — dead (run.json status)
  if (input.runStatus !== null && DEAD_RUN_STATUSES.includes(input.runStatus)) {
    return { verdict: 'dead', reason: `run.json status: ${input.runStatus}` };
  }

  // Rule 4 — dead (no polls past grace)
  const grace = input.newRunGracePeriodMs ?? DEFAULTS.newRunGracePeriodMs;
  if (input.lastPollAt === null && input.runAgeMs > grace) {
    return {
      verdict: 'dead',
      reason: `run is ${fmtAge(input.runAgeMs)} old but no inbox_list calls observed`,
    };
  }

  // Rule 5 — dead (last poll past dead threshold)
  const deadMs = input.deadThresholdMs ?? DEFAULTS.deadThresholdMs;
  if (input.lastPollAt !== null && input.now - input.lastPollAt > deadMs) {
    return {
      verdict: 'dead',
      reason: `last poll ${fmtAge(input.now - input.lastPollAt)} ago`,
    };
  }

  // Rule 6 — silent (run just started, in grace period)
  if (input.lastPollAt === null) {
    return {
      verdict: 'silent',
      reason: 'no inbox_list calls observed yet (run just started)',
    };
  }

  // Rule 7 — silent (idle past silent threshold)
  const cadence = input.pollCadenceMs ?? DEFAULTS.defaultCadenceMs;
  const silentThreshold =
    input.silentThresholdMs ??
    Math.max(2 * cadence, DEFAULTS.silentThresholdFloorMs);
  const idleSince = input.now - input.lastPollAt;
  const currentlyPolling =
    input.lastPollAt + (input.lastPollWaitMs ?? 0) > input.now;
  if (!currentlyPolling && idleSince > silentThreshold) {
    return {
      verdict: 'silent',
      reason: `no poll for ${fmtAge(idleSince)} (cadence ${fmtAge(cadence)})`,
    };
  }

  // Rule 8 — deaf (filter mismatch)
  const willMatch = computeWillMatch(input.lastPollFilter, input.messageType);
  if (input.messageType !== null && willMatch === false) {
    const filterList = input.lastPollFilter ?? [];
    const tryHint =
      filterList.length > 0 ? ` — try one of: ${filterList.join(', ')}` : '';
    return {
      verdict: 'deaf',
      reason: `lastPollFilter ${JSON.stringify(filterList)} does not include '${input.messageType}'${tryHint}`,
    };
  }

  // Rule 9 — listening
  if (currentlyPolling) {
    const endsAt = input.lastPollAt + (input.lastPollWaitMs ?? 0);
    return {
      verdict: 'listening',
      reason: `inside active poll window (ends ${fmtTime(endsAt)})`,
    };
  }

  // Rule 10 — between-polls (default)
  return {
    verdict: 'between-polls',
    reason: `last poll ${fmtAge(idleSince)} ago, cadence ${fmtAge(cadence)}`,
  };
}

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS === 0 ? `${m}min` : `${m}min ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h ${remM}min`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString();
}

// ============================================================================
// I/O wrapper — assembles DerivePeerInputs from a runDir, then delegates.
// ============================================================================

const COORDINATION_TOOLS: ReadonlySet<string> = new Set([
  'minih-coordination-inbox_list',
  'minih-coordination-inbox_send',
  'minih-coordination-inbox_ack',
  'minih-coordination-state_get',
  'minih-coordination-state_set',
  'minih-coordination-state_transition',
]);

interface ToolCallRecord {
  ts: number;
  toolName: string;
  // biome-ignore lint/suspicious/noExplicitAny: SDK input shape varies per tool
  input: any;
}

export interface DerivePeerActivityOptions {
  /** Absolute path to the agent's run dir. */
  runDir: string;

  /** Type of message being sent (drives type-match check). Null for non-send commands. */
  messageType: string | null;

  /** Injectable clock for tests. Default = Date.now. */
  now?: () => number;

  /** Number of trailing events.ndjson lines to scan. Default = 1000. */
  tailLines?: number;

  silentThresholdMs?: number;
  deadThresholdMs?: number;
  newRunGracePeriodMs?: number;
}

/**
 * Read up to `tailLines` lines from the END of a file. Tolerates:
 * - Missing file → empty array (no throw)
 * - Empty file → empty array
 * - Torn last line (no trailing newline) → discarded silently
 *
 * Reads the whole file for files smaller than 1 MB; for larger files, reads
 * the last 1 MB only (still bounded). Cost: a few ms for typical run dirs.
 */
async function readLastNLines(filePath: string, n: number): Promise<string[]> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  if (stat.size === 0) return [];

  const MAX_READ = 1024 * 1024;
  const readFrom = Math.max(0, stat.size - MAX_READ);
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const len = stat.size - readFrom;
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, readFrom);
    let text = buf.toString('utf8');
    // If we started mid-file, drop the (possibly torn) leading partial line.
    if (readFrom > 0) {
      const firstNl = text.indexOf('\n');
      text = firstNl >= 0 ? text.slice(firstNl + 1) : '';
    }
    const lines = text.split('\n').filter((l) => l.length > 0);
    return lines.slice(-n);
  } finally {
    await fd.close();
  }
}

interface RawEvent {
  type?: string;
  timestamp?: string;
  // biome-ignore lint/suspicious/noExplicitAny: data shape varies per event type
  data?: any;
}

function parseToolCall(line: string): ToolCallRecord | null {
  let ev: RawEvent;
  try {
    ev = JSON.parse(line) as RawEvent;
  } catch {
    return null; // torn / malformed line — silently drop
  }
  if (ev.type !== 'tool_call') return null;
  const data = ev.data;
  if (!data || typeof data.toolName !== 'string') return null;
  const ts = ev.timestamp ? Date.parse(ev.timestamp) : Number.NaN;
  if (Number.isNaN(ts)) return null;
  return { ts, toolName: data.toolName, input: data.input ?? {} };
}

function computeCadenceMs(polls: ToolCallRecord[]): number | null {
  if (polls.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < polls.length; i++) {
    deltas.push(polls[i].ts - polls[i - 1].ts);
  }
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  return deltas.length % 2 === 0
    ? Math.round((deltas[mid - 1] + deltas[mid]) / 2)
    : deltas[mid];
}

/**
 * Read run-dir state and produce a peer-activity snapshot.
 * Pure-ish: only reads files; never writes; deterministic for a given disk state + clock.
 */
export async function derivePeerActivity(
  opts: DerivePeerActivityOptions,
): Promise<PeerActivity> {
  const now = (opts.now ?? Date.now)();
  const tailLines = opts.tailLines ?? 1000;
  const messageType = opts.messageType;

  // 1. Tail events.ndjson and parse tool_call events.
  const eventsPath = path.join(opts.runDir, 'events.ndjson');
  let lines: string[] = [];
  let eventsReadFailed = false;
  try {
    lines = await readLastNLines(eventsPath, tailLines);
  } catch {
    eventsReadFailed = true;
  }
  const toolCalls: ToolCallRecord[] = [];
  for (const line of lines) {
    const tc = parseToolCall(line);
    if (tc !== null) toolCalls.push(tc);
  }

  const polls = toolCalls.filter(
    (tc) => tc.toolName === 'minih-coordination-inbox_list',
  );
  const sends = toolCalls.filter(
    (tc) => tc.toolName === 'minih-coordination-inbox_send',
  );
  const acks = toolCalls.filter(
    (tc) => tc.toolName === 'minih-coordination-inbox_ack',
  );

  const lastPoll = polls[polls.length - 1] ?? null;
  const lastPollAt = lastPoll?.ts ?? null;
  const lastPollFilter: string[] | null = Array.isArray(
    lastPoll?.input?.waitForAny,
  )
    ? (lastPoll.input.waitForAny as string[])
    : null;
  const lastPollWaitMs: number | null =
    typeof lastPoll?.input?.waitMs === 'number' ? lastPoll.input.waitMs : null;
  const pollCadenceMs = computeCadenceMs(polls);

  const lastSend = sends[sends.length - 1] ?? null;
  const lastSendAt = lastSend?.ts ?? null;
  const lastAck = acks[acks.length - 1] ?? null;
  const lastAckOf: string | null =
    typeof lastAck?.input?.messageId === 'string'
      ? lastAck.input.messageId
      : null;

  // currentlyRunningTool: most recent non-coordination tool name.
  let currentlyRunningTool: string | null = null;
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    if (!COORDINATION_TOOLS.has(toolCalls[i].toolName)) {
      currentlyRunningTool = toolCalls[i].toolName;
      break;
    }
  }

  // 2. Read run.json (status + age).
  let runStatus: LiveRunStatus | null = null;
  let runAgeMs = 0;
  try {
    const manifest = await readManifest(opts.runDir);
    if (manifest) {
      runStatus = manifest.status;
      const startedAt = Date.parse(manifest.startedAt);
      if (!Number.isNaN(startedAt)) runAgeMs = now - startedAt;
    }
  } catch {
    // tolerate manifest read errors — runStatus stays null
  }

  // 3. Detect inside-state presence + read self-reported fields if it exists.
  const insideStatePath = path.join(opts.runDir, 'state', 'inside.json');
  const hasInsideState = fs.existsSync(insideStatePath);
  let selfReportedState: string | null = null;
  let selfReportedStateAge: number | null = null;
  if (hasInsideState) {
    try {
      const raw = fs.readFileSync(insideStatePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        status?: unknown;
        updatedAt?: unknown;
      };
      if (typeof parsed.status === 'string') selfReportedState = parsed.status;
      if (typeof parsed.updatedAt === 'string') {
        const upd = Date.parse(parsed.updatedAt);
        if (!Number.isNaN(upd)) selfReportedStateAge = now - upd;
      }
    } catch {
      // tolerate corruption — keep self-reported fields null
    }
  }

  // 4. Assemble inputs and delegate to the pure verdict function.
  const inputs: DerivePeerInputs = {
    eventsReadFailed,
    hasInsideState,
    runStatus,
    runAgeMs,
    lastPollAt,
    lastPollFilter,
    lastPollWaitMs,
    pollCadenceMs,
    lastSendAt,
    lastAckOf,
    currentlyRunningTool,
    selfReportedState,
    selfReportedStateAge,
    messageType,
    now,
    silentThresholdMs: opts.silentThresholdMs,
    deadThresholdMs: opts.deadThresholdMs,
    newRunGracePeriodMs: opts.newRunGracePeriodMs,
  };
  const { verdict, reason } = derivePeerVerdict(inputs);

  // 5. Compose the snapshot envelope.
  const currentlyPolling =
    lastPollAt !== null && lastPollAt + (lastPollWaitMs ?? 0) > now;
  const pollWindowEndsAt =
    lastPollAt !== null && lastPollWaitMs !== null
      ? new Date(lastPollAt + lastPollWaitMs).toISOString()
      : null;

  return {
    verdict,
    reason,
    lastPollAt: lastPollAt !== null ? new Date(lastPollAt).toISOString() : null,
    lastPollFilter,
    lastPollWaitMs,
    pollWindowEndsAt,
    currentlyPolling,
    willMatchType: computeWillMatch(lastPollFilter, messageType),
    pollCadenceMs,
    idleSinceMs: lastPollAt !== null ? now - lastPollAt : null,
    lastSendAt: lastSendAt !== null ? new Date(lastSendAt).toISOString() : null,
    lastAckOf,
    currentlyRunningTool,
    selfReportedState,
    selfReportedStateAge,
  };
}
