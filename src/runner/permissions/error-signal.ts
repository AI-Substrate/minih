/**
 * 5-signal denial protocol — Plan 018 R1 / Workshop 002 § Q1.
 *
 * When a `permission_denied` event fires (from sdk-copilot.ts wrapping a
 * user-supplied permissionHandler that returned `reject`), the runner
 * MUST signal the denial across five surfaces:
 *
 *   1. events.ndjson         — mandatory; already covered by adapter
 *   2. run.json              — mandatory; set terminalReason + exit code
 *   3. inside-state          — best-effort; coordinated agents only
 *   4. outside inbox         — best-effort; coordinated agents only
 *   5. exit code 126         — POSIX permission-denied
 *
 * `terminalFired` mutex enforces first-trigger-wins. Subsequent denials in
 * the same run noop (the agent is already tearing down).
 *
 * Domain: runner. Pure side-effect helpers; no event emission of its own.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type CoordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from '../folder.js';
import type { InboxMessage, InsideState } from '../types.js';
import { ulid } from '../ulid.js';
import type { PermissionDenialReason } from './handler.js';
import type { ResolvedPolicy } from './policy.js';

export interface PermissionErrorPayload {
  meta: { contractVersion: 1 };
  kind: PermissionDenialReason['kind'];
  decision: 'deny' | 'prompt-user';
  agentSlug: string;
  runId: string;
  occurredAt: string;
  message: string;
  toolName?: string;
  attemptedPath?: string;
  requestId?: string;
  toolCallId?: string;
  policyDigest?: {
    presetName: string;
    canonicalRoots: string[];
  };
}

export interface FireDenialOptions {
  runDir: string;
  runId: string;
  agentSlug: string;
  agentsDir?: string;
  /**
   * `true` when the agent's `coordination` frontmatter is `enabled: true`.
   * Controls whether signals 3 + 4 (inside-state, outside-inbox) fire.
   */
  coordinationEnabled: boolean;
  /** The resolved policy at run-start (used for `policyDigest`). */
  policy: ResolvedPolicy;
  reason: PermissionDenialReason;
  /**
   * Best-effort signal failures get accumulated here for run.json
   * (per workshop 002 § Q1 — failures recorded, never thrown).
   */
  signalFailures: Array<{ signal: string; error: string }>;
}

export interface DenialState {
  terminalFired: boolean;
  exitCode: number;
  /** Echoed into run.json.terminalReason. */
  reason: 'permission-denied' | null;
  /** Echoed into run.json for `permission resume` to surface (AC31 follow-up). */
  payload: PermissionErrorPayload | null;
  signalFailures: Array<{ signal: string; error: string }>;
}

export function buildPermissionErrorPayload(
  reason: PermissionDenialReason,
  policy: ResolvedPolicy,
  agentSlug: string,
  runId: string,
): PermissionErrorPayload {
  return {
    meta: { contractVersion: 1 },
    kind: reason.kind,
    decision: reason.decision === 'prompt-user' ? 'prompt-user' : 'deny',
    agentSlug,
    runId,
    occurredAt: new Date().toISOString(),
    message: reason.message,
    toolName: reason.toolName,
    attemptedPath: reason.attemptedPath,
    requestId: reason.requestId,
    toolCallId: reason.toolCallId,
    policyDigest: {
      presetName: policy.presetName,
      canonicalRoots: policy.canonicalRoots,
    },
  };
}

/**
 * Best-effort write of `state/inside.json` — overwrites the file with a
 * minimal terminal state so `outside attach` / `view` show the failure.
 *
 * This is fire-once per run; subsequent calls noop (the runner sets
 * `denialState.terminalFired = true` before invoking other signals).
 *
 * Failure to write is captured in `signalFailures` not thrown, per
 * workshop 002 § Q1.
 */
export function fireInsideStateSignal(
  location: CoordinationRunLocation,
  payload: PermissionErrorPayload,
  signalFailures: Array<{ signal: string; error: string }>,
): void {
  try {
    const target = stateFilePath(location, 'inside');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const state: InsideState = {
      status: 'error',
      data: { permissionError: payload },
      updatedAt: payload.occurredAt,
      updatedBy: 'inside',
    };
    fs.writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    signalFailures.push({
      signal: 'inside-state',
      error: (err as Error).message ?? String(err),
    });
  }
}

/**
 * Best-effort append of a `permission-error` typed message to the outside
 * inbox. Coordinated agents only.
 */
export function fireOutsideInboxSignal(
  location: CoordinationRunLocation,
  payload: PermissionErrorPayload,
  signalFailures: Array<{ signal: string; error: string }>,
): void {
  try {
    const message: InboxMessage = {
      id: ulid(),
      sender: 'inside',
      type: 'permission-error',
      subject: `Permission denied: kind=${payload.kind}${payload.toolName ? ` tool=${payload.toolName}` : ''}`,
      body: payload.message,
      ts: payload.occurredAt,
      meta: {
        contractVersion: 1,
        payload: payload as unknown as Record<string, unknown>,
      },
    };
    const target = inboxLanePath(location, 'outside');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(message)}\n`);
  } catch (err) {
    signalFailures.push({
      signal: 'outside-inbox',
      error: (err as Error).message ?? String(err),
    });
  }
}

/**
 * Drive the full denial chain. Idempotent on `state.terminalFired`.
 *
 *   - signal 1 (events.ndjson) is handled in adapter — assumed already fired.
 *   - signal 2 (run.json) is handled by the runner's terminal write path —
 *     this fn returns the `DenialState` so the runner can read
 *     `terminalReason` + `exitCode` from there.
 *   - signal 3-4 fire here for coordinated agents.
 *   - signal 5 (exit code 126) is part of `DenialState` for the runner.
 */
export function fireTerminalDenial(
  state: DenialState,
  options: FireDenialOptions,
): DenialState {
  if (state.terminalFired) return state;
  const payload = buildPermissionErrorPayload(
    options.reason,
    options.policy,
    options.agentSlug,
    options.runId,
  );

  state.terminalFired = true;
  state.reason = 'permission-denied';
  state.exitCode = 126;
  state.payload = payload;

  if (options.coordinationEnabled && options.agentsDir) {
    const location: CoordinationRunLocation = {
      slug: options.agentSlug,
      agentsDir: options.agentsDir,
      runId: options.runId,
    };
    fireInsideStateSignal(location, payload, state.signalFailures);
    fireOutsideInboxSignal(location, payload, state.signalFailures);
  }

  return state;
}
