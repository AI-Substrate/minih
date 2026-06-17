import type { CompanionLedger } from './types.js';

/**
 * Plan 027 Phase 5 (#35) — ledger-driven idle / stand-down policy.
 *
 * A PURE decision function (no fs, no SDK, no MCP/CLI imports) that replaces the
 * companion prompt's integer poll-streak heuristic (`emptyPollStreak` /
 * `firstContactPollThreshold` / `replyWaitPolls`, "no clock arithmetic") with a
 * decision read off durable ledger state plus the configured budget and an
 * absolute run-timeout ceiling. The companion prompt (T004) consults
 * `coordination_status` and mirrors this exact logic in prose.
 *
 * It reads exactly two fields off the ledger — `idleElapsedMs` and
 * `unresolvedPeerRequests` — so the input is typed as a `Pick` to make that
 * coupling explicit and prevent accidental dependence on the rest of the ledger.
 */
export type CompanionIdleLedger = Pick<
  CompanionLedger,
  'idleElapsedMs' | 'unresolvedPeerRequests'
>;

export interface IdlePolicyInput {
  /** Configured idle budget in ms (input-schema `idleBudgetMs`; min 60000, default 1_800_000). */
  idleBudgetMs: number;
  /**
   * Wall-clock ms since the run started. Required because the ledger has NO
   * clock for a peer that never spoke (`idleElapsedMs === null`) — without this
   * a never-connected dead peer could never be stood down (PIC-P5-A / A1).
   */
  runElapsedMs: number;
  /** Absolute run-timeout ceiling in seconds (`budgets.timeoutSec`). */
  timeoutSec: number;
  /** Reserved for symmetry with `deriveCompanionLedger(opts.now)`; unused by the pure decision. */
  now?: number;
  /**
   * Plan 028 Phase 5b (workshop 003) — survive-gaps posture. When true the
   * companion is EXPECTING work across a long human gap, so an idle stretch
   * alone must not stand it down: branch (b) is suppressed and only the
   * absolute wall-clock backstop (a) terminates it. Default/unset = the
   * plan-027 #35 behaviour, unchanged. Sourced durably from run.json
   * `budgets.surviveGaps` (see `readSurviveGaps`) so #49 reads it the same way
   * it reads `idleBudgetMs`.
   */
  surviveGaps?: boolean;
}

/** Stand-down decision. `exitReason` reuses the companion's existing exit vocabulary. */
export interface IdlePolicyDecision {
  standDown: boolean;
  exitReason: 'idle_budget' | 'no_engagement' | null;
  reason: string;
}

/**
 * Decide whether the companion should stand down.
 *
 * Stand down when EITHER:
 *  (a) the absolute backstop fires — `runElapsedMs >= timeoutSec*1000` — which
 *      terminates even a never-spoke dead peer and overrides outstanding work; or
 *  (b) nothing is outstanding AND the effective idle has reached the budget.
 *
 * A mid-phase gap (`unresolvedPeerRequests > 0`) under the backstop → CONTINUE:
 * work is still owed, so an idle stretch alone must not stand the companion down.
 *
 * Effective idle = `idleElapsedMs ?? runElapsedMs`: a peer that never spoke has
 * been idle since boot, so run-elapsed is the right clock for it.
 *
 * `exitReason` follows engagement, not the trigger: a peer that never spoke
 * (`idleElapsedMs === null`) exits `no_engagement`; one that spoke exits
 * `idle_budget`. The `reason` string carries the precise trigger.
 *
 * Plan 028 Phase 5b (workshop 003): when `opts.surviveGaps === true` branch (b)
 * is suppressed — a companion expecting work across a long human gap is never
 * stood down on idle alone, only by the (a) backstop. The never-spoke arm is
 * then continued under budget until (a) — the #50 incident, now a fixed
 * behaviour. Everything for `surviveGaps` falsy/unset is byte-for-byte the
 * plan-027 #35 behaviour.
 */
export function evaluateIdlePolicy(
  ledger: CompanionIdleLedger,
  opts: IdlePolicyInput,
): IdlePolicyDecision {
  const { idleBudgetMs, runElapsedMs, timeoutSec, surviveGaps } = opts;
  const neverSpoke = ledger.idleElapsedMs === null;
  const effectiveIdleMs = ledger.idleElapsedMs ?? runElapsedMs;
  const timeoutMs = timeoutSec * 1000;
  const exitReason: 'idle_budget' | 'no_engagement' = neverSpoke
    ? 'no_engagement'
    : 'idle_budget';

  // (a) Absolute backstop — fires regardless of outstanding work.
  if (runElapsedMs >= timeoutMs) {
    return {
      standDown: true,
      exitReason,
      reason: `run elapsed ${runElapsedMs}ms reached the absolute timeout ceiling ${timeoutMs}ms (${timeoutSec}s)`,
    };
  }

  // Work still outstanding under the backstop — keep going.
  if (ledger.unresolvedPeerRequests > 0) {
    return {
      standDown: false,
      exitReason: null,
      reason: `${ledger.unresolvedPeerRequests} unresolved peer request(s) — work outstanding, continue`,
    };
  }

  // (b) Nothing outstanding and idle past the budget — stand down.
  //     Suppressed under survive-gaps (workshop 003): a companion EXPECTING work
  //     across a long human gap must not be stood down on idle alone — only the
  //     (a) wall-clock backstop above terminates it.
  if (!surviveGaps && effectiveIdleMs >= idleBudgetMs) {
    return {
      standDown: true,
      exitReason,
      reason: neverSpoke
        ? `no inbound since boot; idle ${effectiveIdleMs}ms >= budget ${idleBudgetMs}ms`
        : `idle ${effectiveIdleMs}ms since last inbound >= budget ${idleBudgetMs}ms`,
    };
  }

  // Under budget (or survive-gaps suppressing the budget), nothing outstanding
  // — keep going.
  return {
    standDown: false,
    exitReason: null,
    reason:
      surviveGaps && effectiveIdleMs >= idleBudgetMs
        ? `survive-gaps: idle ${effectiveIdleMs}ms >= budget ${idleBudgetMs}ms but expecting work — continue until the wall-clock backstop`
        : `idle ${effectiveIdleMs}ms < budget ${idleBudgetMs}ms — continue`,
  };
}
