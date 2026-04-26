# Code Review: Phase 2: runAgent Event-Driven Refactor + Preamble Builder

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md
**Phase**: Phase 2: runAgent Event-Driven Refactor + Preamble Builder
**Date**: 2026-04-26
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

The event-driven adapter now supports queued turns, but its duplicate-suppression state is still single-turn scoped. Once one turn streams deltas, later idle-separated turns can lose their consolidated `message`/`thinking` events entirely.

**Key failure areas**:
- **Implementation**: queued real-SDK turns can drop later `message` and `thinking` events because duplicate-suppression flags never reset between turns.
- **Testing**: the new backward-compat gate does not provide the representative run-path evidence that the Phase 2 plan still claims.

## B) Summary

The Phase 2 refactor is close: runner and adapter boundaries remain clean, the new `preamble-builder.ts` preserves the non-coordinated prompt assembly path byte-for-byte, and the domain docs were updated coherently for the new seams. I did not find domain-boundary, registry, or map violations, and I did not find genuine reinvention in the new builder, session-sender seam, or fake-adapter helpers. The blocking issue is in `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts`: duplicate suppression is never reset after `session_idle`, so queued turns can silently lose later consolidated events in NDJSON and terminal output. The supporting test suite is strong for single-turn behavior and fake queued flows, but the new regression gate still stops short of the representative run-path coverage the Phase 2 plan documents.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Core validation tests present
- [x] Critical path is covered for single-turn event-driven execution
- [ ] Real queued-turn SDK event sequencing is covered end-to-end
- [x] Key verification evidence documented in the execution log
- [x] Only in-scope files changed
- [x] Linters/type checks clean (per execution log)
- [x] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:86-125` | correctness | Duplicate-suppression state never resets between idle-separated turns, so queued runs can drop later `message`/`thinking` events. | Reset per-turn suppression on turn boundaries and add a queued real-adapter regression that mixes delta and non-delta turns. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/minih/test/cli/all-existing-agents-pass-doctor.test.ts:6-132` | coverage | The new backward-compat gate proves `doctor`/`list` stability, but not the representative run-path/report artifact coverage the Phase 2 plan still claims. | Add a deterministic run-path regression or narrow the Phase 2 acceptance/evidence docs to match the implemented guard. |

## E) Detailed Findings

### E.1) Implementation Quality

#### F001 — Queued turns lose later consolidated events

- **Severity**: HIGH
- **File**: `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:86-125`
- **Category**: correctness
- **Issue**: `hasStreamedText` and `hasStreamedThinking` are set the first time a delta arrives, but they are never reset when the session reaches `session_idle` or another turn boundary. In the old `sendAndWait` path that only affected one turn; in the new event-driven queued-turn path it means later turns inherit the prior turn's suppression state. A later queued turn that emits only a consolidated `assistant.message` (or `assistant.reasoning`) is therefore dropped from `onEvent`, `events.ndjson`, stats, and terminal rendering.
- **Why it matters**: Phase 2 explicitly claims queued-message support. This bug makes the real adapter's multi-turn event stream diverge from the fake queued-run helpers and can hide later-turn output from users and downstream tooling.
- **Recommendation**: Clear the suppression flags on a real turn boundary (`session_idle` at minimum; `assistant.turn_start`/`assistant.turn_end` if available), then add a regression that exercises a delta-emitting first turn followed by a later turn with only consolidated events.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New runtime code stays under `src/runner/` and existing adapter changes stay under `src/adapter/`. |
| Contract-only imports | ✅ | `runner` continues importing only adapter contracts (`events.ts`, `interface.ts`), not adapter internals. |
| Dependency direction | ✅ | `cli -> runner -> adapter` remains intact; no upward imports introduced. |
| Domain.md updated | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` and `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md` both record the P2 contracts/history. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md` remains accurate for the touched domains. |
| No orphan files | ✅ | New source files and changed contracts are represented in the domain docs. |
| Map nodes current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` still reflects the active domain set. |
| Map edges current | ✅ | No new cross-domain edge direction was introduced by P2. |
| No circular business deps | ✅ | The repository still respects the one-way domain chain. |
| Concepts documented | ✅ | New concepts such as event-driven run, session sender seam, prompt assembly, and terminal condition were added to domain docs. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `buildInsidePreamble()` | Prior inline prompt assembly in `runner.ts` | runner | proceed |
| `awaitTerminalCondition()` | None | runner | proceed |
| `SessionSender` / `onSessionReady` | None | adapter | proceed |
| Fake queued-run/session-send helpers | None | adapter | proceed |
| doctor/list baseline helpers | Existing baseline-diff script only, not reusable runtime code | test/cli | proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 73%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-RUN-AGENT-EVENT-DRIVEN | 55 | `test/adapter/sdk-copilot.test.ts` covers single-turn idle completion, duplicate idle emission, error-before-idle, and `onSessionReady`; `test/runner/runner-event-driven.test.ts` covers fake queued idle boundaries. F001 shows the real adapter still mishandles queued turns after a delta-emitting first turn. |
| AC-BACKWARD-COMPAT | 70 | `test/cli/all-existing-agents-pass-doctor.test.ts` compares `doctor` and `list` against the P1 baselines, and the execution log records the gated run passing. The Phase 2 plan still claims representative run-path/report evidence that the new test does not provide (F002). |
| Preamble byte-equivalence | 95 | `test/runner/preamble-builder.test.ts` locks the disabled path to the old join order and also verifies absent `coordination` defaults to that same branch. |
| Forward-compat seams | 70 | `SessionSender`, `onSessionReady`, fake queued-run helpers, and `awaitTerminalCondition` are all present and documented, but the real adapter's per-turn suppression still is not safe for queued flows (F001). |

### E.5) Doctrine Compliance

N/A — `docs/project-rules/` docs are absent in this repository, so there was no doctrine artifact to validate against.

### E.6) Harness Live Validation

N/A — `docs/project-rules/harness.md` is absent, so no harness boot/live validation path exists for this phase.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-RUN-AGENT-EVENT-DRIVEN | `runAgent` uses `session.send` + idle subscription for single and queued flows | Single-turn adapter test, duplicate-idle adapter test, fake queued-run runner test; real queued-turn suppression bug remains | 55 |
| AC-BACKWARD-COMPAT | Existing agents retain prior behavior | Gated `doctor`/`list` baseline test and execution-log evidence; no representative run-path regression despite plan claim | 70 |
| Preamble byte-equivalence | Non-coordinated agents keep the old prompt bytes | Disabled-path snapshot and default-disabled assertion in `test/runner/preamble-builder.test.ts` | 95 |
| Forward-compat seams | P3 can build on the new event-driven adapter/runner seam | `SessionSender`, `onSessionReady`, fake queued helpers, `awaitTerminalCondition`; queued real-adapter event correctness still needs fixing | 70 |

**Overall coverage confidence**: 73%

## G) Commands Executed

```bash
cd /Users/jordanknight/substrate/minih && git --no-pager status --short && git --no-pager diff --stat && git --no-pager diff --staged --stat
cd /Users/jordanknight/substrate/minih && git --no-pager diff --name-status
cd /Users/jordanknight/substrate/minih && find docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder -maxdepth 3 -type f | sort
cd /Users/jordanknight/substrate/minih && git --no-pager diff --unified=25 -- src/runner/runner.ts
cd /Users/jordanknight/substrate/minih && git --no-pager diff --unified=40 -- src/adapter/sdk-copilot.ts src/adapter/fake.ts src/adapter/events.ts src/adapter/interface.ts src/adapter/index.ts src/runner/preamble-builder.ts src/runner/index.ts test/adapter/sdk-copilot.test.ts test/adapter/fake.test.ts test/runner/preamble-builder.test.ts test/runner/runner-event-driven.test.ts
cd /Users/jordanknight/substrate/minih && sed -n '1,220p' scripts/diff-baselines.mjs && sed -n '1,220p' scripts/capture-p1-baseline.sh
cd /Users/jordanknight/substrate/minih && node dist/cli/index.js check --help
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review — only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md
**Phase**: Phase 2: runAgent Event-Driven Refactor + Preamble Builder
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder/reviews/review.phase-2-runagent-event-driven-refactor-and-preamble-builder.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/AGENTS.md | reviewed | docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | reviewed | docs/adapter | None |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | reviewed | docs/runner | None |
| /Users/jordanknight/substrate/minih/docs/domains/registry.md | reviewed | docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | reviewed | docs | None |
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md | reviewed | plan | None |
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md | reviewed | spec | None |
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination.fltplan.md | reviewed | plan | None |
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder/tasks.md | reviewed | plan | None |
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder/tasks.fltplan.md | reviewed | plan | None |
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-2-runagent-event-driven-refactor-and-preamble-builder/execution.log.md | reviewed | plan | None |
| /Users/jordanknight/substrate/minih/package-lock.json | reviewed | lockfile | None |
| /Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts | reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/src/adapter/events.ts | reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/src/adapter/fake.ts | reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/src/adapter/index.ts | reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/src/adapter/interface.ts | reviewed | adapter | None |
| /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | reviewed | adapter | F001 |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | reviewed | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts | reviewed | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/runner.ts | reviewed | runner | None |
| /Users/jordanknight/substrate/minih/test/adapter/fake.test.ts | reviewed | test/adapter | None |
| /Users/jordanknight/substrate/minih/test/adapter/sdk-copilot.test.ts | reviewed | test/adapter | F001 |
| /Users/jordanknight/substrate/minih/test/cli/all-existing-agents-pass-doctor.test.ts | reviewed | test/cli | F002 |
| /Users/jordanknight/substrate/minih/test/runner/folder.test.ts | reviewed | test/runner | None |
| /Users/jordanknight/substrate/minih/test/runner/preamble-builder.test.ts | reviewed | test/runner | None |
| /Users/jordanknight/substrate/minih/test/runner/runner-event-driven.test.ts | reviewed | test/runner | None |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Reset duplicate-suppression state between idle-separated turns and add a queued-turn regression in `/Users/jordanknight/substrate/minih/test/adapter/sdk-copilot.test.ts`. | Later queued turns currently lose consolidated `message`/`thinking` events after any earlier delta stream. |
| 2 | /Users/jordanknight/substrate/minih/test/cli/all-existing-agents-pass-doctor.test.ts | Add deterministic representative run-path coverage, or narrow the Phase 2 docs/claims to `doctor`/`list` only. | Current evidence does not match the broader backward-compat claim still documented in the phase plan. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md | Align the AC-BACKWARD-COMPAT evidence text with the implemented regression scope if no representative run-path test is added. |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md --phase "Phase 2: runAgent Event-Driven Refactor + Preamble Builder"
