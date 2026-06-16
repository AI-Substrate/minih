# Phase 4 — Terminal classification (G) · Execution Log

**Plan**: [companion-mode-reliability-plan.md](../../companion-mode-reliability-plan.md) · **Mode**: Full · **Phase**: 4 of 5
**Verb**: `implement --companion` · **Started**: 2026-06-16

---

## T000 — Pre-implement harness seam

Fired `/eng-harness-flow --event pre-implement --phase "Phase 4: Terminal classification (G)" --plan-dir docs/plans/028-companion-mode-reliability --json`. Router routed to a boot validation (`harness boot --json`).

- **First boot verdict: `error`** — narrated verbatim. Cause was the **lint sensor only** (`npx biome check .` → 2 errors: `organizeImports` at `runner.ts:14` + a formatter nit). `typecheck`, `build+test` both **pass** (suite green); `minih-doctor` + `audit` were pre-existing `warn`.
- The lint debt was **pre-existing** (no source files dirty at phase start). Per the implement verb, an `error`/UNHEALTHY boot is a stop-and-ask. **User chose: fix the pre-existing lint first.**
- **Lint cleanup** (commit `19f8370`, scoped to the two source files): `biome check --write` sorted the `runner.ts` import; the 4 `noNonNullAssertion` warnings in `coordination-drain.test.ts` were suppressed with house-style `biome-ignore` reasons (matching the existing suppression at line 176). Edited test re-run: 4/4 pass. `biome check .` clean tree-wide.
- **Re-boot verdict: `degraded`** — the repo's honest baseline (lint ✓, typecheck ✓, build+test ✓; `minih-doctor` + `audit` warn remain — audit advisories tracked as #13). Governance doc treats `degraded` as workable-with-awareness → **proceed to tasks.**

## C0 — Companion boot (`--companion`)

No active `code-review-companion` run found → booted one (`GH_TOKEN` exported, detached). Briefing + per-task review-request pings follow the companion protocol; findings reconciled at the phase-end debrief.

---

## Per-task log

<!-- appended as each task lands -->

### T001/T002 — degraded → manifest.status:'completed' (commit `20ebba4`)

- **RED**: new `test/runner/runner-terminal.test.ts` drives a degraded run (system-valid output that fails the user schema) via `FakeAgentAdapter`; asserts `run.json.status === 'completed'`. Failed today (`'failed'`).
- **GREEN**: widened the final manifest-status map at `runner.ts:1597-1598` to `resultStatus === 'completed' || resultStatus === 'degraded' ? 'completed' : 'failed'`. `completed.json.result` (1547) unchanged — still records the honest `degraded`.
- **Decision (Workshop Q1, locked)**: the velocity guard at `runner.ts:~1535` is **not** widened — it stays `!isResume && resultStatus === 'completed'`, so a degraded run still skips velocity. `measurement` domain untouched. Verdict ✓.
- Evidence: T001 test 1/1 pass; `biome check` clean on both files. Companion pinged (`review-request: T001/T002`).

### T004 — spike: where does the "farewell-observed" signal come from? (recorded before coding)

Grep confirmed **no** `farewell`/`farewellAt`/`cleanStop` reference in `runner.ts`/`reconcile.ts`; the only `farewell` artifacts are `companion-ledger.ts`'s `buildDraftFarewell` (a *draft* stub the companion overwrites — **not** proof a farewell was sent) and `output/report.json` (the agent's final report, read by `minih inside retro`). Decision:

- **Signal**: `cleanStop?: boolean` + `farewellAt?: number` (Unix ms) on `LiveRunManifest`.
- **Sourced from (candidate b, runner-side)**: a **clean result** (`resultStatus ∈ {completed, degraded}`) is the observable "the agent reached a clean farewell." The runner writes `cleanStop:true`+`farewellAt` in the final manifest patch (`runner.ts:1597`) where `resultStatus` is known — **no** new MCP producer, **no** cross-domain edit (honours the plan's Non-Goals + Finding 06 runner-only scope).
- **Lifecycle (honest limit)**: the `'completing'` transition at `runner.ts:1300` happens *before* `resultStatus` is known, so the marker can't be written there. In the normal clean path the runner also writes `completed.json`, so reconcile skips the run anyway (terminal) — `cleanStop` is corroborating metadata there. Its reconcile-**honouring** value is realized when (i) a clean run is killed in the window between the manifest patch and `completed.json`, and (ii) a **future external producer** (#49's idle stand-down, a `minih stop`) writes a clean `terminalReason` on a still-`PROBE` manifest. The **durable contract this phase lands** is: *reconcile honours a clean-stop marker* — which is what unblocks #49 and a future `minih stop`. The full operator/idle producers stay follow-up (Non-Goals, T007).
- **Reconcile honouring**: a dead-pid `PROBE`-status manifest with `cleanStop === true` OR a clean `terminalReason` (`operator-stop`/`idle-budget`/`no-engagement`) reconciles to `status:'completed'` (not `crashed`+`pid-vanished`).

### T003/T004 — farewell/cleanStop sourced + honoured (commit `cdc8f0c`)

- **RED**: 3 tests in `runner-terminal.test.ts` — (a) a dead-pid run seeded with `cleanStop:true` must reconcile to `completed`; (b) a clean run must record `cleanStop`+`farewellAt`; plus (c) a crash regression guard (no marker → still `crashed`+`pid-vanished`). (a) and (b) failed today.
- **GREEN**:
  - `types.ts`: `cleanStop?: boolean` + `farewellAt?: number` on `LiveRunManifest` (after the `terminalReason` union).
  - `runner.ts:1597`: a clean terminal (`completed`/`degraded`) stamps `cleanStop:true` + `farewellAt: completedAt.getTime()` in the final patch.
  - `reconcile.ts`: `CLEAN_REASONS` set + new `reconciledClean[]` report bucket; a dead-pid PROBE manifest with `cleanStop===true` OR a clean `terminalReason` → `status:'completed'` (preserve reason), else the existing crashed+pid-vanished; `readJsonTolerant` passes `cleanStop` through.
  - `cli/commands/reconcile.ts`: surfaces `reconciledClean` (TTY ✓-line + JSON `reconciledClean`/`reconciledCleanCount`).
- Evidence: 4/4 Phase-4 tests pass; reconcile.test.ts + runner.test.ts unaffected (32/32 across the three files); `tsc --noEmit` clean; no other `ReconcileReport` constructor to update. Companion pinged.
- **Honest limit recorded**: this lands the *contract* (reconcile honours a clean stop) + the runner-side clean producer; the operator-stop (`minih stop`) and idle (#49) producers stay follow-up (T007 / Finding 09).

### T005/T006 — terminalReason union + de-redded render (commit `21cc8d8`)

- **RED**: predicate test (`isCleanTerminalReason` classifies the 3 clean reasons vs failures) + a forced-ANSI render test (`styleTerminalReason` is dim for clean, red for failures). Both failed (functions absent).
- **GREEN**:
  - `types.ts`: union extended with `operator-stop`/`idle-budget`/`no-engagement`; **single source of truth** `CLEAN_TERMINAL_REASONS` + `isCleanTerminalReason` (so the vocabulary can't drift across consumers — pre-empts the DL-002-style triplication Phase 1 warned about).
  - `runner/index.ts`: value-export the set + predicate.
  - `reconcile.ts`: consume the canonical predicate (dropped the local `CLEAN_REASONS` added in T004).
  - `status.ts`: `styleTerminalReason()` renders clean reasons dim, only failures red (was unconditional `chalk.red`).
  - `probe/aggregator.ts`: **confirmed tolerant, no change** — only special-cases `permission-denied`; clean reasons pass through. The `status`-switching if-chains (`run-inventory`/`run-resolver`/`human-view-model`) branch on `manifest.status` (reuses `completed`) — no change (Finding 06).
- Evidence: tsc clean; 14 tests across terminal + reconcile pass. Companion pinged.

### T007 — operator-stop reconcile (commit pending with T008)

- **GREEN (test)**: a hand-written `terminalReason:'operator-stop'` marker on a dead-pid `idle` run reconciles to `completed`, reason **preserved** (not overwritten to `pid-vanished`), landing in `reconciledClean`. Passes on the T004/T006 honouring (shared path) — no new production code. The `minih stop` **producer** stays out of scope (Non-Goal; recorded in the plan's § Related/Deferred).

### T008 — 028 ↔ #49 boundary + reason-spelling map (commit pending with T007)

- **Tests**: (a) the 3 clean reasons are **recordable** on a manifest and round-trip; (b) the spelling map — `idle_budget`→`idle-budget`, `no_engagement`→`no-engagement` (underscore→hyphen) — holds and the hyphen forms are clean. **No test asserts the runner triggers an idle stand-down** (Finding 09; that arm is #49 / Phase 5 task 5.5).
- **Doc**: boundary + spelling map written to the plan's **§ Related / Deferred** (verified `idle-policy.ts:40,70` emit underscore; the union uses hyphen, consistent with `pid-vanished`/`stalled-stream`). #49 maps `exitReason → terminalReason`; a survive-gaps stand-down then records a clean reason `reconcile` already honours.
