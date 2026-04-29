# Retro Harvest Loop Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-29
**Spec**: [retro-harvest-loop-spec.md](./retro-harvest-loop-spec.md)
**Workshop**: [Plan 010 / Workshop 002](../010-coordination-cli-and-resume/workshops/002-retro-harvest-discipline.md)
**Status**: DRAFT

## Summary

Close the consumer side of minih's improvement loop. Today, every agent is heavily taught to emit `magicWand` + `difficulties` on farewell, but minih has no operator-side teaching, no harvest verb, and no project-level retro ledger. This plan ships four tiers of in-product teaching (cosmetic hint, `minih harvest` verb, auto-append at terminal condition, `minih doctor` audit) plus bundled documentation that scaffolds into every user project via `minih init`. Outcome: every retro lands in a grep-able `docs/retros/<slug>.md` ledger by default, with no skill or external tooling required.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `cli` | existing | **modify** | New `minih harvest <slug>` command (single + `--since` batch); `displaySummary` end-of-run retro hint; `minih doctor` retro-completeness check; `init` scaffolds `docs/retros/`; help text on `run` / `resume` mentions the loop |
| `runner` | existing | **modify** | New writer module `retro-ledger.ts` (idempotent + atomic-append + dual-write); auto-append branch at terminal condition; stub-entry generation for runs that produced no `report.json`; `MINIH_NO_AUTO_HARVEST` opt-out; `MINIH_PLAN_ID` env handoff |
| `agents/_shared/preamble.md` + `src/templates/shared-preamble.md` | existing template | **modify** | "## For Operators" paragraph teaching the harvest contract |
| `src/templates/retros-readme.md` | **NEW** template asset | **create** | Bundled markdown explaining the ledger; `init` scaffolds it as `<user-project>/docs/retros/README.md` |
| `AGENTS_README.md` | existing doc | **modify** | New "## The Improvement Loop" section |
| `docs/domains/{cli,runner}/domain.md` | existing | **modify** | History row entries |
| `adapter` / `mcp` | existing | **consume** | No changes |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/runner/retro-ledger.ts` | runner | internal | NEW — append-only writer (entry format, idempotency check, atomic-append, dual-write per agent + per plan, stub-entry helper) |
| `src/runner/index.ts` | runner | contract | Re-export `appendRetroEntry`, `appendRetroStub`, `RetroEntry`, `RetroLedgerError` |
| `src/runner/runner.ts` | runner | internal | Wire auto-append branch at the existing `parseReportJson` site (line ~821) and at the failed-run early-return sites (line ~411 etc.); honor `MINIH_NO_AUTO_HARVEST`; emit stub when `output/report.json` missing |
| `src/runner/types.ts` | runner | internal | Add `MINIH_PLAN_ID` to `MINIH_ENV_KEYS` (so the agent also sees plan context); export `RetroEntry` type |
| `src/cli/commands/harvest.ts` | cli | contract | NEW — `minih harvest <slug>` (single) + `minih harvest --since <ref>` (batch via fs mtime) |
| `src/cli/commands/doctor.ts` | cli | internal | EXTEND — add unharvested-retro check to existing doctor output |
| `src/cli/commands/run.ts` | cli | internal | Help-text addition: "After the run completes, `minih harvest <slug>` captures the retro" |
| `src/cli/commands/resume.ts` | cli | internal | Same help-text addition |
| `src/cli/commands/init.ts` | cli | internal | Scaffold `docs/retros/` directory with bundled `README.md`; idempotent |
| `src/cli/index.ts` | cli | contract | Wire `registerHarvestCommand` |
| `src/runner/pretty.ts` (or `src/runner/display.ts` — inspect to confirm) | runner | internal | `displaySummary` adds one line: `📝 magicWand: "<wand>"` (or `⚠️ Retrospective not written` for failed runs) |
| `src/templates/retros-readme.md` | template | NEW | Bundled — explains ledger format, harvest verb, plan-vs-agent files |
| `src/templates/shared-preamble.md` + `agents/_shared/preamble.md` | template | content | Append "## For Operators" paragraph (≤12 lines markdown) |
| `scripts/copy-schemas.js` | build | internal | Copy `retros-readme.md` to `dist/templates/` (mirrors existing `shared-preamble.md` copy) |
| `AGENTS_README.md` | docs | content | New "## The Improvement Loop" section |
| `README.md` | docs | content | One-line mention in Quick Start ("Retros from each run land in `docs/retros/`") |
| `docs/domains/cli/domain.md`, `docs/domains/runner/domain.md` | docs | content | History row + Concepts table updates (new `harvest` concept on cli) |
| `test/runner/retro-ledger.test.ts` | runner-test | internal | NEW — TDD for writer (idempotency, dual-write, atomic-append, stub) |
| `test/runner/runner-auto-harvest.test.ts` | runner-test | internal | NEW — TDD for runner auto-append branch + opt-out + fail-silent |
| `test/cli/harvest.test.ts` | cli-test | internal | NEW — `minih harvest` envelope, `--since`, doctor check |
| `test/cli/init-coordinated.test.ts` | cli-test | regression | UPDATE — confirm `docs/retros/` scaffolded |
| `test/cli/run-help.test.ts`, `test/cli/commands.test.ts` | cli-test | regression | UPDATE — help text snapshot |

## Key Findings

(From Workshop 002 + spec + my fresh memory of plan 010's runner / CLI surface.)

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | The producer side of the retro loop is fully built (`agents/_shared/preamble.md` references `magicWand`/`difficulties` 8 times, output schema marks `magicWand` REQUIRED). The consumer side is **entirely missing** — no CLI verb, no ledger directory, no operator-side teaching anywhere. This plan is the asymmetry fix. | Workshop 002 — every task (T001-T013) aligns to this. |
| 02 | Critical | `runner.ts:821` (`parsedReport = parseReportJson(outputPath)`) is the load-bearing seam for auto-append on the success path. The failed-run early-return sites (e.g., line ~411 input-validation failure) are where stub-entry writes belong. | T010/T011 wire auto-append exactly at these two existing sites — no new orchestration layer. |
| 03 | High | `MINIH_PLAN_ID` is not a defined env var today. The dual-write per-plan path (Q3 clarification) needs it. Adding it to `MINIH_ENV_KEYS` lets the agent also see plan context (bonus value), but is strictly read by the runner before MCP env-key scrubbing for the writer call. | T002 / T010 add `MINIH_PLAN_ID` to `MINIH_ENV_KEYS`. Operators set it via shell env or skill plumbing. |
| 04 | High | `scripts/copy-schemas.js` already copies `src/templates/shared-preamble.md` to `dist/templates`. Adding `retros-readme.md` is a one-line edit; the bundled-template pattern is established. | T007 mirrors the existing pattern; no new build infrastructure. |
| 05 | High | `minih init` (`src/cli/commands/init.ts:174-175`) already reads `dist/templates/shared-preamble.md` to scaffold the user's `agents/_shared/preamble.md`. The same pattern works for `docs/retros/README.md`. | T007 reuses the `readDefaultSharedPreamble`-style approach. |
| 06 | High | Atomic-append for the ledger should reuse the existing POSIX `writeFileAtomicAsync` pattern from `src/runner/atomic-write.ts`. Concurrent same-slug writes are rare but possible (parallel resumed runs); read-modify-write race must be handled. | T005/T006 use a small helper: read-current-content, scan for `runId: <id>` (idempotency), append, atomic-rename. |
| 07 | Medium | `src/cli/commands/state.ts` slimmed-down `outside.ts` extraction in plan 010 left several shared helpers (`buildOutsideMessage`, `parseWaitMs`, `withStateErrors`, etc.) re-exported from `outside.ts`. The `harvest` command does not need most of these — it needs only run-resolution (`findRunSession` / `resolveCoordinationRunOrExit`-equivalent for non-coordinated agents). | T008 keeps `harvest.ts` lean; resolves runs via existing `runner.findRunSession` directly. |
| 08 | Medium | Companion-style coordinated agents launched without a plan context will *not* set `MINIH_PLAN_ID`. That's correct behavior — those retros only land in `docs/retros/<slug>.md`. We must not require `MINIH_PLAN_ID`; it's strictly a dual-write enrichment. | T010 / writer must treat `MINIH_PLAN_ID` as optional. Tests cover both paths. |
| 09 | Medium | Auto-append failure-mode policy from Q4 clarify: skip silently with `MINIH_AUTO_HARVEST_SKIPPED` debug line when `docs/retros/` is unwritable; never poison a successful run. | T011 wraps the writer call in try/catch; debug log via `process.stderr.write` only when `--verbose` set. |
| 10 | Low | Workshop 002 references magic-wand candidate `peerIdleSince` (from prior companion run) as carrying forward into a "future plan". This plan does not address it — strictly the harvest loop. The peerIdleSince idea remains a candidate for plan 012 if desired. | Out of scope (no task linked); documented here only so reviewers see we considered it. Future plan 012 candidate. |

## Implementation

**Objective**: Land HF-A → HF-D (per Workshop 002 § Recommended Rollout) in a single phase: cosmetic + bundled docs first, then writer + verb, then runner auto-append, then doctor audit. Final `just fft` gate green.

**Testing Approach**: Hybrid (per spec § Testing Strategy)
- **TDD RED → GREEN** for: `retro-ledger.ts` writer (idempotency, dual-write, atomic-append, stub generation), runner auto-append branch (opt-out, fail-silent, `MINIH_PLAN_ID` dual-write).
- **Lightweight assertion-style** for: `minih harvest` envelope shape, `--since` batch behavior, `minih doctor` retro check, `displaySummary` snapshot, `init` scaffolding.
- **No live SDK** required.

### Tasks

> ⚠️ **HF-A items (T001-T004) can ship in one commit** as the "lightweight teaching" landing. HF-B / HF-C / HF-D each warrant their own commit. Total target: 4 commits.

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | **HF-A** — Add end-of-run retro hint to `displaySummary` (in `src/runner/display.ts`). Read `parsedReport.retrospective.magicWand` from the run result. **Truncation rule**: take the first non-empty line of `magicWand`, collapse internal whitespace to single spaces, then truncate to 100 chars; if truncation occurred, append `…` (single-char ellipsis). When the wand is non-empty: print to stderr (pretty + verbose modes both): `📝 magicWand: "<truncated>"  (full: minih harvest <slug>)`. When `parsedReport` is null AND result is `timeout`/`failed`: print `⚠️ Retrospective not written (run terminated as <result>)`. When `parsedReport` exists but `magicWand` is empty (degraded but no wand): print nothing. | runner | `/Users/jordanknight/substrate/minih/src/runner/display.ts` | Snapshot test on stderr for: (a) happy path with wand → expected line printed; (b) failed run → warning printed; (c) success but no wand → nothing printed; (d) multi-line wand → first line collapsed and truncated correctly. `just fft` green. | Per Workshop 002 § Strategy 2. Truncation rule pinned per validation Comp-1. |
| [x] | T002 | **HF-A** — Append "## For Operators" paragraph (~12 lines markdown) to `agents/_shared/preamble.md` AND `src/templates/shared-preamble.md`. Content: explains agents emit retros for a reason, harvest is the consumer side, recommends `minih harvest <slug>` after every run. Use the wording locked in Workshop 002 § Strategy 7. **`MINIH_PLAN_ID` handling (per validation HIGH-1)**: do NOT add `MINIH_PLAN_ID` to `MINIH_ENV_KEYS` — that list is the runtime *scrub* list and would cause cleanup at line 824-826 to delete the value, breaking dual-write in test scenarios that run multiple agents in one process. INSTEAD: at the start of `runAgent` (around line 240, before any other env access), capture `const planId: string | null = process.env.MINIH_PLAN_ID ?? null;` and thread `planId` as a function-local through to the writer calls in T011. If we also want the agent to see it for orientation, T011 will pass it explicitly via the spawned MCP server's `env` block in `buildInsideMcpServerConfig` (no `MINIH_ENV_KEYS` change needed). | runner + template | `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md`, `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md`, `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | Both template files identical (`diff` returns nothing); `runAgent` captures `planId` locally at entry; `MINIH_ENV_KEYS` is **unchanged** (verified by existing env-key composition tests). | Per Finding 03. Validation HIGH-1 fix. |
| [x] | T003 | **HF-A** — Add "## The Improvement Loop" section to `AGENTS_README.md`. Brief: every agent emits a retro on farewell → minih harvests it to `docs/retros/<slug>.md` (and per-plan when `MINIH_PLAN_ID` set) → operators review the ledger before the next planning session. **Privacy callout (per validation HIGH-4)**: include a "Privacy considerations" sub-bullet stating: "Retro content is generated by the LLM and committed to git by default. Review entries before pushing — magicWand and difficulties may include code snippets, file paths, or environment details. Set `MINIH_NO_AUTO_HARVEST=1` if your project handles secrets and add `docs/retros/` to `.gitignore` if needed." Also add a one-line mention in `README.md` Quick Start: "Each run's retro lands in `docs/retros/<slug>.md` (review before commit)." | docs | `/Users/jordanknight/substrate/minih/AGENTS_README.md`, `/Users/jordanknight/substrate/minih/README.md` | `grep -F "The Improvement Loop" AGENTS_README.md` returns the section heading; `grep -F "docs/retros" README.md` returns the Quick Start mention; both diffs visible. | Per AC-10. Validation HIGH-4 (privacy) and Comp-2 (concrete README assertion) fixes. |
| [x] | T004 | **HF-A** — Update help text on `minih run` and `minih resume` (`addHelpText('after', ...)`). Add a single line: "After the run completes, `minih harvest <slug>` captures the retro into `docs/retros/`." | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts`, `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts` | `node dist/cli/index.js run --help` shows the line; help-text snapshot test updated if one exists. | Per AC-11. |
| [x] | T005 | **HF-B TDD RED** — write failing tests for `retro-ledger.ts`. Cover: (1) entry format produces canonical markdown matching the bundled template's example block; (2) idempotent — second `appendRetroEntry` for same `runId` is a no-op; (3) dual-write — when `planId` arg present, both `<slug>.md` and `<plan-id>.md` get the entry; (4) atomic — concurrent appendRetroEntry calls do not produce torn output (use existing `writeFileAtomicAsync` semantics); (5) stub generation — `appendRetroStub` produces the lean `> ⚠️` blockquote-prefix block with timestamp + runId + result + run-dir + 1 line stderr tail; (6) graceful skip — when target dir unwritable, throws `RetroLedgerError` (not silent — the runner does the silencing). Use real fs in tmp dirs. | runner-test | `/Users/jordanknight/substrate/minih/test/runner/retro-ledger.test.ts` (NEW) | All assertions fail with module-not-found. | Per Findings 06, 08. |
| [x] | T006 | **HF-B GREEN** — implement `src/runner/retro-ledger.ts`. Exports: `appendRetroEntry({slug, runId, runDir, retrospective, planId?, ledgerDir})`, `appendRetroStub({slug, runId, runDir, result, stderrTail, planId?, ledgerDir})`, `RetroEntry` type, `RetroLedgerError`. Internal: read-modify-write idempotency check (scan for `runId: <id>` line — skip if present), `writeFileAtomicAsync` for atomic rename, `fs.mkdirSync({recursive: true})` for ledger dir. **Retry-on-conflict loop (per validation HIGH-3)**: read file → check idempotency → write atomic-renamed temp → if rename detects a hash mismatch (between original-read-time content and current file content), retry up to 3 times before throwing. Document explicitly that this is best-effort under simultaneous same-slug writers, NOT a strict multi-writer protocol; idempotency check guards against duplicate entries from race retries. Re-export from `src/runner/index.ts`. | runner | `/Users/jordanknight/substrate/minih/src/runner/retro-ledger.ts` (NEW), `/Users/jordanknight/substrate/minih/src/runner/index.ts` | T005 tests turn green (including the retry-on-conflict case); existing 351 runner tests still green. | Per Findings 06, 08. Validation HIGH-3 fix. |
| [x] | T007 | **HF-B** — Bundle the retros README template + scaffold via `init`. Create `src/templates/retros-readme.md` (NEW) with: ledger purpose, entry format example (must match writer output — verified by T005 test), one-paragraph harvest intro. Update `scripts/copy-schemas.js` to copy `retros-readme.md` to `dist/templates/`. Update `src/cli/commands/init.ts` to scaffold `docs/retros/` and `docs/retros/README.md` from the bundled template (idempotent — skip if file already exists). Mirror the existing `readDefaultSharedPreamble` pattern. | template + cli | `/Users/jordanknight/substrate/minih/src/templates/retros-readme.md` (NEW), `/Users/jordanknight/substrate/minih/scripts/copy-schemas.js`, `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts` | `npm run build` produces `dist/templates/retros-readme.md`; `minih init` in a tmp dir creates `docs/retros/README.md`; re-running `minih init` is a no-op (no overwrite). Update `test/cli/init-coordinated.test.ts` to assert. | Per Finding 04, 05. AC-7. |
| [x] | T008 | **HF-B** — Implement `minih harvest <slug>` CLI command. Single mode: read latest run's `output/report.json` via existing `findRunSession`, extract `retrospective`, call `appendRetroEntry`. Batch `--since <ref>` mode: walk `agents/<slug>/runs/`, filter by `completed.json.completedAt > <ref>` (ISO timestamp via `Date.parse`), iterate. Envelope JSON to stdout (`{slug, harvested: [{runId, slug, plan?, ledgerPath[]}], skipped: [{runId, reason}]}`); pretty summary to stderr. **`MINIH_NO_AUTO_HARVEST` semantics (per validation Risk-7)**: explicit `minih harvest` IGNORES the env opt-out and always writes (the env is a kill-switch only for runner auto-append; the explicit verb is the operator escape hatch). Document this in the command's `--help` text. Wire via `registerHarvestCommand` from `src/cli/index.ts`. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/harvest.ts` (NEW), `/Users/jordanknight/substrate/minih/src/cli/index.ts` | `minih harvest code-review-companion` returns ok envelope on a real run; `minih harvest <slug> --since 2026-04-01` returns multi-runId envelope; `MINIH_NO_AUTO_HARVEST=1 minih harvest <slug>` STILL writes the entry (verified by test). | Per AC-2, AC-3. Per Finding 07. Validation Risk-7 (LOW) fix. |
| [x] | T009 | **HF-B Lightweight tests** — `test/cli/harvest.test.ts`: assertion-style tests via `execSync` against `dist/cli/index.js`. Cover happy path, idempotency on second invocation, missing-slug error, `--since` filter, envelope shape. | cli-test | `/Users/jordanknight/substrate/minih/test/cli/harvest.test.ts` (NEW) | All assertions pass; help text snapshot includes the new command. | Per AC-2, AC-3, AC-11. |
| [x] | T010 | **HF-C TDD RED** — write failing tests for `runAgent` auto-append branch. Cover: (1) success run with retro → `docs/retros/<slug>.md` updated automatically; (2) success run with `MINIH_PLAN_ID` env → ALSO `docs/retros/<plan-id>.md` updated; (3) `MINIH_NO_AUTO_HARVEST=1` env → no ledger writes; (4) failed run (timeout/input-invalid early return) → stub entry appended; (5) writer throws → run still succeeds, debug `MINIH_AUTO_HARVEST_SKIPPED` line emitted on stderr; (6) ledger dir does not exist → writer creates it; (7) the auto-write does not interfere with `runDir/completed.json` content. **Environment-matrix cases (per validation HIGH-2)**: (8) `cwd` has no `docs/` directory → skip silently with debug line, run still succeeds; (9) `cwd` is read-only (chmod 555 in test) → skip silently, run still succeeds; (10) `cwd` is `os.tmpdir()`-rooted (sandbox-like) → still works (writes under tmpdir/docs/retros). **Crash-safety case (per validation HIGH-5)**: (11) `runAgent` body throws an uncaught exception mid-run → a stub entry IS still written via top-level try/finally hook before the exception propagates. **Concurrency case (per validation HIGH-3)**: (12) two parallel writers append for the same slug → idempotency check resolves the conflict; the writer's retry-on-conflict loop (up to 3 attempts) ensures both entries land OR a duplicate is detected and skipped (no torn output). Use FakeAgentAdapter; assert against tmp-dir filesystem. | runner-test | `/Users/jordanknight/substrate/minih/test/runner/runner-auto-harvest.test.ts` (NEW) | All 12 assertions fail with module-not-found. | Per Findings 02, 09. AC-4, AC-5, AC-6. Validation HIGH-2/-3/-5 fixes. |
| [x] | T011 | **HF-C GREEN** — wire auto-append into `runner.ts` at every terminal branch. Use a single helper `tryAutoHarvest({outcome, parsedReport, ...})` to avoid duplicated logic. Branches to wire (per validation Comp-4 enumeration):<br>• **(a) Success path** at line ~821 (after `parseReportJson(outputPath)`): if `parsedReport?.retrospective` and `process.env.MINIH_NO_AUTO_HARVEST !== '1'`, call `appendRetroEntry`.<br>• **(b) Degraded path** (`agentSucceeded && validated === false`, `result === 'degraded'`): same as (a) — degraded runs still produce retros.<br>• **(c) `validated === false` with success**: same as (b).<br>• **(d) Input-validation failure** (line ~411): call `appendRetroStub({result: 'failed', reason: 'input-invalid'})`.<br>• **(e) Timeout**: stub with `result: 'timeout'`.<br>• **(f) Schema/output-validation failure on success path**: stub with `result: 'failed', reason: 'schema-fail'`.<br>• **(g) Crash safety (per validation HIGH-5)**: top-level `try { ... } finally { tryAutoHarvestStubIfUnwritten() }` around the runAgent body. The stub is a single-fire idempotent "if no entry was written for this runId in this invocation, write one" — guarantees that even an uncaught exception leaves an audit trail. Use a function-local `harvested = false` flag to track.<br>• Each call wraps in try/catch; on error emit `MINIH_AUTO_HARVEST_SKIPPED: <reason>` to stderr (only when verbose) and continue.<br>• Pass `planId` (captured at runAgent entry per T002) and `ledgerDir = path.join(config.cwd ?? process.cwd(), 'docs', 'retros')` to every call.<br>• If the agent should ALSO see `MINIH_PLAN_ID`, T011 adds it to the inside MCP server's `env` block via the existing `insideMcpServerFactory` plumbing — does NOT touch `MINIH_ENV_KEYS`. | runner | `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | T010 tests turn green (all 12); all 351 existing runner tests still green; `just fft` green. | Per Findings 02, 09. AC-4, AC-5, AC-6. Validation HIGH-3/-5 + Comp-4 fixes. |
| [x] | T012 | **HF-D** — Extend `minih doctor`. Walk `agents/*/runs/` for run dirs with `completed.json` and (a) success result + `output/report.json` containing `retrospective.magicWand` BUT (b) no matching `runId: <id>` line in `docs/retros/<slug>.md`. Report each as a doctor warning: `⚠️  unharvested retro: <slug>/<runId>  (run: minih harvest <slug> --since <runId-as-date>)`. Print `0 unharvested retros` cleanly when none. **Ledger size soft-warn (per validation MEDIUM Risk-3)**: also report any `docs/retros/<file>.md` exceeding 1MB as `⚠️  large ledger: <path> (<size>) — consider rotating`. Add to existing doctor envelope. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts` | New unit test in `test/cli/doctor.test.ts` for: (a) clean state, (b) unharvested-retro warning, (c) large-ledger warning. Existing doctor regression green. | Per AC-9. Validation MEDIUM Risk-3 fix. |
| [ ] | T013 | **HF-D Final gate**. Run `just fft` — must exit 0. **Live smoke target pinned (per validation Coherence-2)**: run `minih run smoke-test` (whose `output-schema.json` REQUIRES `retrospective.magicWand`, guaranteeing the ledger entry will be written if auto-append fires correctly). Verify: (a) `docs/retros/smoke-test.md` exists with the entry containing the runId; (b) `displaySummary` printed the magicWand hint; (c) `minih doctor` reports 0 unharvested. **Build artifact gate (per validation MEDIUM Risk-6)**: also verify `dist/templates/retros-readme.md` exists after `npm run build` and matches `src/templates/retros-readme.md` byte-for-byte (catches developers forgetting the build step). Update `docs/domains/cli/domain.md` and `docs/domains/runner/domain.md` § History rows. **Concept text for cli domain.md (per validation Comp-3)**: add a `harvest` concept entry with this body:<br>> **harvest** — `src/cli/commands/harvest.ts`. Owns the operator-side surface for moving an agent's `retrospective` (from `output/report.json`) into the project-level retro ledger at `docs/retros/<slug>.md` (and `docs/retros/<plan-id>.md` when `MINIH_PLAN_ID` is set). Boundary: idempotent append-only writes; does NOT triage/prioritize/classify retro content (operator does that manually). Companion to runner's `appendRetroEntry`/`appendRetroStub`.<br>Commit + push. | repo + docs | repo root, `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md`, `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | `just fft` exit 0; live `smoke-test` run produces ledger entry verified by grep; `dist/templates/retros-readme.md` byte-identical to source; commit pushed. | Per AC-12. Validation Coherence-2, MEDIUM Risk-6, Comp-3 fixes. |

### Acceptance Criteria

(Mapping each task to spec acceptance criteria — also see spec § Acceptance Criteria for full text.)

- [ ] AC-1 (end-of-run hint) — T001
- [ ] AC-2 (`minih harvest <slug>`) — T006, T008, T009
- [ ] AC-3 (`--since` batch) — T008, T009
- [ ] AC-4 (auto-append on by default) — T010, T011
- [ ] AC-5 (`MINIH_NO_AUTO_HARVEST` opt-out) — T010, T011
- [ ] AC-6 (stub on terminal failure) — T010, T011
- [ ] AC-7 (`init` scaffolds `docs/retros/`) — T007
- [ ] AC-8 (operator paragraph in scaffolded preamble) — T002
- [ ] AC-9 (`doctor` reports unharvested) — T012
- [ ] AC-10 (`AGENTS_README` improvement loop) — T003
- [ ] AC-11 (help-text references) — T004, T009
- [ ] AC-12 (`just fft` baseline) — T013

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Concurrent same-slug auto-appends race and produce torn ledger output | Low | Medium | T006 uses `writeFileAtomicAsync` (read-modify-write-atomic-rename) PLUS a retry-on-conflict loop (up to 3 attempts) PLUS idempotency check. **Honest scope**: this is best-effort under simultaneous same-slug writers, NOT a strict multi-writer protocol. Idempotency check guards against duplicate entries from race retries. Operationally rare (parallel runs of one agent slug are unusual outside of test scenarios, which use isolated tmp dirs). |
| Auto-append silently fails in CI / read-only filesystems and operators don't notice | Low | Low | T012 (`minih doctor`) is the audit safety-net. Debug stderr line shows up with `--verbose`. |
| Bundled `retros-readme.md` example drifts from the writer's actual output format | Medium | Low | T005 includes a test that imports the bundled template, extracts the example entry block via fenced-code parsing, and asserts the writer produces matching output. Failure means one of them needs updating in the same PR. |
| `MINIH_PLAN_ID` collisions / stale env from prior in-process state (mirror of plan 010 R-003) | Low | Low | Auto-append reads `process.env.MINIH_PLAN_ID` directly each call (no caching); not mutated by the runner. |
| Operator paragraph in preamble adds tokens to every agent prompt | Certain | Negligible | Section is ≤12 lines (~150 tokens). Worth it for cultural reinforcement; if it ever becomes load-bearing weight we can demote to `docs/how/` only. |
| The "stub-on-failure" path adds complexity to multiple early-return sites in `runner.ts` | Medium | Low | T011 introduces a single `tryAppendStub` helper called from each early-return site — not duplicated logic. |
| Existing dogfood agents launched via `minih run` from the project root won't have `MINIH_PLAN_ID` and so dual-write won't fire — ok per Q3, but we should make sure operators understand when this kicks in | Low | Low | T003 / T007 README documents this clearly. T011 logs at debug level when only the per-agent file is written. |

---

## Notes for /plan-6 implementation

- **Mode = Simple**: tasks T001-T013 ship in one phase. No subtask dossiers, no per-task plan-5 expansion.
- **TDD ordering**: T005 must fail before T006 starts; T010 must fail before T011 starts. T011 is the riskiest task (multiple `runner.ts` integration points); RED bar in T010 is non-negotiable.
- **Commit boundaries**: T001-T004 (HF-A) → 1 commit. T005-T009 (HF-B) → 1 commit. T010-T011 (HF-C) → 1 commit. T012 (HF-D doctor) → 1 commit. T013 (final gate + domain docs) → 1 commit. Total: 5 commits.
- **No companion required for this plan** — the work is mechanical enough and well-defined enough that a synchronous reviewer pass is overkill. If desired, fire one review request after T013 for a single-pass check.
- **Live SDK smoke**: not required (no Copilot calls). T013's "live coordinated agent end-to-end" can use any existing dogfood agent like `smoke-test` or `coordination-smoke-test`.
- **Per-agent override deferral** (Clarify pre-locked default): if Q3's per-plan dual-write reveals demand for per-agent `autoHarvest: false` frontmatter, that's a future plan, not v1.
- All five clarification answers are baked into task definitions above.

---

## Validation Record (2026-04-29)

### plan-4-v2-complete-the-plan (3 validators in parallel)

| Validator | Status | HIGH | MEDIUM | LOW |
|-----------|--------|------|--------|-----|
| Structure | ISSUES → FIXED | 0 | 2 → 0 | 0 |
| Testing Alignment | PASS | 0 | 0 | 0 |
| Domain Completeness | PASS | 0 | 0 | 0 |
| Doctrine | N/A | — | — | — |
| ADR | N/A | — | — | — |

**Verdict**: **READY** (0 HIGH; 2 MEDIUM resolved inline).

**Fixes applied**:
- Finding 01 Action now references task range T001-T013.
- Finding 10 Action explicitly marked "no task linked; future plan 012 candidate".

**Lens coverage**: 11/12 (above the 8-floor — only "User Experience" not directly covered, but Completeness Comp-1 caught a UX issue anyway).

### validate-v2 (4 agents in parallel — Coherence, Risk, Completeness, Forward-Compatibility)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence | Integration & Ripple, Hidden Assumptions, System Behavior | 1 HIGH fixed (env-scrub assumption), 1 MEDIUM fixed (smoke target) | ⚠️ → ✅ |
| Risk | Edge Cases & Failures, Performance & Scale, Deployment & Ops, Security & Privacy | 4 HIGH fixed (CI/sandbox, concurrent same-slug, redaction policy, crash safety), 2 MEDIUM fixed (ledger growth, build-artifact gate), 1 LOW fixed (harvest opt-out semantics) | ⚠️ → ✅ |
| Completeness | Concept Documentation, Technical Constraints, User Experience | 0 HIGH; 4 MEDIUM fixed (truncation rule, README assertion, harvest concept text, T011 branch enumeration) | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Technical Constraints, Domain Boundaries | 0 HIGH; 1 MEDIUM fixed (pattern reference removed) | ⚠️ → ✅ |

### validate-v2 — Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6-v2-implement-phase` invocation | Implementable T001-T013 with absolute paths and explicit success criteria, no grep-needed tribal knowledge | contract drift | ⚠️ → ✅ | Originally flagged by ForwardCompat-1 ("Mirror the existing readDefaultSharedPreamble pattern" + "or display.ts — inspect first"); FIXED inline in T001 (pinned to `display.ts`) and T002 (replaced pattern reference with exact symbol + line range). |
| Future plan 012 (`peerIdleSince`) | Harvest loop must ship so retros surface candidate ideas in `docs/retros/<slug>.md` | lifecycle ownership | ✅ | Spec § Goals G3+G4 + plan T011 wire the loop to fire on every successful run. Plan 012 will inherit a populated ledger. |
| External npm users | Bundled `dist/templates/retros-readme.md`, scaffolded `agents/_shared/preamble.md` operator section, working `minih harvest` | encapsulation lockout | ✅ | `package.json` ships only `dist`; `copy-schemas.js` extension (T007) puts retros template in `dist/templates`; T013 build-artifact gate verifies it. `minih init` reuses existing `readDefaultSharedPreamble` scaffolding pattern. |
| In-repo dogfood agents (`smoke-test`, `coordination-smoke-test`, `code-review-companion`) | Auto-append must NOT break runs in CI/local/tmp sandboxes | test boundary | ✅ | T010 expanded to 12 cases including no-`docs/`, read-only fs, `os.tmpdir()` cwd, and uncaught-exception crash safety. T011 wraps in top-level try/finally with single-fire stub guarantee. |

**Outcome alignment**: "every run that produces a retro will: nudge the operator at completion time, be harvestable with a one-line CLI command, (by default) auto-append to a project-level retro ledger, be auditable by `minih doctor` if the operator opted out." — yes, the plan as written advances this outcome.

**Standalone?**: No — four named downstream consumers (implementor, plan 012, external users, in-repo dogfood agents).

### Fixes applied (HIGH — 5)

- **HIGH-1 (Coherence env scrub)** — T002 rewritten: do NOT add `MINIH_PLAN_ID` to `MINIH_ENV_KEYS`; instead capture `planId` as a function-local at `runAgent` entry. If agent visibility is desired, pass via inside-MCP `env` block separately.
- **HIGH-2 (Risk CI/sandbox)** — T010 RED bar expanded to 12 cases including no-`docs/`, read-only fs, `os.tmpdir()` cwd.
- **HIGH-3 (Risk concurrent same-slug)** — T006 adds retry-on-conflict loop (up to 3 attempts) + idempotency check. Risks table updated with honest "best-effort, not strict multi-writer" scope.
- **HIGH-4 (Risk security/privacy)** — T003 adds "Privacy considerations" sub-bullet to AGENTS_README + Quick Start mention in README warning operators to review retros before commit.
- **HIGH-5 (Risk crash safety)** — T010 case 11 + T011 branch (g): top-level try/finally hook in `runAgent` body emits a stub on uncaught exceptions before propagating.

### Fixes applied (MEDIUM — 7)

- Coherence-2: T013 smoke target pinned to `smoke-test` (schema requires `retrospective.magicWand`).
- Comp-1: T001 truncation rule specified (first non-empty line, collapse whitespace, 100-char + `…` ellipsis).
- Comp-2: T003 adds concrete `grep` assertion for both AGENTS_README and README.
- Comp-3: T013 includes verbatim concept text for `harvest` so domain.md update needs no invention.
- Comp-4: T011 enumerates every terminal branch (success / degraded / validated-false / input-invalid / timeout / schema-fail / crash).
- Risk-3: T012 doctor extended with 1MB ledger soft-warn.
- Risk-6: T013 verifies `dist/templates/retros-readme.md` byte-matches source.

### Fixes applied (LOW — 1)

- Risk-7: T008 documents that explicit `minih harvest` IGNORES `MINIH_NO_AUTO_HARVEST` (env is a kill-switch for runtime auto-append only; the explicit verb is the operator escape hatch).

**Overall**: ⚠️ → ✅ **VALIDATED WITH FIXES** — 5 HIGH + 7 MEDIUM + 1 LOW resolved inline. Plan is ready for `/plan-6-v2-implement-phase`.
