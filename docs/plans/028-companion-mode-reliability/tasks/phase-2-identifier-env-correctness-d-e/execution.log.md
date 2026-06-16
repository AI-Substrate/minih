# Execution Log — Phase 2 (Identifier & env correctness, D/E)

**Plan**: companion-mode-reliability-plan.md (v1.1.1) · **Mode**: Full TDD · **Branch**: `028-companion-mode-reliability`
**Companion**: `code-review-companion` run `2026-06-16T15-58-44-285Z-573c` (Power-On Mode, reviews every commit)

---

## T000 — Harness pre-flight (`--event pre-implement`)

- Router installed (`~/.agents`); minih 0.2.1; gh token available.
- `harness boot --json` → **build+test (`just check`) PASS · typecheck (`tsc --noEmit`) PASS**; lint had 1 error = the recurring `the-flow.json` array-format nit (DL-003) + 4 pre-existing `noNonNullAssertion` warnings in `test/runner/coordination-drain.test.ts` (plan 027).
- Applied the encoded F001 lesson (`just fft` = format-before-lint): `npx biome format --write .` fixed `the-flow.json`; re-check → **0 errors, 4 (pre-existing) warnings**. **Boot verdict: healthy** → proceed.
- **Live defect-D sighting #2** (captured as `harness observe` INS-001): companion booted with runId `2026-06-16T15-58-44-285Z` while real UTC was ~05:58 — local Sydney (UTC+10) mislabeled `Z`. This is exactly what T002 fixes, sighted while building the fix.
- Companion briefed (one-shot `--type briefing`, messageId `01KV7GBBXBSAADD3TP0Y3CTC6K`).

---

## T001 — RED (D): runId encodes true UTC == injected startedAt instant

- Added `test/runner/folder.test.ts` test injecting `now: () => startedAt` under `TZ=Etc/GMT-10` (UTC+10), asserting the runId parses back to `startedAt.getTime()`.
- **RED confirmed**: `expected 1773562150123 to be 1781625878108` — clock not injected + local getters → runId encodes a different instant. ✅ fails as intended.

## T002 — GREEN (D): getUTC* getters + optional `now?` seam

- `src/runner/folder.ts` `createRunFolder` now takes `opts?: { now?: () => Date }` and uses `getUTC*` getters. Existing single-arg caller compiles unchanged.
- **GREEN**: both `createRunFolder` tests pass (new UTC instant + existing shape regex). Format + lint clean on touched files.
- Commit **`8f850ba`** → companion pinged (`review-request: T001/T002 8f850ba`).

## T003 — RED (D): mixed old/new folder chronological sort across all four selectors

- New `test/cli/last-run-history-sort.test.ts` (integration vs dist) seeds a mixed fixture: OLD folder `…13-50…Z` started 03:50 UTC vs NEW `…05-58…Z` started 05:58 UTC — by name OLD sorts first (wrong), by startedAt NEW is newest (right).
- **RED confirmed** for all three name-sorters: `last-run`, `history`, `companion status` each return `13-50` (stale) instead of `05-58`. (Fixed two fixture issues found via the companion's own RED loop: agent-root prompt.md for resolveAgent; `--json` is unknown to last-run/history but printEnvelope emits JSON regardless.)
- `test/runner/run-inventory.test.ts` mixed-folder guard → **GREEN** (compareRows already startedAt-primary — confirm-only holds).
- Finding-01 grep (`Date.parse(...runId)` / `runId.split('T')` / `new Date(...runId)`) → **no functional hit**; no consumer parses a timestamp back out of a name.
- Also considered `run-inventory.ts listRunDirs:308-326` (sorts by runId) — it's a full enumeration for reconcile (order-independent outcome), NOT a newest-run selector; left unchanged.

## T004 — GREEN (D): startedAt-primary sort across all selectors

- New shared helpers in `src/runner/folder.ts` (exported via `runner/index.ts`): `runStartedAt(runDir)` (run.json → completed.json → null) and `sortRunIdsNewestFirst(runsDir, runIds)` (startedAt-primary, folder-name tie-break/fallback).
- Wired the three name-sorters to the helper: `last-run.ts`, `history.ts`, `companion.ts latestRunId`. `run-inventory.ts compareRows` left as-is (already correct — confirmed by the guard).
- **GREEN**: 3 cli sort tests pass; affected suites (folder + run-inventory + companion-status + new sort test) = **75 passed / 0 failed**; tsc + dist build clean. Existing companion-status test still green (no-run.json fixture falls back to name-sort).
- Anti-reinvention: one helper, three call sites — no duplicated read/sort logic.
