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
- **Commit**: `0c23f07` (RED); companion pinged (`review-request: T001`).

## T002 — GREEN — `findings <slug>` subcommand

- Added `companion.command('findings <slug>')` to `src/cli/commands/companion.ts`, mirroring the sibling `status` action verbatim: same `--run`/`--json` options, `runId = opts.run ?? latestRunId(...)`, the two `RUN_NOT_FOUND` guards (no run / missing dir), `deriveCompanionLedger(location)` in a `try/catch` mapping `CompanionLedgerError → INBOX_CORRUPT`.
- **Pinned emit shape** (validate-v2 HIGH): `formatSuccess('companion.findings', { slug, runId, findings: ledger.findings, summariesCount: ledger.summariesCount, draftFarewell })` where `draftFarewell = buildDraftFarewell(ledger)` — the only no-new-API path to summary *content*. Added a `renderFindingsTable` (TTY-only, suppressed by `--json`).
- **Reuse, not reinvent** (Finding 02): no new ledger API, no change to `status`, the ledger, error codes, or inbox lanes. `cli → runner` import only (all helpers already imported).
- **Evidence (GREEN)**: `npx vitest run test/cli/companion-findings.test.ts` → **4 passed / 4**; full suite `npx vitest run` → **1408 passed / 16 skipped / 0 failed** (was 1404; +4 new); `tsc --noEmit` clean.
- **Commit**: `521ff50` (GREEN); companion pinged (`review-request: T002`).

## T003 — DOC — fix exemplar + guide

- **`agents/code-review-companion/outside.md`**: replaced the "Skim the inbox between commits" block (the old `inbox list --unread | jq` findings instruction) with a "Read findings between commits" section that leads with `minih companion findings code-review-companion --run "$RUN_ID" --json | jq '.data.findings'` as the canonical **lane-agnostic** read-path, plus an explicit ⚠️ "don't hand-`jq` a raw lane — findings live on the *inside* lane". Kept the `--unread` skim, re-scoped as a cheap liveness check (not the findings read-path).
- **`docs/how/companion-mode.md`**: added §3a "Read the findings (the lane-agnostic read-path)" after §3, documenting the command, the `{ findings, summariesCount, draftFarewell.summary }` surface, the shared-ledger-with-`status` rationale, and the newest-run-by-`startedAt` default.
- **Evidence**: both edits ground AC-F's doc clause — the exemplar no longer points operators at the wrong lane, and the guide documents the read-path.

## Phase complete

- All phase tasks `[x]`; suite **1408 pass / 16 skip / 0 fail**, `tsc` clean.
- AC-F met end-to-end: `minih companion findings <slug>` surfaces an inside-lane HIGH finding + summary regardless of lane (T001/T002); `outside.md` + `docs/how/companion-mode.md` document the read-path (T003).
- Domain `cli` (internal) — additive subcommand, no contract change; `_docs` — exemplar + guide. `cli → runner` import only.

## Companion debrief & findings reconciliation

Live `code-review-companion` (runId `2026-06-16T07-24-05-445Z-061c`) reviewed all 4 pings. Verdicts: **T001 APPROVE** (0), **T002 APPROVE** (0), **T003 APPROVE_WITH_NOTES** (1 MED), **final APPROVE_WITH_NOTES** (2 MED). 4 summaries, 2 findings.

> **Dogfood data point (the phase fixing itself):** a raw `minih outside inbox list … | jq 'select(.sender=="inside")'` skim showed **0** inside messages, but `minih companion findings` (this phase's NEW command, over the lane-agnostic ledger) surfaced **2 findings + 4 summaries** — a live reproduction of #50 F *and* direct proof the new read-path fixes it.

| ID | Sev | File | Issue | Disposition |
|----|-----|------|-------|-------------|
| F001 | MEDIUM | `docs/how/companion-mode.md` | §5 + quick-ref still taught `cat output/report.json` for the farewell — contradicts the dogfood rule and the read-path message this phase adds | **Fixed** (`b…`): both replaced with `minih companion findings` / `last-run` / `validate` |
| F002 | MEDIUM | `AGENTS_README.md` | bundled guide didn't document the `minih companion findings` read-path; §5 farewell still `cat`-ed report.json | **Fixed**: added §3a read-path step + replaced farewell `cat` with CLI surfaces; left the line-966 *migration smoke-check* raw (it intentionally verifies report.json was written) |

Both MEDIUM, both contract-drift, both adjacent to F's thesis (CLI read-paths > raw file reads) → fixed inline (matches Phase 2's "fix them all"). Companion `report.json` was not yet written at the stop-read (the SDK was still finalizing the farewell); findings/summaries above were captured via the ledger (`minih companion findings`). Companion run exited cleanly after `control:stop`.
