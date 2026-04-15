# Code Review: Compounding Value (Simple Mode)

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/006-compounding-value/compounding-value-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/006-compounding-value/compounding-value-spec.md
**Phase**: Simple Mode
**Date**: 2026-04-14
**Reviewer**: Automated (plan-7-v2) — 5 GPT-5.4 subagents
**Testing Approach**: Lightweight

## A) Verdict

**APPROVE WITH NOTES**

One correctness fix needed (parseReportJson null safety — F001). All other findings are MEDIUM/LOW.

**Key failure areas**:
- **Implementation**: parseReportJson returns unvalidated difficulty items — malformed entries could crash displaySummary
- **Domain compliance**: Minor doc staleness (registry, concepts, domain-map edge labels)
- **Reinvention**: Run-folder scanning pattern duplicated across difficulties.ts, computeVelocity, and history.ts — acceptable for now, consider extracting shared utility later
- **Testing**: CLI formatting tests excluded by design (Lightweight approach), but AC1 enum enforcement gap worth noting

## B) Summary

The implementation is solid — velocity computation handles edge cases well (8 tests), schema backward compatibility is verified, and the A→B→C difficulty pipeline works end-to-end (proven by live agent run). The main correctness issue is that parseReportJson trusts the structure of difficulty array items without validation, which could crash displaySummary on malformed agent output. Domain docs were updated but have minor gaps (registry purpose text, CLI concepts). The run-folder scanning pattern is duplicated in three places, which is acceptable at current scale but worth extracting if a fourth consumer appears.

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present (velocity.test.ts, schema-compat.test.ts)
- [x] Critical paths covered (velocity computation, schema backward compat)
- [x] Key verification points documented (live agent run proved end-to-end)
- [x] Only in-scope files changed
- [x] Build + type check clean (126 tests pass)
- [x] Domain compliance checks pass (minor doc gaps noted)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | runner.ts:618-641 | correctness | parseReportJson returns unvalidated difficulty items — null/invalid items crash displaySummary | Filter items: only include objects with string category/description/severity |
| F002 | MEDIUM | runner.ts:553-596 | correctness | computeVelocity includes resumed runs in velocity history | Skip entries with resumedFromRunId |
| F003 | MEDIUM | difficulties.ts:27-34 | pattern | --agent flag doesn't validate slug or return error envelope for invalid/missing agent | Add validateSlug + resolveAgent pattern from history.ts |
| F004 | MEDIUM | domain docs | domain-md | Registry missing `difficulties` command, CLI concepts stale | Update registry purpose text and CLI concepts |
| F005 | MEDIUM | runner.ts/difficulties.ts | reinvention | Run-folder scanning duplicated in 3+ places | Acceptable now, extract utility if 4th consumer appears |
| F006 | LOW | runner.ts:590-603 | correctness | Division by zero if durationMs is 0 | Guard <= 0 durations |
| F007 | LOW | domain-map.md | map-edges | Edge label doesn't mention SYSTEM_OUTPUT_INSTRUCTIONS | Update edge label |
| F008 | LOW | index.ts | pattern | computeVelocity exported publicly but only used internally | Remove from barrel export |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 (HIGH)**: `parseReportJson()` returns `retro.difficulties` as-is without validating individual items. If an agent writes `difficulties: [null, 42, "not an object"]`, `displaySummary()` will crash accessing `d.severity`. Fix: filter items to only include valid objects.

**F002 (MEDIUM)**: `computeVelocity()` doesn't exclude resumed runs from history. A resumed run that completes quickly could skew the velocity curve. Fix: skip entries with `resumedFromRunId`.

**F006 (LOW)**: `computeVelocity()` divides by `prevDuration`/`firstDuration` without guarding against 0. Unlikely in practice but could produce Infinity/NaN. Fix: guard `<= 0`.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | All files under declared domains |
| Contract-only imports | ✅ | No cross-domain internal imports |
| Dependency direction | ✅ | cli → runner → adapter maintained |
| Domain.md updated | ⚠️ | History + concepts updated, but runner Composition missing system-output.json |
| Registry current | ⚠️ | CLI purpose text doesn't mention `difficulties` |
| No orphan files | ✅ | AGENTS_README correctly marked as `—` (global docs) |
| Map nodes current | ✅ | |
| Map edges current | ⚠️ | Edge label missing SYSTEM_OUTPUT_INSTRUCTIONS |
| No circular business deps | ✅ | |
| Concepts documented | ⚠️ | Runner updated, CLI concepts section stale |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| difficulties.ts (folder scan) | history.ts, folder.ts pattern | cli+runner | ⚠️ Similar but different purpose — proceed |
| computeVelocity (folder scan) | history.ts scan pattern | runner+cli | ⚠️ Same — proceed, extract later |
| parseReportJson | validator.ts JSON parsing | runner | ✅ Different concern — proceed |
| VelocityData/ParsedReport types | None | runner | ✅ Net-new |

### E.4) Testing & Evidence

**Coverage confidence**: 36% (automated) + manual evidence from live agent run

| AC | Confidence | Evidence |
|----|------------|----------|
| AC1-2 | 35% | Schema has fields, positive test exists, system validator permissive by design |
| AC3 | 95% | Direct test: legacy output validates |
| AC4 | 70% | Script updated all 8, doctor confirms healthy |
| AC5-7 | 95% | 8 velocity tests cover all edge cases |
| AC8-9 | 50% | Code review confirms implementation, no automated test (manual verify per spec) |
| AC10-13 | 50% | Live agent run proved MH-001 appeared, code review confirms |
| AC14-22 | 70% | Content review confirms text present in files |
| AC23 | 70% | File change confirmed |
| AC24-25 | 80% | Live hello-world run showed all fields in envelope |

### E.5) Doctrine Compliance

**F003 (MEDIUM)**: `difficulties` command doesn't follow the validateSlug/resolveAgent + error-envelope pattern used by other commands when `--agent` is provided.

**F008 (LOW)**: `computeVelocity` exported from barrel but only called internally + tests.

### E.6) Harness Live Validation

N/A — no harness configured.

## F) Coverage Map

**Overall coverage confidence**: 65% — strong for core logic (velocity, schema), moderate for CLI output (manual verify), low for doc content (excluded from automated scope by spec).

## G) Commands Executed

```bash
git --no-pager diff main..HEAD --stat
git --no-pager diff main..HEAD > docs/plans/006-compounding-value/reviews/_computed.diff
git --no-pager diff main..HEAD --name-status
npx tsc --noEmit
npm test
node dist/cli/index.js doctor
node dist/cli/index.js run hello-world
node dist/cli/index.js run code-review --param context="..."
node dist/cli/index.js difficulties
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: APPROVE WITH NOTES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/006-compounding-value/compounding-value-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/006-compounding-value/compounding-value-spec.md
**Phase**: Simple Mode
**Tasks dossier**: inline in plan
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/006-compounding-value/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/006-compounding-value/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/runner/runner.ts | Modified | runner | Fix F001 (validate difficulty items), F002 (skip resumed runs), F006 (div-by-zero guard) |
| /Users/jordanknight/substrate/minih/src/runner/types.ts | Modified | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/display.ts | Modified | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | Modified | runner | Consider F008 (remove computeVelocity export) |
| /Users/jordanknight/substrate/minih/src/cli/commands/difficulties.ts | Created | cli | Fix F003 (add slug validation) |
| /Users/jordanknight/substrate/minih/src/cli/commands/history.ts | Modified | cli | None |
| /Users/jordanknight/substrate/minih/src/cli/commands/run.ts | Modified | cli | None |
| /Users/jordanknight/substrate/minih/src/cli/index.ts | Modified | cli | None |
| /Users/jordanknight/substrate/minih/src/schemas/retrospective.json | Modified | runner | None |
| /Users/jordanknight/substrate/minih/src/schemas/system-output.json | Modified | runner | None |

### Recommended Fixes

| # | File | What To Fix | Why |
|---|------|-------------|-----|
| F001 | src/runner/runner.ts:618-641 | Validate difficulty items in parseReportJson — filter to objects with string fields | Malformed items crash displaySummary |
| F002 | src/runner/runner.ts:553-596 | Skip resumed runs in computeVelocity | Resumed runs skew velocity curve |
| F003 | src/cli/commands/difficulties.ts:27-34 | Add validateSlug + resolveAgent for --agent flag | Pattern consistency with other commands |

### Domain Artifacts to Update

| File | What's Missing |
|------|---------------|
| /Users/jordanknight/substrate/minih/docs/domains/registry.md | Add `difficulties` to CLI purpose text |
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Add concepts for difficulty ledger + velocity surfacing |

### Next Step

Apply F001-F003 fixes, then commit. Implementation is approved — ready for PR after fixes.
