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
