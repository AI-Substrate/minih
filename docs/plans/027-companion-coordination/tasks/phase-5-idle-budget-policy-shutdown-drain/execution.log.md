# Execution Log — Phase 5: Idle-budget policy + shutdown drain (#35)

**Plan**: [companion-coordination-plan.md](../../companion-coordination-plan.md) · **Mode**: Full (Full TDD) · **Companion**: `code-review-companion`
**Started**: 2026-06-15

---

## T000 — Pre-implement harness seam (`--event pre-implement`)

**Router**: installed (`~/.agents/skills/eng-harness-flow`). Adoption holds — `harness doctor status: ok` (5 layers green), governance present (`.harness/engineering-harness.md`), `boot` extension verb present. S0+S2+S4 satisfied → engineering zone; seam routed to boot validation.

**Boot verdict**: first run `error` (lint) → diagnosed as a cosmetic biome-format drift in `the-flow.json` (the guided-mode flight-plan JSON written last session; unformatted `artifacts` array) — **not** code. Boot was doing its job catching uncommitted format drift. Disposition: **Retry** after `npx biome format --write the-flow.json`. Re-boot: **degraded** (lint pass · typecheck pass · build+test pass · minih-doctor **warn** · audit **warn**). Both warns pre-existing & non-blocking (npm audit dep CVEs 1 critical/6 high; doctor prompt-state-vocabulary-drift warning expected per Phase 3). Treated `degraded` as SLOW → proceed with note.

**Friction candidate (for retro)**: boot's lint sensor flags `docs/plans/**/the-flow.json` format drift; guided-mode writes that file unformatted → recurring boot noise. Encoding idea: have the-flow's JSON writer run biome-format on write, or exclude `docs/plans/**/*.json` from the boot lint sensor.

---

## T001 — `evaluateIdlePolicy` (pure) · AC-11 ✅

**Approach**: Full TDD. RED test (`test/runner/idle-policy.test.ts`) written first → failed with `Cannot find module idle-policy.js`. GREEN: new pure `src/runner/idle-policy.ts`; barrel-exported from `index.ts` (runtime + types). **8/8 pass**, `tsc --noEmit` clean.

**Design** (grounds in PIC-P5-A + the four AC-11 discriminators):
- Signature `evaluateIdlePolicy(ledger, { idleBudgetMs, runElapsedMs, timeoutSec, now? })` → `{ standDown, exitReason: 'idle_budget'|'no_engagement'|null, reason }`.
- Reads exactly two ledger fields (`idleElapsedMs`, `unresolvedPeerRequests`) — typed as `Pick<CompanionLedger, …>` so the coupling is explicit and can't silently widen.
- `effectiveIdleMs = idleElapsedMs ?? runElapsedMs` (never-spoke ⇒ idle since boot — the A1 fix; the ledger has no wall-clock for a peer that never sent).
- Decision order: **(a)** absolute backstop `runElapsedMs >= timeoutSec*1000` (overrides outstanding work) → stand down; **(b)** `unresolvedPeerRequests > 0` under backstop → continue; **(c)** `effectiveIdleMs >= idleBudgetMs` → stand down; else continue.
- `exitReason` follows engagement (never-spoke → `no_engagement`, spoke → `idle_budget`) — both already in the prompt's exit vocab (`prompt.md:96/98`); the `reason` string carries the precise trigger.

**Evidence**: 4 named discriminators (i unacked-past-budget→continue, ii idle-past-budget→idle_budget, iii never-spoke-past-budget→no_engagement [fails an idle-only impl], iv backstop→stand-down-regardless) + 3 edges. The dossier's headline claim verified: **no runner-side idle logic existed before** — this is the first.

**Files**: `src/runner/idle-policy.ts` (NEW), `src/runner/index.ts` (barrel), `test/runner/idle-policy.test.ts` (NEW).

---

## T002 — Idle budget discoverable (A2 plumbing) · AC-12 ✅

**The A2 trap (confirmed in code)**: `MINIH_PARAMS` is set on the *runner's* env (`runner.ts:627`) but `spawn.ts` forwards only `MINIH_CONTEXT/INBOX_DIR/STATE_DIR` + `MINIH_MCP_*` to the inside-MCP subprocess — so the tool can't read params from env. Also confirmed: `validateInput` is a pure validator (no default-fill), so `config.params` does not carry the schema default. So this was **real plumbing**, exactly as the dossier rescoped.

**Approach (A2-preferred — disk, not env; mcp→runner delegation)**:
- `DEFAULT_IDLE_BUDGET_MS = 1_800_000` in `types.ts` (documented mirror of input-schema `idleBudgetMs.default`).
- `budgets.idleBudgetMs?` added to `LiveRunManifest`; recorded at run start **only for coordination runs** (`runner.ts:432`, `coordinationEnabled && { idleBudgetMs: params.idleBudgetMs ?? DEFAULT }`).
- `readIdleBudgetMs(runDir)` — **sync** reader in `run-manifest.ts` (named `readFileSync` import; the async `readManifest` would force the sync tool async). Absent/torn/pre-#35 run.json → schema default.
- `coordination_status` surfaces `idleBudgetSec = round(readIdleBudgetMs(runDir)/1000)` — the Phase-6 trio name, ms→sec at the surface (no later rename). Tool stays synchronous; delegates the disk read to the runner (clean mcp→runner direction).

**Evidence (AC-12 non-default discriminator)**: run.json with `idleBudgetMs: 120000` → tool returns `idleBudgetSec === 120` (a stub returning the 1800 default fails this); absent/no-budget → `1800`. 3 new tests; existing 2 unaffected (torn-lane still throws before the budget read). `tsc` clean; run-manifest 12/12 unaffected.

**Files**: `src/runner/types.ts`, `src/runner/runner.ts`, `src/runner/run-manifest.ts`, `src/runner/index.ts` (barrel), `src/mcp/tools/coordination-status.ts`, `test/mcp/coordination-status.test.ts`.

---

## T003 — `drainAndReadInbox` + report reconcile · AC-13 ✅

**Two functions in a NEW pure-ish `src/runner/coordination-drain.ts`** (imports only companion-ledger + folder type + node:fs — no SDK/MCP/CLI):
- `drainAndReadInbox(location, { now? }): CompanionLedger | null` — re-derives via `deriveCompanionLedger` over the RAW lanes (NOT `listUnackedVisible`, foreclosed — PIC-P5-B). Torn lane (`CompanionLedgerError`) → returns **null** (tolerate, PIC-P5-G), never throws.
- `reconcileReportFindings(reportPath, ledger): boolean` — overwrites **ONLY** `report.findings[]` via `buildDraftFarewell(ledger).findings` (validate-before-write, PIC-P5-D/F), preserving the agent's `summary`/`retrospective`. Absent/unparseable/non-object report → return false + skip (never fabricate into the raw-string fallback).

**Runner wiring** (`runner.ts`): inserted into the existing `if (agentSucceeded && coordinationEnabled && agentsDir)` block, **AFTER** the final `inboxForwarder.commit()` (line 1296, inside the resolved run promise) and **BEFORE** `snapshotCoordinationFiles` — and before `validateSystemOutput` re-checks the report. Symbol-anchored (not digits — the file shifts; validators flagged this). Whole block best-effort: a drain hiccup never fails an otherwise-successful run.

**Evidence (AC-13 ordering discriminator — A5)**: a finding appended to the inside lane **after** the report is authored (empty findings) is captured by the re-derive → lands in `report.findings[]`; summary/retrospective preserved verbatim. A drain that read at author-time (or after report-write) would miss it. Plus torn-lane→null (no throw, report untouched), absent-report→skip, unparseable-report→skip (raw fallback left intact). 4 tests; `tsc` clean; companion-ledger 16/16 + coordination-status 5/5 unaffected.

**Files**: `src/runner/coordination-drain.ts` (NEW), `src/runner/runner.ts`, `src/runner/index.ts` (barrel), `test/runner/coordination-drain.test.ts` (NEW).

---

## T004 — Rewrite `prompt.md` idle wording → ledger-driven ✅

**§2 Coordination Loop rewritten** from integer poll-streak (`emptyPollStreak`/`sentCheckInThisStreak`/`checkInPollIndex`/`replyWaitPolls`, *"no clock arithmetic — only integer counters"*) to **ledger-driven**: each empty poll consults `coordination_status` for `{ ledger.idleElapsedMs, ledger.unresolvedPeerRequests, idleBudgetSec }` and applies the same decision as `evaluateIdlePolicy` (T001):
1. `unresolvedPeerRequests > 0` → continue (work outstanding).
2. **`idleElapsedMs === null`** (never spoke) → **do NOT self-exit**; courtesy "still-needed?" once; the runner's absolute run-timeout backstop ends it (`no_engagement`). **This is the A6 first-contact pin** — null is distinct from 0; the prompt has no run-elapsed clock so it must not stand down a never-spoke peer except via the backstop.
3. `idleElapsedMs >= idleBudgetSec*1000` → FAREWELL `idle_budget`.
4. post-task courtesy check-in once (under budget).

Loop state reduced to `awaitingFirstContact` / `hasCompletedTask` / `askedCheckIn` / `lastTaskId`. Stop precedence + exit vocab (`stop_requested`/`no_engagement`/`idle_budget`) preserved. The courtesy check-in (`firstContact`/`postTaskPollThreshold`) is now explicitly a UX nicety, not the exit mechanism.

**Evidence (Done-When)**: no orphaned `emptyPollStreak`/`sentCheckInThisStreak`/`checkInPollIndex`/`replyWaitPolls` refs; state words stay within `[idle…stopping]`; **`minih doctor` `prompt-state-vocabulary-drift: pass`** for `code-review-companion`; 0 doctor errors (degraded = pre-existing warnings only). The `coordination_status` result shape consumed (`s.ledger.idleElapsedMs`, `s.ledger.unresolvedPeerRequests`, `s.idleBudgetSec`) matches T002's tool exactly.

**Files**: `agents/code-review-companion/prompt.md`.

**Blast radius (caught by `just fft`)**: the plan-019 `test/agents/code-review-companion-checkin.test.ts` characterization suite asserted the old poll-streak wording (7 assertions). Updated to the ledger-driven design (assert `coordination_status`/`idleElapsedMs`/`unresolvedPeerRequests`/`idleBudgetSec`, the `askedCheckIn` latch, the `idleElapsedMs == null` first-contact pin, and the new boot vars; drop `emptyPollStreak`/`sentCheckInThisStreak`/`replyWaitPolls`). 29/29 green.

---

## T005 — Runner domain.md touch-up ✅

Added to `docs/domains/runner/domain.md`: § Composition rows for `idle-policy.ts` + `coordination-drain.ts`; two § Concepts entries (Ledger-driven idle policy, Shutdown/report-write drain); one § History row (027 P5 #35). Light touch — full registry-wide reconciliation is Phase 6 (AC-16).

**Files**: `docs/domains/runner/domain.md`.

---

## ⚠️ Discovery (design gap → Phase 6 / follow-up candidate)

**`evaluateIdlePolicy` is implemented + unit-tested but NOT wired into the runner's run loop.** The companion's *actual* stand-down is **prompt-driven** (it consults `coordination_status` and mirrors the policy). Consequence of the A6 pin: a peer that **never spoke** (`idleElapsedMs === null`) no longer self-exits `no_engagement` in the prompt — the prompt has no run-elapsed clock, so it relies on the runner's absolute run-timeout backstop, whose actual exit reason is `timeout`, not the graceful `no_engagement` that plan-019 introduced. `evaluateIdlePolicy` (which *does* take `runElapsedMs` and returns `no_engagement` at budget) is therefore a tested-but-unwired oracle.

**Why it's acceptable for Phase 5**: AC-11 asks for a ledger-driven, unit-testable idle policy — delivered (the pure fn + the prompt mirror). The live agent-behaviour proof was always dogfood (Phase 0 fake-adapter dropped). **Phase-6 / follow-up candidate**: wire `evaluateIdlePolicy` into the runner's terminal/watchdog path (the runner *has* `runElapsedMs` + can derive the ledger) so a never-spoke companion is gracefully stood down with `no_engagement` instead of a hard `timeout`. Flagged in the final report for Jordan's call.

---

## Companion debrief (`code-review-companion`, run `2026-06-15T16-16-17-919Z-f932`)

**Correction**: an earlier mid-phase read concluded the companion "never engaged" — that was WRONG (the `minih status` `lastPollAt` field mis-derived as null even while it polled). The companion was **fully engaged**: it oriented, acked every message, sent `APPROVE: T001`, `APPROVE_WITH_NOTES: T002/T003/T004`, processed the drain ping, **honoured `control:stop`** (farewell `exitReason: stop_requested`), and exited `completed`. `coordination` retro: `peerUpdatesSent: 10`, `unresolvedPeerRequests: 0`. A real second pair of eyes.

**3 MEDIUM findings — all reconciled in the fix-pass:**

| ID | Finding | Disposition |
|----|---------|-------------|
| F001 | `DEFAULT_IDLE_BUDGET_MS` mirrors the input-schema default with no test pinning them → silent drift risk. | **FIXED** — new test in `code-review-companion-checkin.test.ts` asserts `DEFAULT_IDLE_BUDGET_MS === schema.idleBudgetMs.default`. |
| F002 | Shutdown-drain skip/torn-lane paths tolerated but **silent** (dossier said "log + skip"). | **FIXED** — `reconcileReportFindings` returns `{wrote, reason}` (unit-tested); runner emits a non-fatal `stderr.log` diagnostic for the torn-lane + `draft-invalid` cases (expected `report-absent`/`report-unparseable` stay quiet to avoid noise). Snapshot test extended: torn lane → still `completed` AND observable. |
| F003 | prompt repurposed `firstContact`/`postTaskPollThreshold` as boolean flags while input-schema still called them numeric poll counts → contract drift. | **FIXED** — input-schema descriptions updated to the deliberate ledger-driven semantics (enable-flags); `replyWaitPolls` marked DEPRECATED. |

**Companion magicWand** (`magicWandTarget: coordination`): *"Add a companion finalize command/tool that takes the coordination_status draft, lets the agent provide only summary and retrospective text, writes the validated report, and runs minih check automatically."* → captured as a follow-up candidate (would simplify the farewell-write path; relates to the unwired-`evaluateIdlePolicy` gap below).

**On-theme footnote**: while booting, the companion itself looked (to a buggy status read) like the "never-engaged" case — exactly what Phase 5's idle policy is built to terminate gracefully. The `evaluateIdlePolicy`-unwired gap below is the same theme from the runner side.

---

## ✅ Phase 5 complete

All 6 tasks done (T000 seam · T001 evaluateIdlePolicy · T002 idleBudgetSec · T003 drain · T004 prompt · T005 domain doc) + companion fix-pass (F001/F002/F003).

**Acceptance criteria:**
- **AC-11** ✅ idle/stand-down is ledger-driven + unit-testable (`evaluateIdlePolicy`, 8 discriminating tests; prompt mirrors it).
- **AC-12** ✅ configured idle budget discoverable at runtime (`coordination_status.idleBudgetSec`, non-default discriminator test).
- **AC-13** ✅ late shutdown-window message captured (`drainAndReadInbox` + overwrite-only-findings, ordering discriminator test).
- **AC-17** ✅ `just fft` exits 0 — 1376 passed / 16 skipped / 0 failed; tsc clean; doctor drift `pass`.

**New tests this phase:** idle-policy 8, coordination-drain 4, coordination-status +3, checkin-suite ledger-driven rewrite + F001 drift test, run-folder-snapshot torn-lane observability. Companion (real `code-review-companion`) reviewed every commit; 3 MEDIUMs all reconciled.

**Carried forward (Phase-6 / follow-up candidates):**
1. **Wire `evaluateIdlePolicy` into the runner loop** — it's tested but unwired; a never-spoke peer currently exits via the run-timeout backstop (`timeout`) rather than a graceful `no_engagement`. The runner has `runElapsedMs` + can derive the ledger, so it could call the policy and stand the companion down gracefully.
2. Companion magicWand: a `companion finalize` tool/command for the farewell-write path.

**Commits:** a1e49af (T001) · de9cd16 (T002) · 65ae2d5 (T003) · 538c65e (T004) · 2c7bdb3 (T005+test) · fix-pass (F001/F002/F003).
