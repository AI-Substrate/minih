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
