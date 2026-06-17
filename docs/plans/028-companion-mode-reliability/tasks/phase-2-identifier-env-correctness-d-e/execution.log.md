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

## Companion review — findings reconciliation

The live `code-review-companion` reviewed all three commits (per-commit summaries: T001/T002 **APPROVE_WITH_NOTES**, T003/T004 **REQUEST_CHANGES**, T005/T006 **APPROVE**) and sent 2 findings + a drain CONCERNS summary:

| ID | Sev | File | Issue | Disposition |
|----|-----|------|-------|-------------|
| F001 | MEDIUM | `test/runner/folder.test.ts` | New UTC test restored an originally-unset `TZ` by assigning `undefined` → `TZ="undefined"`, leaking a mutated env to later tests in the worker. | **Fixed** `a143ec4` — explicit `delete` branch. |
| F002 | HIGH | `src/runner/folder.ts` + sweep | Sort migration **incomplete**: `findRunSession()` (session-resume latest, delegated to by `run-resolver`) + other default/latest surfaces (`coordination.ts:226`, `harvest.ts:108`, `validate.ts:73`, `--latest` active-candidate sorts in `status/tail/view/connect`, `listRunDirs`) still sort by folder name/runId — a stale old-local-`Z` folder can still win during the mixed window. | **Central fixed** `a143ec4` — `findRunSession` routed through `sortRunIdsNewestFirst` + regression. **Broader sweep surfaced to the human as a scope decision** (beyond the validated 4-selector dossier). |

This is the dogfooding payoff: validate-v2 caught `companion latestRunId` (a 4th selector); the live companion caught `findRunSession` (a 5th, more central) **and** a ~7-surface sweep that static validation missed.

**Human decision: "fix them all now."** The full sweep landed in `e163ba1`:
- `listActiveRunCandidates` (run-resolver) now returns candidates newest-first by `startedAt`; the four `--latest` active-run tie-breaks (`status`/`view`/`connect`/`tail`) drop their redundant runId re-sort and trust the source order.
- `coordination`, `harvest`, `validate` route through the shared `sortRunIdsNewestFirst`.
- New regression: `listActiveRunCandidates` ordering (run-resolver.test.ts).
- **Defect D now closes across all ~11 latest/default run selectors.**

**Companion debrief**: the `code-review-companion` run ended on its own (idle timeout → `completed`, `result: degraded` only because its farewell `findings[]` used `file` instead of an `id` field — a companion-output schema nit, not a code issue). Farewell verdict matched: approved UTC runId + MINIH_PROJECT_ROOT, flagged+saw-fixed the TZ test issue and the `findRunSession` HIGH, left the sweep as a scope decision. magicWand → captured as MW-001.

**Phase-end harness seam**: drained 4 observations → `.harness/records/retro/2026-06-16/002-028-companion-mode-reliability-phase-2.md` (INS-001 encoded by `8f850ba`; INS-002 companion-caught-the-gap; MW-001 run-selector audit-fixture; DL-001 scope-completeness lesson).

## Phase 2 — COMPLETE

8 tasks (T000–T0z) + the companion sweep. **Full suite 1404 pass / 16 skip / 0 fail; tsc clean.** Commits: `8f850ba` (D UTC runId), `4f5164c` (D 4-selector sort), `d9d336e` (E project-root), `72609ee` (docs), `a143ec4` (F001/F002-central), `e163ba1` (F002 sweep). Defects D + E closed; defect D's sort migration complete across all ~11 selectors.

## T005 — RED (E) / T006 — GREEN (E): MINIH_PROJECT_ROOT = resolved git root

- **T005 RED** (`test/runner/runner.test.ts`): fake repo with `.git`, `config.cwd` = a deep run-dir-like subdir; capture `process.env.MINIH_PROJECT_ROOT` via `onEvent`; assert it equals `realpath(repoRoot)`. RED confirmed (captured the run-dir cwd, not the git root).
- **T006 GREEN** (`src/runner/runner.ts:631`): `MINIH_PROJECT_ROOT = resolveDefaultAllowedRoots(config.cwd ?? process.cwd()).roots[0]` (imported from `./permissions/index.js`). GREEN; env regression suite still green.
- Verify (concrete): no reader assumes depth/child-of-cwd — `inspect.ts:206` computes its OWN repoRoot (doesn't read the env var); `shared-preamble.md` only documents it; no `path.relative`/`path.resolve` against it. fs-guard permission boundaries unchanged (child re-derives roots from cwd).
- Commit pending in this batch.

## T004 — GREEN (D): startedAt-primary sort across all selectors

- New shared helpers in `src/runner/folder.ts` (exported via `runner/index.ts`): `runStartedAt(runDir)` (run.json → completed.json → null) and `sortRunIdsNewestFirst(runsDir, runIds)` (startedAt-primary, folder-name tie-break/fallback).
- Wired the three name-sorters to the helper: `last-run.ts`, `history.ts`, `companion.ts latestRunId`. `run-inventory.ts compareRows` left as-is (already correct — confirmed by the guard).
- **GREEN**: 3 cli sort tests pass; affected suites (folder + run-inventory + companion-status + new sort test) = **75 passed / 0 failed**; tsc + dist build clean. Existing companion-status test still green (no-run.json fixture falls back to name-sort).
- Anti-reinvention: one helper, three call sites — no duplicated read/sort logic.
