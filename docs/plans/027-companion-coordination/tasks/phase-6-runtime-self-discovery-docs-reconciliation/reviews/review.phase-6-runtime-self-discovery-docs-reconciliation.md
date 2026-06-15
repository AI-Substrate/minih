# Code Review: Phase 6 - Runtime self-discovery + docs reconciliation (#29 + #32 docs)

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/companion-coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/companion-coordination-spec.md
**Phase**: Phase 6: Runtime self-discovery + docs reconciliation (#29 + #32 docs)
**Date**: 2026-06-15
**Reviewer**: Automated (the review verb)
**Testing Approach**: Full TDD

## A) Verdict

**APPROVE**

No HIGH or CRITICAL findings were identified.

## B) Summary

Phase 6 implements the self-discovery trio by resolving `allowedStates` through the shared mcp-internal schema resolver while preserving the existing `coordinationMode` and `idleBudgetSec` contract. The new `contract-phrase-drift` doctor sensor stays in the cli domain and avoids the illegal cli-to-mcp import path; its scope matches the narrowed Phase 6 task dossier. Domain docs and registry/domain-map tool-count references are reconciled to nine tools, including `coordination_status`. Testing evidence is strong for the Phase 6 acceptance criteria, with RED/GREEN evidence recorded for the new MCP and doctor surfaces and a full `just fft` success recorded in the execution log.

## C) Checklist

**Testing Approach: Full TDD**

- [x] RED tests precede implementation for code changes
- [x] GREEN evidence recorded for implementation tasks
- [x] Acceptance criteria have concrete verification evidence
- [x] Only in-scope files changed for the Phase 6 implementation range
- [x] Linters/type checks/test gate evidence recorded
- [x] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| - | - | - | - | No findings. | - |

## E) Detailed Findings

### E.1) Implementation Quality

No substantive correctness, security, error-handling, performance, scope, or pattern issues were found.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | PASS | New implementation files are placed under their declared cli/mcp domains; pack and docs changes match the plan's non-domain/cross-domain declarations. |
| Contract-only imports | PASS | `src/mcp/tools/coordination-status.ts` imports the shared mcp-internal resolver; `src/cli/commands/doctor.ts` keeps its own resolver and does not import mcp internals. |
| Dependency direction | PASS | Changes preserve `cli -> {mcp, runner, adapter}`, `mcp -> runner`, and runner isolation; no upward imports introduced. |
| Domain.md updated | PASS | cli and mcp domain docs record the Phase 6 deltas; runner remains verify-only for this phase. |
| Registry current | PASS | `docs/domains/registry.md` reflects nine MCP coordination tools and the companion status surface. |
| No orphan files | PASS | Changed files map to the Phase 6 task dossier and Domain Manifest, including the code-review-companion pack as a governed non-domain artifact. |
| Map nodes current | PASS | `docs/domains/domain-map.md` was reconciled after companion feedback to the nine-tool wording. |
| Map edges current | PASS | No new cross-domain dependency edge was introduced by the mcp-internal resolver extraction or cli-local doctor check. |
| No circular business deps | PASS | No circular domain dependency was introduced. |
| Concepts documented | PASS | The new `coordination_status.allowedStates` and `contract-phrase-drift` concepts are documented in the touched domain docs. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|-----------------|--------|--------|
| `insideStateSchemaPath` shared mcp-internal resolver | Existing private resolver in `state.ts`, intentionally extracted | mcp | proceed |
| `checkContractPhraseDrift` doctor sensor | Similar shape to `checkPromptStateVocabularyDrift`, intentionally mirrored in cli | cli | proceed |
| `allowedStates` resolution in `coordination_status` | Reuses the new mcp resolver rather than hardcoding | mcp | proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 94%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-14 | 97% | `test/mcp/coordination-status.test.ts` asserts `allowedStates`, `coordinationMode`, and `idleBudgetSec` in one call; `src/mcp/tools/coordination-status.ts` returns the trio; execution log records T001-T003 RED/GREEN and 21 passing targeted tests. |
| AC-15 | 95% | `test/cli/doctor-contract-phrase.test.ts` covers three drift cases plus the real-pack pass; `src/cli/commands/doctor.ts` wires `checkContractPhraseDrift`; AGENTS_README exit-reason/tool-count edits are recorded. |
| AC-16 | 93% | `docs/domains/registry.md`, `docs/domains/mcp/domain.md`, and `docs/domains/domain-map.md` reflect nine tools and the `coordination_status`/companion status surfaces. |
| AC-17 | 90% | Execution log records `just fft` exit 0 with 1386 tests passed / 16 skipped, including the new Phase 6 suites. |

### E.5) Doctrine Compliance

No substantive doctrine/rules issues were found. Repository architecture conventions are preserved: mcp-only sharing for the schema resolver, cli-local doctor logic, ESM TypeScript imports, and no new dependencies.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-14 | Inside agent can read allowed-state enum, coordination mode, and idle budget through one dogfood-safe surface. | `coordination_status` result includes `allowedStates`, `coordinationMode`, and `idleBudgetSec`; test coverage pins root-schema resolution and parse-failure fallback. | 97% |
| AC-15 | AGENTS_README and companion docs align to the singular contract and doc drift is guarded. | Sensor B test suite covers contract-phrase drift; AGENTS_README reconciles `no_engagement` and nine-tool wording; `minih doctor` pass recorded. | 95% |
| AC-16 | Registry/domain housekeeping reflects the real MCP tool count and new tools/verbs. | Registry, mcp domain, cli domain, and domain-map updates are in the phase diff; companion feedback reconciliation fixed missed domain-map stale wording. | 93% |
| AC-17 | Full quality gate passes with new tests included. | Execution log records `just fft` exit 0 with lint, format, build, typecheck, tests, audit, and sdk-check completing. | 90% |

**Overall coverage confidence**: 94%

## G) Commands Executed

```bash
harness boot --json
git --no-pager status --short
git --no-pager diff --stat
git --no-pager diff --staged --stat
git --no-pager log --oneline -10
mkdir -p docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/reviews && { git --no-pager diff --stat 9bb8199..HEAD; git --no-pager diff --stat; git ls-files --others --exclude-standard; git --no-pager diff 9bb8199..HEAD; git --no-pager diff; } > docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/reviews/_computed.diff
git --no-pager diff --name-status 9bb8199..HEAD
git --no-pager diff --name-status
git ls-files --others --exclude-standard
git --no-pager diff --check 9bb8199..HEAD
git --no-pager diff --check
```

Additional review actions: five parallel read-only review lenses were run for implementation quality, domain compliance, anti-reinvention, testing/evidence, and doctrine/rules compliance.

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review -
> only context on the work that was done before the review.

**Review result**: APPROVE

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/companion-coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/companion-coordination-spec.md
**Phase**: Phase 6: Runtime self-discovery + docs reconciliation (#29 + #32 docs)
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/reviews/review.phase-6-runtime-self-discovery-docs-reconciliation.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/mcp/tools/coordination-status.ts | Reviewed | mcp | None |
| /Users/jordanknight/substrate/minih/src/mcp/tools/inside-state-schema.ts | Reviewed | mcp | None |
| /Users/jordanknight/substrate/minih/src/mcp/tools/state.ts | Reviewed | mcp | None |
| /Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts | Reviewed | cli | None |
| /Users/jordanknight/substrate/minih/test/mcp/coordination-status.test.ts | Reviewed | mcp test | None |
| /Users/jordanknight/substrate/minih/test/mcp/inside-state-schema.test.ts | Reviewed | mcp test | None |
| /Users/jordanknight/substrate/minih/test/cli/doctor-contract-phrase.test.ts | Reviewed | cli test | None |
| /Users/jordanknight/substrate/minih/AGENTS_README.md | Reviewed | docs | None |
| /Users/jordanknight/substrate/minih/agents/code-review-companion/prompt.md | Reviewed | pack | None |
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Reviewed | cli docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/mcp/domain.md | Reviewed | mcp docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | Reviewed | domain docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/registry.md | Reviewed | domain docs | None |
| /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/tasks.md | Reviewed | plan artifact | None |
| /Users/jordanknight/substrate/minih/docs/plans/027-companion-coordination/tasks/phase-6-runtime-self-discovery-docs-reconciliation/execution.log.md | Reviewed | plan artifact | None |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| - | - | None | Review approved |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| - | None |

### Handback

Implementation complete -- consider committing.
