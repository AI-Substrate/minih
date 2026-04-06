# Code Review: Simple Mode

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md  
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-spec.md  
**Phase**: Simple Mode  
**Date**: 2026-04-06  
**Reviewer**: Automated (plan-7-v2)  
**Testing Approach**: Lightweight

## A) Verdict

**REQUEST_CHANGES**

The phase is close, but one acceptance criterion is still failing in code: non-TTY runs do not fall back to verbose stderr output even though the plan, spec, and README all say they should.

**Key failure areas**:
- **Implementation**: `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` still drops the display callback when `process.stderr.isTTY` is false, and `/Users/jordanknight/substrate/minih/src/runner/pretty.ts` suppresses final-only thinking events.
- **Domain compliance**: `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` and `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md` do not fully document the new cross-domain contract surface.
- **Testing**: CLI-level mode-selection behavior is not covered, and `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md` records the opposite of AC8.

## B) Summary

The pretty-display implementation is mostly solid: delta accumulation, message suppression, inline intent capture, tool formatting, and cleanup behavior are all supported by targeted tests, and no cross-domain import violations or reinvention concerns were found. The main blocker is `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts`, where `useVerbose` includes non-TTY runs but the event callback is still disabled when stderr is not a TTY, so the documented fallback never happens. I also found a smaller but real correctness gap in `/Users/jordanknight/substrate/minih/src/runner/pretty.ts`: any final-only `thinking` event with `isDelta: false` is dropped even when no delta stream preceded it. Domain artifacts were updated only partially, so the runner and adapter docs lag the actual contract surface introduced by this phase.

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present
- [ ] Critical paths covered
- [ ] Key verification points documented with concrete stderr evidence
- [x] Only in-scope files changed
- [x] Build/typecheck/tests/audit pass
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/minih/src/cli/commands/run.ts:125-128,268-273 | correctness | Non-TTY runs are classified as verbose, but no display callback is passed when `process.stderr.isTTY` is false, so stderr stays silent instead of falling back to verbose output. | Use `displayEvent` whenever pretty mode is disabled, and add a regression test that exercises non-TTY execution. |
| F002 | MEDIUM | /Users/jordanknight/substrate/minih/src/runner/pretty.ts:57-61 | correctness | `PrettyDisplay` suppresses every `thinking` event with `isDelta === false`, which drops final-only reasoning turns when no `reasoning_delta` was emitted first. | Suppress final reasoning only after delta reasoning was already streamed; otherwise render the final thinking text and cover it with a test. |
| F003 | MEDIUM | /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:24-42 | domain-md | The runner Contracts table is stale: `PrettyDisplay` is exported from `/Users/jordanknight/substrate/minih/src/runner/index.ts` and consumed by the CLI, but it is not documented as part of the runner contract surface. | Add `PrettyDisplay` to the runner Contracts table with `cli (run command)` as the consumer. |
| F004 | MEDIUM | /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md:22-49 | domain-md | The adapter domain docs were not updated for the `AgentThinkingEvent.data.isDelta` contract change used by pretty mode. | Add a `002-pretty-mode` history entry and document the `isDelta` thinking marker in Contracts/Concepts. |
| F005 | MEDIUM | /Users/jordanknight/substrate/minih/test/cli/commands.test.ts:33-159 | testing | No CLI-level test or preserved stderr transcript verifies pretty vs verbose vs non-TTY mode selection, which let AC8 regress unnoticed. | Add a run-command regression test with a fake adapter or preserve representative stderr transcripts in `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md`. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 — HIGH**: `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:125-128,268-273` computes `useVerbose = opts.verbose || !isTTY`, but the callback wiring still does `pretty ? ... : isTTY ? displayEvent : undefined`. That means redirected stderr and CI runs get no human-readable event stream at all, directly conflicting with AC8 in `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md:78`, the spec acceptance criteria, and the README display-mode note.
- **F002 — MEDIUM**: `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:57-61` unconditionally returns for `isDelta === false`. In `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts`, consolidated reasoning is already suppressed when deltas streamed, so an `isDelta: false` event that reaches `PrettyDisplay` can represent the final-only case. That path currently renders nothing.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New runtime code stays inside declared domains: `/Users/jordanknight/substrate/minih/src/runner/pretty.ts` is under runner; CLI and adapter edits stay in their existing trees. |
| Contract-only imports | ✅ | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` imports `PrettyDisplay` via `/Users/jordanknight/substrate/minih/src/runner/index.ts`, not an internal runner file. |
| Dependency direction | ✅ | Dependency flow remains `cli -> runner`, `cli -> adapter`, `runner -> adapter`; no upward dependency was introduced. |
| Domain.md updated | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` and `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` were updated, but the runner Contracts table still omits `PrettyDisplay`, and `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md` was not updated for `isDelta`. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md` is still accurate because no new domains were introduced. |
| No orphan files | ✅ | Changed source files map cleanly to existing domains; remaining changed files are neutral plan/docs artifacts. |
| Map nodes current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` still reflects the same three domains. |
| Map edges current | ✅ | No new cross-domain edge or unlabeled dependency was introduced in this phase. |
| No circular business deps | ✅ | No circular domain dependency was introduced. |
| Concepts documented | ⚠️ | Domain docs have Concepts sections, but the phase-specific `isDelta` contract nuance that pretty mode depends on is not documented in `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md`. |

### E.3) Anti-Reinvention

No meaningful reinvention detected.

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `PrettyDisplay` | `/Users/jordanknight/substrate/minih/src/runner/display.ts:16-120` (same-domain predecessor, complementary verbose renderer) | runner | proceed |
| `test/runner/pretty.test.ts` | None | None | proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 77%

The phase follows the documented Lightweight strategy well for `PrettyDisplay` internals: AC2-AC6 and AC11 are supported by focused unit tests, and AC9-AC10 are backed by static runner flow plus existing tests. The main gap is display-mode selection at the CLI boundary. `/Users/jordanknight/substrate/minih/test/cli/commands.test.ts` never exercises a real run path, and `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md:38-41` contains checkmarks only, with AC8 explicitly recorded as “Non-TTY: display suppressed”.

| AC | Confidence | Evidence |
|----|------------|----------|
| AC7 | 55 | Wiring for `--verbose` exists in `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:59-60,125-128,268-273`, but no runtime test or transcript proves the legacy event stream end-to-end. |
| AC8 | 0 | `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md:78` requires non-TTY verbose fallback, but `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:268-273` passes `undefined` when `!isTTY`, and `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md:40` records the opposite behavior. |
| AC12 | 100 | `just fft` completed successfully during review: biome check (3 warnings, no errors), format no-op, build, typecheck, tests `89/89`, audit `0 vulnerabilities`. |

### E.5) Doctrine Compliance

N/A — no `docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files exist in this repository.

### E.6) Harness Live Validation

N/A — no `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` is configured for this repository.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC1 | Default run produces clean pretty streaming output | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:125-128` instantiates `PrettyDisplay` for TTY default; `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:57-169` implements thinking/text/tool rendering; `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md:38-39` claims manual verification. | 65 |
| AC2 | Thinking deltas accumulate into flowing text | `/Users/jordanknight/substrate/minih/test/runner/pretty.test.ts:86-93` and `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:69-75`. | 98 |
| AC3 | Thinking finals are suppressed to avoid duplication | `/Users/jordanknight/substrate/minih/test/runner/pretty.test.ts:95-106` and `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:60-61`. | 98 |
| AC4 | Message finals are suppressed after streaming deltas | `/Users/jordanknight/substrate/minih/test/runner/pretty.test.ts:110-141` and `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:94-107`. | 97 |
| AC5 | Tool calls/results are formatted clearly | `/Users/jordanknight/substrate/minih/test/runner/pretty.test.ts:168-195` and `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:132-169`. | 90 |
| AC6 | Intent changes print inline | `/Users/jordanknight/substrate/minih/test/runner/pretty.test.ts:144-165` and `/Users/jordanknight/substrate/minih/src/runner/pretty.ts:120-129`. | 85 |
| AC7 | `--verbose` keeps timestamped line-per-event output | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:59-60,125-128,268-273` routes verbose mode away from `PrettyDisplay`; `/Users/jordanknight/substrate/minih/src/runner/display.ts:47-84` remains the timestamped formatter. | 55 |
| AC8 | Non-TTY falls back to verbose behavior | `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md:78` requires it, but `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:268-273` disables event display when `!isTTY`, and `/Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md:40` records suppression. | 0 |
| AC9 | JSON envelope on stdout is unaffected | `/Users/jordanknight/substrate/minih/src/runner/pretty.ts` writes only to stderr; `/Users/jordanknight/substrate/minih/src/cli/output.ts:67-73` continues writing envelopes to stdout; `/Users/jordanknight/substrate/minih/test/cli/output.test.ts:8-49` covers envelope behavior. | 90 |
| AC10 | `events.ndjson` records all events regardless of display mode | `/Users/jordanknight/substrate/minih/src/runner/runner.ts:219-248` appends NDJSON before optional display callbacks; `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:235-247` and `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:129-155` verify artifact creation. | 95 |
| AC11 | SIGINT cleanup flushes `PrettyDisplay` state | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:260-263,282-285` and `/Users/jordanknight/substrate/minih/test/runner/pretty.test.ts:197-214`. | 95 |
| AC12 | `just fft` passes | Review rerun completed successfully: `npx biome check .`, `npx biome format --write .`, `npm run build`, `npx tsc --noEmit`, `npm test`, `npm audit --audit-level=high`. | 100 |

**Overall coverage confidence**: 77%

## G) Commands Executed

```bash
git --no-pager status --short
git --no-pager diff --stat
git --no-pager diff --staged --stat
git --no-pager log --oneline --decorate -12
git --no-pager show --stat --summary --oneline HEAD
git --no-pager diff 01fd106..056d679 > docs/plans/002-pretty-mode/reviews/_computed.diff
git --no-pager diff --name-status 01fd106..056d679
git --no-pager diff 01fd106..056d679 -- src/adapter/sdk-copilot.ts
git --no-pager diff 01fd106..056d679 -- src/cli/commands/run.ts
git --no-pager diff 01fd106..056d679 -- src/runner/pretty.ts
git --no-pager diff 01fd106..056d679 -- docs/domains/cli/domain.md docs/domains/runner/domain.md docs/domains/adapter/domain.md docs/domains/domain-map.md docs/domains/registry.md
rg "verbose|PrettyDisplay|non-TTY|isTTY|process\\.stderr\\.isTTY" /Users/jordanknight/substrate/minih/test
just fft
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md  
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-spec.md  
**Phase**: Simple Mode  
**Tasks dossier**: inline in /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md  
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/execution.log.md  
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/cli/commands/run.ts | Request changes | cli | Restore non-TTY verbose fallback |
| /Users/jordanknight/substrate/minih/src/runner/pretty.ts | Request changes | runner | Render final-only thinking when no delta stream exists |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | Reviewed | runner | None |
| /Users/jordanknight/substrate/minih/src/adapter/events.ts | Reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/test/runner/pretty.test.ts | Request changes | runner | Add final-only thinking regression coverage |
| /Users/jordanknight/substrate/minih/test/cli/commands.test.ts | Request changes | cli | Add mode-selection coverage for `--verbose` and non-TTY |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Request changes | runner | Document `PrettyDisplay` as exported contract |
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | Request changes | adapter | Document `isDelta` contract and phase history |
| /Users/jordanknight/substrate/minih/README.md | Reviewed | — | No code fix required unless behavior is intentionally changed away from AC8 |

### Required Fixes

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/cli/commands/run.ts | When pretty mode is disabled, always route events to `displayEvent`; keep TTY gating only around pretty/header behavior. | AC8 currently fails because non-TTY runs go silent instead of falling back to verbose output. |
| 2 | /Users/jordanknight/substrate/minih/src/runner/pretty.ts | Render `thinking` finals when no delta reasoning preceded them; only suppress finals that would duplicate already-streamed reasoning. | Final-only reasoning turns are currently dropped. |
| 3 | /Users/jordanknight/substrate/minih/test/cli/commands.test.ts and /Users/jordanknight/substrate/minih/test/runner/pretty.test.ts | Add regression coverage for non-TTY/`--verbose` mode selection and final-only thinking events. | The current test suite did not catch the AC8 regression or the final-only thinking gap. |
| 4 | /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md and /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | Update Contracts/Concepts/History to match `PrettyDisplay` export and `isDelta` contract changes. | Domain artifacts are currently stale relative to the code. |

### Domain Artifacts to Update

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | `PrettyDisplay` in the Contracts table, consumed by cli |
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | `002-pretty-mode` history entry and `isDelta` contract/concept note |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/002-pretty-mode/pretty-mode-plan.md
