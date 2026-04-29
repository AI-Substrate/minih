/**
 * Peer activity telemetry — derive ground-truth peer verdict from observed events.
 *
 * Pure verdict ladder lives in `derivePeerVerdict`. I/O wrapper (`derivePeerActivity`)
 * is built on top in T002.
 *
 * minih is the messenger, not the police: this module observes and labels.
 * It never enforces, blocks, or coerces.
 *
 * Workshop: docs/plans/012-peer-activity-telemetry/workshops/001-verdict-derivation-rules.md
 */

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
