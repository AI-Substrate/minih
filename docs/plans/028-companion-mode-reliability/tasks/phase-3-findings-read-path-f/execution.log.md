# Execution Log — Phase 3: Findings read-path (F)

**Plan**: [companion-mode-reliability-plan.md](../../companion-mode-reliability-plan.md) · **Mode**: Full TDD · **Companion**: `code-review-companion` (live, Power-On)
**Defect**: #50 **F** — inside-lane findings invisible to the documented operator read-path.

---

## T000 — Harness pre-flight (pre-implement seam)

- Router (`/eng-harness-flow --event pre-implement`): minih adoption holds (CLI 0.3.0, governance doc `.harness/engineering-harness.md`, `test` boot recipe, active retro records) → engineering zone → **boot validation**.
- Boot = `npm run build` (tsc + copy-schemas): **healthy** — clean in ~1.4s; `dist/` rebuilt (dual-purpose: also the prerequisite for the RED integration test, which runs against `dist/cli/index.js`).
- Advisory flag: `harness doctor` = `degraded` on a non-CLI layer (expected for a consumer repo; `cli-build` ok). Not blocking.
- **Companion**: `code-review-companion` booted (runId `2026-06-16T07-24-05-445Z-061c`, verdict `active`, polling); briefed once (type=briefing) with the phase, the reuse API (`deriveCompanionLedger().findings` + `buildDraftFarewell`), and the three validation hazards (vacuous seed, summary surface, additive-only).

## T001 — RED — `test/cli/companion-findings.test.ts`

- Created `test/cli/companion-findings.test.ts`, cloning the `companion-status.test.ts` subprocess-vs-`dist/` harness (`run()`, `append()`, `seedRun()`).
- **Avoided the vacuous-seed trap** (validate-v2 MED): the seed is a *parseable* HIGH finding in the **inside** lane via a labelled body (`severity: HIGH\nfile: …\ncategory: …\nissue: …\nrecommendation: …`), so `toFinding` keeps it. Also seeds a completion `summary` (ackOf the task) so `summariesCount ≥ 1`.
- 4 cases: (1) HIGH finding + summary surface — asserts `command==="companion.findings"`, `status==="ok"`, `findings[0].severity==="HIGH"`, `summariesCount>=1`, `draftFarewell.summary` non-empty; (2) defaults to newest run; (3) `RUN_NOT_FOUND (E171)`; (4) `INBOX_CORRUPT (E148)` on a torn inside-lane line.
- **Evidence (RED)**: `npx vitest run test/cli/companion-findings.test.ts` → **4 failed / 4** — each fails because no `findings` subcommand exists (commander errors on the unknown subcommand → empty stdout → `JSON.parse` throws). Fails for the right reason.
