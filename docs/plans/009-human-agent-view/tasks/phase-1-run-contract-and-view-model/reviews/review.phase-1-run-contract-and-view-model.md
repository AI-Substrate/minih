# Code Review: Phase 1: Run Contract & View Model

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/human-agent-view-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/human-agent-view-spec.md
**Phase**: Phase 1: Run Contract & View Model
**Date**: 2026-04-28
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

Phase 1 lands the core manifest, resolver, and reducer logic, but two Phase 2-facing contract gaps remain: the new runner barrel does not actually export `resolveRun()` or `buildHumanViewModel()`, and the early manifest write can strand `run.json` in `starting` when preflight validation fails.

**Key failure areas**:
- **Implementation**: Preflight validation can leave a dead `run.json` candidate that later resolves as active/stale.
- **Domain compliance**: The runner public surface is incomplete for Phase 2 because the planned barrel exports are missing.
- **Testing**: Core reducer/resolver tests are strong, but they do not cover the barrel export surface or the preflight-failure manifest path.

## B) Summary

The runner-domain code stays within the expected boundaries and the new tests cover most of the reducer/resolver happy paths well. `run-manifest.ts`, `run-resolver.ts`, and `human-view-model.ts` are directionally solid, and the targeted Vitest files plus `npm run build` were clean. The two blocking issues are both contract-adjacent: `src/runner/index.ts` is still missing the Phase 2 entry points, and `runAgent()` now writes `run.json` before input validation but never finalizes that manifest on an early validation failure. There is also one smaller contract drift in stale detection and one failure-path issue where a known `sessionId` can be erased on timeout/failure.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Core validation tests present
- [x] Critical paths covered
- [x] Key verification points documented

Universal (all approaches):
- [x] Only in-scope files changed
- [x] Linters/type checks clean (where exercised)
- [ ] Domain compliance checks fully pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/minih/src/runner/index.ts:1-107 | contract | `resolveRun()` and `buildHumanViewModel()` are not exported from the runner barrel even though the Phase 1 contract and execution log say Phase 2 will consume them there. | Export both runtime entry points from `src/runner/index.ts` and add a regression test that imports them through the barrel. |
| F002 | HIGH | /Users/jordanknight/substrate/minih/src/runner/runner.ts:251-268,294-329 | correctness | `run.json` is written before input validation, and an invalid-input early return leaves that manifest stuck at `starting` with no completion artifact. | Either validate before the first manifest write or finalize the manifest/completed state on the early-return path. |
| F003 | MEDIUM | /Users/jordanknight/substrate/minih/src/runner/run-resolver.ts:36-52,250-255 | contract | The resolver defaults stale detection to 60 seconds even though the Phase 1 dossier specifies 10 seconds. | Align the default threshold with the Phase 1 contract or update the contract before Phase 2 depends on it. |
| F004 | MEDIUM | /Users/jordanknight/substrate/minih/src/runner/runner.ts:592-605,701-728 | correctness | Failure/timeout paths can clear a previously known `sessionId` from both `completed.json` and the final manifest. | Preserve `activeSessionId` when `agentResult.sessionId` is empty. |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 — Missing Phase 2 barrel exports**

`src/runner/index.ts` re-exports the new types and error classes, but it never exports the actual runtime functions Phase 2 is supposed to call. The dossier's "Reusable for Future Phases" section says Phase 2 will import `resolveRun()` and `buildHumanViewModel()` from the runner surface, and the execution log claims those public exports were added. As landed, a downstream consumer using the planned barrel import will fail.

**F002 — Early validation failure strands a live manifest**

`runAgent()` now writes the initial manifest immediately after `createRunFolder()`, then performs input validation later. If validation fails, the function returns a failed result without writing `completed.json` or patching `run.json` away from `starting`. That leaves a dead run folder that `resolveRun({ kind: 'latest-active' })` can treat as a live candidate until stale detection finally ages it out.

**F003 — Stale default drifted from the phase contract**

`run-resolver.ts` hard-codes `DEFAULT_STALE_THRESHOLD_MS = 60_000`, while T005 in the phase dossier documents a 10-second default. Because Phase 2 is supposed to trust the shared resolver for honest attach labels, this mismatch means stale runs will look live far longer than the approved Phase 1 contract says.

**F004 — Failure/timeout paths drop known session identity**

The `session_start` handler stores `activeSessionId`, but the failure/timeout path fabricates an `agentResult` with `sessionId: ''`, and the final metadata/manifest write uses that empty value instead of the known live session id. That weakens the Phase 1 promise that `sessionId` is durable once observed.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | All new code stays under `/Users/jordanknight/substrate/minih/src/runner/` as planned. |
| Contract-only imports | ✅ | Runner files import only runner internals, Node built-ins, and adapter contracts/types. |
| Dependency direction | ✅ | No upward imports to `cli` or `mcp`; runner still depends only on adapter contracts. |
| Domain.md updated | ⚠️ | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` has not been updated for the new manifest/resolver/view-model contracts yet; the plan defers that work to Phase 3. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md` still accurately describes the existing runner domain. |
| No orphan files | ✅ | Every reviewed file maps cleanly to the runner domain manifest. |
| Map nodes current | ✅ | No new domains were introduced. |
| Map edges current | ✅ | No new cross-domain edges were added. |
| No circular business deps | ✅ | No circular domain dependencies were introduced. |
| Concepts documented | ⚠️ | The runner Concepts/Composition tables still describe the pre-Phase-1 surface; documentation debt remains for later phases. |

The domain-boundary story is otherwise healthy. The primary contract problem is not an import violation; it is that the intended public surface is not fully exported yet.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `resolveRun()` | Existing "latest run" scans in multiple CLI commands | runner / cli | ⚠️ Good direction, but Phase 2 should migrate callers to the shared resolver instead of keeping the duplicated CLI scans alive. |
| `run-manifest.ts` | No prior live-run manifest helper | runner | ✅ Proceed |
| `buildHumanViewModel()` | No equivalent pure reducer | runner | ✅ Proceed |
| `human-view-fixtures.ts` | No equivalent shared fixture builder set | runner | ✅ Proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 74%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC2 | 1.00 | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` covers delta coalescing + duplicate suppression. |
| AC3 | 0.90 | Same test file covers outside-lane projection on the coordination timeline. |
| AC4 | 1.00 | Same test file covers `Inside agent` labeling. |
| AC5 | 1.00 | Same test file covers tool call/result pairing and status projection. |
| AC6 | 1.00 | Same test file covers `ackOf` correlation and `ackState` projection. |
| AC11 | 1.00 | `/Users/jordanknight/substrate/minih/test/runner/run-resolver.test.ts` covers ambiguous active runs and candidate lists. |
| AC14 | 1.00 | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` covers degraded event input + diagnostics. |
| Manifest lifecycle contract | 0.35 | Happy-path manifest behavior is covered, but there is no test for the invalid-input early return that now strands `run.json`. |
| Phase 2 barrel surface | 0.00 | No test imports `resolveRun()` or `buildHumanViewModel()` from `/Users/jordanknight/substrate/minih/src/runner/index.ts`, and those exports are currently missing. |
| Stale detection default | 0.40 | Resolver tests cover stale liveness, but they do not assert the dossier's 10-second default, so the 60-second drift passed unnoticed. |

### E.5) Doctrine Compliance

N/A — no `docs/project-rules/` documents exist in this repo snapshot. The code still matches the repository architecture rules: runner remains free of CLI/MCP imports, uses in-tree utilities, and keeps Phase 1 logic in the runner domain.

### E.6) Harness Live Validation

N/A — no harness is configured for this feature, and the plan explicitly relies on tests plus scratch/manual dogfood instead.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC2 | Transcript coalesces deltas + final message | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | 1.00 |
| AC3 | Outside actor labeling | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | 0.90 |
| AC4 | Inside agent labeling | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | 1.00 |
| AC5 | Tool lifecycle rows | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | 1.00 |
| AC6 | Ack/message linkage | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | 1.00 |
| AC11 | Ambiguous active-run error | `/Users/jordanknight/substrate/minih/test/runner/run-resolver.test.ts` | 1.00 |
| AC14 | Diagnostics for malformed sources | `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | 1.00 |
| Phase 1 export contract | `resolveRun()` + `buildHumanViewModel()` available from runner barrel | `/Users/jordanknight/substrate/minih/src/runner/index.ts` currently omits both exports | 0.00 |
| Phase 1 manifest lifecycle | `run.json` finalized across start/failure/completion paths | Happy-path tests pass, but invalid-input path leaves `run.json` at `starting` | 0.35 |
| Phase 1 stale default | Shared resolver uses approved default stale threshold | `/Users/jordanknight/substrate/minih/src/runner/run-resolver.ts` defaults to 60_000 ms, not 10_000 ms | 0.40 |

**Overall coverage confidence**: 74%

## G) Commands Executed

```bash
cd /Users/jordanknight/substrate/minih && git --no-pager status --short && printf '\n---STAGED---\n' && git --no-pager diff --staged --stat && printf '\n---UNSTAGED---\n' && git --no-pager diff --stat && printf '\n---LOG---\n' && git --no-pager log --oneline -10
cd /Users/jordanknight/substrate/minih && git --no-pager diff -- src/runner/run-manifest.ts src/runner/run-resolver.ts src/runner/human-view-model.ts src/runner/human-view-errors.ts src/runner/human-view-fixtures.ts src/runner/types.ts src/runner/index.ts src/runner/runner.ts test/runner/run-manifest.test.ts test/runner/run-resolver.test.ts test/runner/human-view-model.test.ts
cd /Users/jordanknight/substrate/minih && npx vitest run test/runner/run-manifest.test.ts test/runner/run-resolver.test.ts test/runner/human-view-model.test.ts test/runner/run-folder-snapshot.test.ts
cd /Users/jordanknight/substrate/minih && npm run build -- --noEmit
cd /Users/jordanknight/substrate/minih && git --no-pager diff -- src/runner/run-manifest.ts src/runner/run-resolver.ts src/runner/human-view-model.ts src/runner/human-view-errors.ts src/runner/human-view-fixtures.ts src/runner/types.ts src/runner/index.ts src/runner/runner.ts test/runner/run-manifest.test.ts test/runner/run-resolver.test.ts test/runner/human-view-model.test.ts test/runner/run-folder-snapshot.test.ts > /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/tasks/phase-1-run-contract-and-view-model/reviews/_computed.diff
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/human-agent-view-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/human-agent-view-spec.md
**Phase**: Phase 1: Run Contract & View Model
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/tasks/phase-1-run-contract-and-view-model/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/tasks/phase-1-run-contract-and-view-model/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/tasks/phase-1-run-contract-and-view-model/reviews/review.phase-1-run-contract-and-view-model.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/runner/run-manifest.ts | Reviewed | runner | No direct change required for the high issues; keep in sync with stale/default fix if call sites change. |
| /Users/jordanknight/substrate/minih/src/runner/run-resolver.ts | Reviewed | runner | Fix stale-threshold default. |
| /Users/jordanknight/substrate/minih/src/runner/human-view-model.ts | Reviewed | runner | No blocking change required. |
| /Users/jordanknight/substrate/minih/src/runner/human-view-errors.ts | Reviewed | runner | No change required. |
| /Users/jordanknight/substrate/minih/src/runner/human-view-fixtures.ts | Reviewed | runner | Optional new tests if you add barrel-export coverage. |
| /Users/jordanknight/substrate/minih/src/runner/types.ts | Reviewed | runner | No blocking change required. |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | Reviewed | runner | Export `resolveRun()` and `buildHumanViewModel()` from the barrel. |
| /Users/jordanknight/substrate/minih/src/runner/runner.ts | Reviewed | runner | Finalize or defer manifest creation on early failure; preserve `sessionId` on failure/timeout. |
| /Users/jordanknight/substrate/minih/test/runner/run-manifest.test.ts | Reviewed | test | Add early-failure manifest regression coverage if you keep the early write. |
| /Users/jordanknight/substrate/minih/test/runner/run-resolver.test.ts | Reviewed | test | Add default-threshold assertion. |
| /Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts | Reviewed | test | No blocking change required. |
| /Users/jordanknight/substrate/minih/test/runner/run-folder-snapshot.test.ts | Reviewed | test | No blocking change required. |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/runner/index.ts | Export `resolveRun()` and `buildHumanViewModel()` from the runner barrel. | Phase 2 is supposed to consume them through `src/runner/index.ts`, and they are missing today. |
| 2 | /Users/jordanknight/substrate/minih/src/runner/runner.ts | Prevent invalid-input early returns from leaving `run.json` stuck at `starting`. | Those dead manifests can pollute later `latest-active` resolution. |
| 3 | /Users/jordanknight/substrate/minih/src/runner/run-resolver.ts | Change the default stale threshold to the approved 10 seconds or update the contract. | Phase 2 attach labels depend on honest stale detection. |
| 4 | /Users/jordanknight/substrate/minih/src/runner/runner.ts | Preserve known `sessionId` when a run fails or times out after `session_start`. | The Phase 1 contract promises durable session identity once observed. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Phase 1 manifest/resolver/view-model contracts are not documented in Composition/Contracts/Concepts yet (planned for Phase 3). |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/human-agent-view-plan.md --phase "Phase 1: Run Contract & View Model"
