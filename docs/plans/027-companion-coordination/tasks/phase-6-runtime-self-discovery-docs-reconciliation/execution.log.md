# Phase 6 — Execution Log

**Plan**: companion-coordination-plan.md · **Phase**: 6 of 6 (final) · **Mode**: Full
**Companion**: `code-review-companion` (`--companion`, Power-On-Mode)
**Started**: 2026-06-15

---

## T6.0 — Pre-implement harness seam (`--event pre-implement`)

- Router **INSTALLED**. Fired `/eng-harness-flow --event pre-implement --phase "Phase 6: …" --plan-dir docs/plans/027-companion-coordination --json`.
- Adoption gate holds — S0 install ✓, S2 governance ✓ (`.harness/engineering-harness.md`), S4 boot ✓ → **engineering zone**. Boot command (governance-declared) = `harness boot --json`.
- **First boot: UNHEALTHY** (`status: error`, `boot failed: lint`). Sole blocker = `biome check .` 1 error: a formatter diff in `docs/plans/027-companion-coordination/the-flow.json` (the flight-plan JSON written the prior turn — an `"artifacts"` array biome wanted multi-line). typecheck ✓, build+test (`just check`) ✓, minih-doctor warn (**errors: 0**), audit warn (1 critical / 6 high CVEs → Dependabot, task #13).
- UNHEALTHY → surfaced to human per protocol. **Decision: "Fix lint, then build."**
- Remediation: `npx biome format --write docs/plans/027-companion-coordination/the-flow.json` → fixed 1 file. `biome check .` now exits **0** (4 non-failing `noNonNullAssertion` *warnings* remain in `test/runner/coordination-drain.test.ts` — pre-existing Phase-5, non-blocking).
- **Re-boot: degraded** — lint ✓ · typecheck ✓ · build+test ✓ · minih-doctor warn · audit warn (no errors). **Proceed.**

---

## T001–T003 — Self-discovery trio: `allowedStates` on `coordination_status` (AC-14)

RED→GREEN, committed as one unit (the RED test → resolver extraction → GREEN are intertwined).

- **T001 (RED)**: extended `test/mcp/coordination-status.test.ts` with a `self-discovery trio (AC-14)` describe — seeds a per-pack `inside-state.schema.json` at the agent **ROOT** (PIC-1) and asserts `allowedStates` = the 6-value enum *together with* `coordinationMode` + `idleBudgetSec`; plus a fallback case (unparseable schema → `[]`). Confirmed RED: 2 failed (`allowedStates` undefined), 5 existing passed.
- **T002**: extracted the 3-level resolver `insideStateSchemaPath(context)` + `DEFAULT_INSIDE_STATE_SCHEMA` **verbatim** from `state.ts` into a new shared **mcp-internal** module `src/mcp/tools/inside-state-schema.ts`. `state.ts` re-imports `insideStateSchemaPath` (removed the now-dead `node:url` + `node:path` imports). New `test/mcp/inside-state-schema.test.ts` pins the preferred(`state/`)→legacy(root)→default order — the root level is load-bearing (PIC-1).
- **T003 (GREEN)**: added `allowedStates: string[]` to `CoordinationStatusResult` + a robust `resolveAllowedStates(context)` helper (reads `.properties.status.enum` via the T002 resolver; **never throws** → `[]` on any failure). `coordinationMode` left pinned `'enabled' | 'disabled'` (**not** widened). Trio returned in one call.
- **Evidence**: `tsc --noEmit` clean; `vitest run` coordination-status (7) + inside-state-schema (3) + state (11) = **21 passed**; biome clean on touched files.
- **Domain**: intra-mcp only (mcp→mcp); doctor keeps its own cli-domain resolver (untouched). PIC-1 root path honored; no `coordinationMode` widening.

---

## T004–T005 — Sensor B: `contract-phrase-drift` doctor check (AC-15 sensor)

RED→GREEN, committed as one unit.

- **T004 (RED)**: new `test/cli/doctor-contract-phrase.test.ts` (mirrors `doctor-state-vocabulary.test.ts` — spawns the built CLI, reads the JSON envelope). A companion-shaped fixture + **3 stale sub-cases** — (1) `output-schema.json` enum drops `no_engagement` while the prompt keeps it; (2) prompt drops the findings-home wording; (3) inside-state description reverts to "not yet enforced" — each → `'fail'`; clean fixture **and the real `code-review-companion` pack** → `'pass'`. Confirmed RED (5 failed — check absent).
- **T005 (GREEN)**: `checkContractPhraseDrift(promptContent, agentDir)` in `doctor.ts`, mirroring `checkPromptStateVocabularyDrift`; pushed into `checks[]` inside `if (coordination.enabled)`. Returns `'fail'` on drift (promoted from `'warning'`), `'pass'` clean, `'skip'` when no contract surface present.
- **Design decision (Discoveries)**: assertion 1 = `no_engagement` **parity** (present in BOTH prompt + enum, or NEITHER) — NOT a blanket "must include", so `demo-companion` (exitReason enum without `no_engagement`, no findings) passes. Assertions 2/3 scoped to the companion's contract shape (findings array / per-pack schema desc). All real coordinated agents pass or skip.
- **Pack reconciliation**: fixed the companion prompt's farewell-envelope **example** (line 282) to include `no_engagement` — internal consistency with its own output-schema enum + prose (the exit-reason contract phrase Sensor B guards).
- **Evidence**: `tsc --noEmit` clean; build OK; `vitest` doctor-contract-phrase (5) + doctor-state-vocabulary (14) = **19 passed**; **`minih doctor` exits 0** on the real tree (T005 done-when ✓). biome clean.
- **Domain**: cli-internal; doctor keeps its own cli resolver (no mcp import — `mcp ↔ cli` illegal). **Tool-count drift is NOT scanned here** (recon row 5) — that is T006/T007 + the doctor pass.

---
