import { describe, expect, it } from 'vitest';
import { evaluateIdlePolicy } from '../../src/runner/idle-policy.js';

/**
 * Plan 027 Phase 5 — AC-11. `evaluateIdlePolicy` is the PURE, runner-side
 * stand-down decision that replaces the companion prompt's integer poll-streak
 * heuristic (`emptyPollStreak` / `firstContactPollThreshold` / `replyWaitPolls`,
 * "no clock arithmetic"). It reads exactly two ledger fields —
 * `idleElapsedMs` and `unresolvedPeerRequests` — plus the configured budget and
 * the absolute run-timeout ceiling.
 *
 * The load-bearing reconciliation (PIC-P5-A / validate-v2 A1): the ledger has NO
 * wall-clock for a peer that never spoke — `idleElapsedMs === null`. So the
 * ceiling cannot be read off the ledger; the policy takes `runElapsedMs` +
 * `timeoutSec` and uses `idleElapsedMs ?? runElapsedMs` as the effective idle,
 * so even a never-connected dead peer still terminates.
 */

const SEC = 1000;
const BUDGET = 30 * 60 * SEC; // 1_800_000 — input-schema idleBudgetMs default
const TIMEOUT_SEC = 7200; // budgets.timeoutSec (2h) — the absolute ceiling

describe('evaluateIdlePolicy (AC-11)', () => {
  it('(i) outstanding work past budget, under backstop → CONTINUE (a naive budget impl would stand down)', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: BUDGET + 60_000, unresolvedPeerRequests: 2 },
      {
        idleBudgetMs: BUDGET,
        runElapsedMs: BUDGET + 60_000,
        timeoutSec: TIMEOUT_SEC,
      },
    );
    expect(d.standDown).toBe(false);
    expect(d.exitReason).toBeNull();
  });

  it('(ii) idle past budget, zero unresolved → STAND DOWN idle_budget', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: BUDGET + 1, unresolvedPeerRequests: 0 },
      {
        idleBudgetMs: BUDGET,
        runElapsedMs: BUDGET + 5_000,
        timeoutSec: TIMEOUT_SEC,
      },
    );
    expect(d.standDown).toBe(true);
    expect(d.exitReason).toBe('idle_budget');
  });

  it('(iii) never-spoke (idleElapsedMs===null), run-elapsed past budget → STAND DOWN no_engagement (fails an idle-only impl — A1)', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: null, unresolvedPeerRequests: 0 },
      {
        idleBudgetMs: BUDGET,
        runElapsedMs: BUDGET + 1,
        timeoutSec: TIMEOUT_SEC,
      },
    );
    expect(d.standDown).toBe(true);
    expect(d.exitReason).toBe('no_engagement');
  });

  it('(iv) run-elapsed past the absolute timeout ceiling → STAND DOWN regardless of outstanding work', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: 5_000, unresolvedPeerRequests: 3 },
      {
        idleBudgetMs: BUDGET,
        runElapsedMs: TIMEOUT_SEC * SEC + 1,
        timeoutSec: TIMEOUT_SEC,
      },
    );
    expect(d.standDown).toBe(true);
    // peer spoke (idleElapsedMs non-null) → idle_budget; the backstop overrides the outstanding-work continue
    expect(d.exitReason).toBe('idle_budget');
  });

  it('under budget, nothing outstanding → CONTINUE', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: 60_000, unresolvedPeerRequests: 0 },
      { idleBudgetMs: BUDGET, runElapsedMs: 120_000, timeoutSec: TIMEOUT_SEC },
    );
    expect(d.standDown).toBe(false);
    expect(d.exitReason).toBeNull();
  });

  it('never-spoke but still under budget → CONTINUE (first-contact window, no premature stand-down — A6)', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: null, unresolvedPeerRequests: 0 },
      { idleBudgetMs: BUDGET, runElapsedMs: 60_000, timeoutSec: TIMEOUT_SEC },
    );
    expect(d.standDown).toBe(false);
    expect(d.exitReason).toBeNull();
  });

  it('backstop fires for a never-spoke peer → no_engagement (a peer that never connected still terminates)', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: null, unresolvedPeerRequests: 0 },
      {
        idleBudgetMs: BUDGET,
        runElapsedMs: TIMEOUT_SEC * SEC + 1,
        timeoutSec: TIMEOUT_SEC,
      },
    );
    expect(d.standDown).toBe(true);
    expect(d.exitReason).toBe('no_engagement');
  });

  it('exposes a human-readable reason on every decision', () => {
    const d = evaluateIdlePolicy(
      { idleElapsedMs: null, unresolvedPeerRequests: 0 },
      { idleBudgetMs: BUDGET, runElapsedMs: 60_000, timeoutSec: TIMEOUT_SEC },
    );
    expect(typeof d.reason).toBe('string');
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
