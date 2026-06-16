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

_In progress._
