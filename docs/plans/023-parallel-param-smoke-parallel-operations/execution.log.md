# Execution Log — Core Parallel Operations Convenience

**Plan**: `docs/plans/023-parallel-param-smoke-parallel-operations/parallel-param-smoke-parallel-operations-plan.md`  
**Started**: 2026-06-09  
**Mode**: Simple  
**Companion**: `code-review-companion/2026-06-09T13-00-07-113Z-caf6`

## Summary

Implemented the core parallel run visibility and ambiguity-safety substrate:

- Added runner contracts for `label` and bounded/redacted `paramsSummary`.
- Added `RunParamsSummary`, label validation, and params-summary formatting with compound secret-ish key redaction.
- Added runner `run-inventory` projection helpers for cross-agent rows and bulk explicit status rows.
- Added `minih runs list` and `minih runs status` command group.
- Added `minih run --label` and persisted labels/params summaries to live and completed metadata.
- Enriched active-run ambiguity candidates with label/paramsSummary.
- Routed `status`, `tail`, `connect`, `resume`, and active coordination ambiguity to E170-safe behavior.
- Added docs/help for safe parallel operation and explicit `--run` workflows.
- Preserved non-goals: no batch scheduler, fanout command, group stop, or multi-run tail UI.

## Validation Commands

| Command | Result | Notes |
|---------|--------|-------|
| `npx vitest run test/runner/run-params-summary.test.ts test/runner/run-inventory.test.ts test/runner/run-manifest.test.ts` | PASS | Initial runner slice after fixing stale fixture threshold. |
| `npm run build && npx vitest run test/cli/runs.test.ts test/cli/run-label.test.ts` | PASS | New command group and label CLI validation. |
| `npm run build && npx vitest run test/cli/run-target-ambiguity.test.ts test/cli/runs.test.ts test/cli/run-label.test.ts test/runner/run-resolver.test.ts` | PASS | Ambiguity guard slice. |
| `npx vitest run test/runner/run-params-summary.test.ts test/runner/run-inventory.test.ts test/runner/run-manifest.test.ts test/runner/run-resolver.test.ts test/cli/runs.test.ts test/cli/run-label.test.ts test/cli/run-target-ambiguity.test.ts test/cli/run-help.test.ts test/cli/tail.test.ts test/cli/view-command.test.ts` | PASS | Focused matrix, 66 tests. |
| `just fft` | PASS | First run failed only on formatting in `agents/parallel-param-smoke/output-schema.json`; after `npx biome check --write` rerun passed lint, format, build, typecheck, tests, and SDK check. `npm audit` reported known advisories but the justfile continues audit with `|| true`. |
| `npx vitest run test/runner/run-resolver.test.ts test/runner/run-inventory.test.ts test/cli/runs.test.ts test/cli/run-target-ambiguity.test.ts test/cli/view-command.test.ts` | PASS | Companion-finding repair slice. |
| `just fft` | PASS | Final post-companion full gate: 1185 passed / 16 skipped. Same known MaxListeners warnings and npm audit advisories surfaced. |

## Companion Findings

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| F001 | HIGH | Stale active manifests were still counted toward E170 ambiguity. | Fixed `collectActiveRuns()` to skip stale-by-`updatedAt` candidates with diagnostics; added resolver and CLI regressions. |
| F002 | HIGH | Inventory `limit` was applied before global ordering across slugs. | Fixed `listRunInventory()` to sort globally before slicing; added cross-slug low-limit regression. |
| F003 | MEDIUM | Malformed `--from` rows aborted `runs status` instead of becoming row-level degraded errors. | Added provenance-aware parsing; direct malformed `--run` remains E108, malformed file lines become degraded rows. |
| F004 | MEDIUM | `--latest` escape hatch was incomplete for selection metadata and `view`. | Added `status` selection metadata, `connect` selection metadata, and `view --latest` support/help. |

## Discoveries & Learnings

| ID | Discovery | Impact | Action |
|----|-----------|--------|--------|
| D001 | `connect` and `resume` use completed-session/eligible-run lookup (`findRunSession`), not the active resolver. | A thin resolver swap would have missed `N active, 0 completed` ambiguity. | Added active-run pre-scans and tests before existing fallback paths. |
| D002 | Inventory rows should not expose `runDir` even though earlier workshop examples included it. | Avoids nudging operators/agents toward direct run-dir inspection. | `run-inventory` public rows omit `runDir`; tests assert no leakage. |
| D003 | Output bounds alone do not guarantee scan bounds. | Large histories can be expensive. | `listRunInventory` scans run dirs newest-first and stops at `limit` for non-`--all` views; fixture test locks behavior. |
| D004 | Exact secret-key redaction is insufficient for real params. | Compound keys like `access_token` can leak. | Implemented case-insensitive substring/normalized key containment; tests cover compound keys. |
| D005 | Existing coordination ambiguity used generic E108. | Contract migration needed explicit proof. | Multiple active coordination targets now return E170; test covers `outside inbox send`. |

## Acceptance Mapping

| AC | Evidence |
|----|----------|
| AC1 Cross-agent inventory | `test/cli/runs.test.ts`, `test/runner/run-inventory.test.ts` |
| AC2 History-capable inventory | `test/cli/runs.test.ts`, `test/runner/run-inventory.test.ts` |
| AC3 Bulk explicit status | `test/cli/runs.test.ts`, `test/runner/run-inventory.test.ts` |
| AC4 Run labels | `test/cli/run-label.test.ts`, `test/runner/run-manifest.test.ts`, `run --label` help |
| AC5 Params summary | `test/runner/run-params-summary.test.ts`, `test/runner/run-inventory.test.ts` |
| AC6 Ambiguity safety | `test/cli/run-target-ambiguity.test.ts`, `test/runner/run-resolver.test.ts` |
| AC7 Backward compatibility | `test/cli/run-target-ambiguity.test.ts` latest-completed compatibility rows; existing `view-command` fallback test |
| AC8 Dogfood path | `README.md`, `AGENTS_README.md`, `docs/how/parallel-runs.md`, `test/cli/run-help.test.ts` negative doc assertion |
| AC9 No batch scope creep | No batch command added; `test/cli/run-help.test.ts` asserts no top-level `batch` command |
| AC10 Validation | `just fft` PASS |

## Residual Risks

- `paramsSummary` redacts by key name only; secrets under benign keys can still display within bounds. Docs warn labels/params are not a secret store.
- `listRunInventory --active` uses bounded newest-first scanning for non-`--all` views; very old still-active runs beyond the bound may require `--all`/higher limit.
- `tail` remains a non-envelope command by design; E170 is surfaced as clear stderr + nonzero exit.
- Existing `run` success envelopes still include `runDir` as part of historical command contract; new `runs list/status` public rows intentionally omit it.

## Files Changed

Source:

- `src/runner/run-params-summary.ts`
- `src/runner/run-inventory.ts`
- `src/runner/types.ts`
- `src/runner/runner.ts`
- `src/runner/run-resolver.ts`
- `src/runner/index.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/runs.ts`
- `src/cli/commands/status.ts`
- `src/cli/commands/tail.ts`
- `src/cli/commands/connect.ts`
- `src/cli/commands/resume.ts`
- `src/cli/coordination.ts`
- `src/cli/index.ts`

Tests:

- `test/runner/run-params-summary.test.ts`
- `test/runner/run-inventory.test.ts`
- `test/runner/run-manifest.test.ts` (covered by focused matrix)
- `test/runner/run-resolver.test.ts`
- `test/cli/runs.test.ts`
- `test/cli/run-label.test.ts`
- `test/cli/run-target-ambiguity.test.ts`
- `test/cli/run-help.test.ts`

Docs:

- `README.md`
- `AGENTS_README.md`
- `docs/how/parallel-runs.md`
- `docs/domains/runner/domain.md`
- `docs/domains/cli/domain.md`
- `docs/plans/023-parallel-param-smoke-parallel-operations/parallel-param-smoke-parallel-operations-plan.md`

## Suggested Commit Message

`feat: add core parallel run visibility`

## Branch Validation Addendum (2026-06-11, pre-merge)

Work was committed to `feat/023-parallel-runs` (cut from fresh `main`) and re-validated on the branch before shipping as [PR #41](https://github.com/AI-Substrate/minih/pull/41). `/plan-8` merge analysis was skipped deliberately — no upstream drift existed.

### Tier 1 — computational

| Command | Result | Notes |
|---------|--------|-------|
| `just fft` | PASS | 1185 passed / 16 skipped — identical to pre-commit gate. Known npm audit advisories only. |

### Tier 2 — behavioral (live, 3 concurrent runs)

| Check | Result |
|-------|--------|
| 3× `minih run parallel-param-smoke --label … --param …` concurrent | PASS — all three active simultaneously (~7s to boot) |
| `runs list --active --slug parallel-param-smoke` | PASS — labels + bounded `paramsSummary`, no `runDir` leakage |
| `minih status parallel-param-smoke` while 3 active | PASS — E170, exit 1, 3 candidates + remediation text |
| `minih status parallel-param-smoke --latest` | PASS — `selection: {mode: latest, ambiguousCandidates: 3}` |
| `runs status --run ×3` (post-completion) | PASS — completed verdicts + labels. (One false alarm during testing: a zsh word-splitting bug in the test harness script, not the CLI.) |
| `runs status --from <file>` with one bogus target | PASS — envelope `degraded`, real rows fine, bogus row E171 (F003 contract) |
| `scratch/agent-runs/{t1,t2,t3}/marker.json` | PASS — per-run param isolation, zero cross-contamination |

### Tier 3 — inferential

Covered during build by the live companion (F001–F004, all fixed; see Companion Findings above).

### Side-signals harvested

The smoke runs auto-harvested retros into `docs/retros/parallel-param-smoke.md` (committed on this branch), which independently **reproduce #37** (MINIH_* env vars empty in the agent shell) and **demonstrate #39** (harvest ledger destination hardcoded to `docs/retros/`). Neither is fixed by this PR.
