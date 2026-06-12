# Code Review: Simple Mode

**Plan**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md`
**Spec**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-spec.md`
**Phase**: Simple Mode
**Date**: 2026-06-12
**Reviewer**: Automated (the-flow stage 7 - review)
**Testing Approach**: Full TDD

## A) Verdict

**REQUEST_CHANGES**

The implementation has one blocking correctness issue: normal streamed assistant turns can bypass the new `--max-turns` budget because the adapter suppresses the consolidated `assistant.message` event after streaming deltas.

**Key failure areas**:
- **Implementation**: `maxTurns` accounting misses normal streamed turns and can also miss synchronous adapter events emitted before the race-arm callback is initialized.
- **Domain compliance**: plan manifest misclassifies `src/adapter/deadline.ts` and omits touched barrel files.
- **Testing**: evidence is strong overall, but resume positive-path budget recording and `runs` passthrough evidence are missing.

## B) Summary

The phase is broadly well-scoped and follows the documented TDD path, with strong coverage for watchdog, timeout, cleanup, CLI validation, docs, and domain updates. The blocking issue is narrow but central to AC-4: the production SDK adapter suppresses consolidated `assistant.message` events after deltas, while the runner increments `stats.messages` only on translated `message` events. That means streaming loops can exceed `--max-turns` without tripping the budget. Domain and evidence findings are lower-risk documentation/test-completeness gaps that should be fixed alongside the implementation issue.

## C) Checklist

**Testing Approach: Full TDD**

- [x] RED-GREEN evidence documented for core behavior tasks
- [x] Critical watchdog/cleanup/timeout paths covered
- [ ] Max-turns tests cover production streaming adapter semantics
- [ ] Resume positive-path budget recording evidence present
- [ ] `runs` passthrough evidence present for `terminalReason`
- [x] Only in-scope files changed
- [x] Linters/type checks reported clean in execution log
- [ ] Domain manifest fully maps touched contract files

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:182-193` | correctness | Streamed assistant turns suppress the consolidated `message` event, so `--max-turns` can miss normal streaming loops. | Preserve a turn-accounting signal for streamed turns, then add a regression test that uses delta + consolidated message shape. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/minih/src/runner/runner.ts:1194-1277` | correctness | `fireMaxTurns` is initialized after `adapter.run()`, so synchronous adapter events can exceed the budget before the race arm exists. | Initialize budget deferred callbacks before invoking `adapter.run()`. |
| F003 | MEDIUM | `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md:37` | domain compliance | `src/adapter/deadline.ts` is classified as internal while runner imports it across a domain boundary and adapter docs expose it as contract. | Reclassify it as `adapter` / `contract` in the Domain Manifest. |
| F004 | MEDIUM | `/Users/jordanknight/substrate/minih/test/cli/run-budget-flags.test.ts` | testing | AC-6 lacks positive resume-path proof that budget flags are threaded and recorded on resume. | Add or cite a resume positive-path test for effective config/run.json budgets. |
| F005 | MEDIUM | `/Users/jordanknight/substrate/minih/test/cli/status-terminal-reason.test.ts` | testing | AC-7 requires `status`/`runs` passthrough, but evidence covers `status` only. | Add or cite a `runs` test for `terminalReason: 'stalled-stream'`. |
| F006 | LOW | `/Users/jordanknight/substrate/minih/src/adapter/index.ts` | domain compliance | Touched adapter contract barrel is absent from the Domain Manifest. | Add it as `adapter` / `contract`. |
| F007 | LOW | `/Users/jordanknight/substrate/minih/src/runner/index.ts` | domain compliance | Touched runner contract barrel is absent from the Domain Manifest. | Add it as `runner` / `contract`. |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 - HIGH - Max-turns can miss normal streamed turns**

`/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:182-193` sets `hasStreamedText = true` on `assistant.message_delta`, then returns early for the later `assistant.message`:

```ts
if (event.type === 'assistant.message' && hasStreamedText) {
  output = event.data?.content ?? '';
  inFlightMessage = null;
  return;
}
```

The runner only increments the turn budget on translated `message` events in `/Users/jordanknight/substrate/minih/src/runner/runner.ts:1022-1028`. Because the adapter suppresses the consolidated event, normal streaming assistant turns are not counted. A streaming loop can therefore bypass `--max-turns`, violating AC-4 and the spec's "chunking-independent" turn definition.

**Fix**: ensure every assistant turn produces exactly one accounting signal even when deltas were streamed. Options include emitting the consolidated `message` event and handling duplicate display elsewhere, or adding a dedicated turn-complete/accounting event keyed by message ID and counting that in the runner. Add a regression test that reproduces SDK shape: multiple `assistant.message_delta` events followed by one `assistant.message`, then verifies a low `maxTurns` trips.

**F002 - MEDIUM - Synchronous adapter events can beat max-turns arm initialization**

`/Users/jordanknight/substrate/minih/src/runner/runner.ts:1194-1277` calls `adapter.run(...)` before assigning `fireMaxTurns`. If an adapter emits `message` events synchronously during `run()` startup, `handleEvent()` can execute `fireMaxTurns?.()` while it is still undefined. The repository's fake adapter can emit queued events synchronously, so this is not just theoretical for tests.

**Fix**: initialize the timeout/stall/max-turns deferred callbacks before invoking `adapter.run()`, or make the breach path set `turnsExceeded` and reject through a preinitialized deferred.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | OK | New source/test files are under the declared adapter/runner/cli test trees. |
| Contract-only imports | WARN | `runner.ts` imports `../adapter/deadline.js`; acceptable direction, but the plan manifest calls `deadline.ts` internal while docs expose it as contract. |
| Dependency direction | OK | No upward imports found; runner -> adapter matches repo architecture. |
| Domain.md updated | OK | adapter/runner/cli domain docs include 026 history/contract/concepts updates. |
| Registry current | OK | No new domains introduced. |
| No orphan files | WARN | `src/adapter/index.ts` and `src/runner/index.ts` changed but are absent from the Domain Manifest. |
| Map nodes current | OK | Domain map nodes remain current; no new domains. |
| Map edges current | OK | runner -> adapter edge updated for `withDeadline`. |
| No circular business deps | OK | No new business-domain cycle introduced. |
| Concepts documented | OK | Concepts/contract docs were updated for affected domains. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|-----------------|--------|--------|
| `withDeadline` | None | adapter | proceed |
| CLI budget flag parser | None | cli | proceed |
| Stall/max-turns runner race arms | None | runner | proceed |

No genuine reinvention findings were reported.

### E.4) Testing & Evidence

**Coverage confidence**: 84%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-1 | 95% | Execution log T005; `test/runner/runner-stall.test.ts` silent-stall case covers failed/stalled-stream/run_stalled/completed.json/exit 124. |
| AC-2 | 85% | Execution log T003/T004; SDK terminate hang tests and runner hung-terminate timeout test. |
| AC-3 | 95% | Execution log T004; runner timeout test asserts `terminalReason: 'timeout'`. |
| AC-4 | 60% | Runner stall tests cover synthetic message events, but production streamed SDK shape is not covered and appears broken by F001. |
| AC-5 | 95% | Flowing tool/thinking/message events and `--stall-timeout 0` disable cases in runner stall tests. |
| AC-6 | 70% | CLI tests cover run/resume help and validation plus run dry-run budget echo; positive resume recording evidence is missing. |
| AC-7 | 55% | Status tests cover status envelope/TTY; no `runs` passthrough evidence found. |
| AC-8 | 90% | Default echo and configured timeout message tests. |
| AC-9 | 95% | Execution log reports SDK 1.0.1, permission-shape pin, and full gate green. |
| AC-10 | 95% | README, run-liveness, CHANGELOG, AGENTS_README vocabulary guard evidence. |
| AC-11 | 95% | E170 remedy test covers `--latest`. |

### E.5) Doctrine Compliance

No additional doctrine findings. The changes generally follow the repo's ESM/strict TypeScript, no-new-dependency, and CLI envelope conventions.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-1 | Stall terminalizes | `execution.log.md` T005; `test/runner/runner-stall.test.ts` | 95% |
| AC-2 | Hung cleanup cannot block terminal writes | `execution.log.md` T003/T004; `test/adapter/sdk-copilot.test.ts`; `test/runner/runner.test.ts` | 85% |
| AC-3 | Timeout gains reason | `test/runner/runner.test.ts` | 95% |
| AC-4 | Max-turns breach terminalizes | `test/runner/runner-stall.test.ts`; weakened by F001 | 60% |
| AC-5 | No false stall trigger / disable knob | `test/runner/runner-stall.test.ts` | 95% |
| AC-6 | Run/resume flags, validation, threading, budgets | `test/cli/run-budget-flags.test.ts`; runner budget assertion; missing positive resume budget recording | 70% |
| AC-7 | Status/runs passthrough | `test/cli/status-terminal-reason.test.ts`; missing `runs` evidence | 55% |
| AC-8 | Shared default timeout | `test/cli/run-budget-flags.test.ts`; `test/runner/runner.test.ts` | 90% |
| AC-9 | SDK current | `package.json`; `package-lock.json`; execution log `just sdk-check` | 95% |
| AC-10 | Docs/vocabulary | README, CHANGELOG, `docs/how/run-liveness.md`, `AGENTS_README.md`, `test/cli/docs-vocabulary.test.ts` | 95% |
| AC-11 | E170 remedy polish | `test/cli/status-terminal-reason.test.ts` | 95% |

**Overall coverage confidence**: 84%

## G) Commands Executed

```bash
harness boot --json
git --no-pager status --short
git --no-pager diff --stat
git --no-pager diff --staged --stat
git --no-pager log --oneline -10
mkdir -p docs/plans/026-stall-watchdog/reviews && { git --no-pager diff --binary; git --no-pager diff --staged --binary; for f in $(git ls-files --others --exclude-standard); do git --no-pager diff --no-index --binary /dev/null "$f" || true; done; } > docs/plans/026-stall-watchdog/reviews/_computed.diff
wc -l docs/plans/026-stall-watchdog/reviews/_computed.diff
```

Also executed read-only artifact inspection via repository search/file-view tools and five parallel review subagents: implementation quality, domain compliance, anti-reinvention, testing/evidence, and doctrine/rules.

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review -
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md`
**Spec**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-spec.md`
**Phase**: Simple Mode
**Tasks dossier**: inline in plan
**Execution log**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/execution.log.md`
**Review file**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/reviews/review.md`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `/Users/jordanknight/substrate/minih/AGENTS_README.md` | reviewed | docs | none |
| `/Users/jordanknight/substrate/minih/CHANGELOG.md` | reviewed | docs | none |
| `/Users/jordanknight/substrate/minih/README.md` | reviewed | docs | none |
| `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md` | reviewed | adapter docs | none |
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | reviewed | cli docs | none |
| `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` | reviewed | domain docs | none |
| `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | reviewed | runner docs | none |
| `/Users/jordanknight/substrate/minih/docs/how/run-liveness.md` | reviewed | docs | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/backpressure-coverage.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/execution.log.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/issue-44-comment.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/original-ask.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/research-dossier.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md` | reviewed | plan | fix F003/F006/F007 manifest entries |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-spec.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/the-flow.json` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/the-flow.md` | reviewed | plan | none |
| `/Users/jordanknight/substrate/minih/package-lock.json` | reviewed | infra | none |
| `/Users/jordanknight/substrate/minih/package.json` | reviewed | infra | none |
| `/Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts` | reviewed | adapter | none |
| `/Users/jordanknight/substrate/minih/src/adapter/deadline.ts` | reviewed | adapter | none |
| `/Users/jordanknight/substrate/minih/src/adapter/events.ts` | reviewed | adapter | none |
| `/Users/jordanknight/substrate/minih/src/adapter/fake.ts` | reviewed | adapter | none |
| `/Users/jordanknight/substrate/minih/src/adapter/index.ts` | reviewed | adapter | manifest entry missing |
| `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts` | reviewed | adapter | fix F001 |
| `/Users/jordanknight/substrate/minih/src/cli/budget-flags.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts` | reviewed | cli | add/cite positive resume evidence |
| `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/status.ts` | reviewed | cli | add/cite `runs` evidence |
| `/Users/jordanknight/substrate/minih/src/runner/index.ts` | reviewed | runner | manifest entry missing |
| `/Users/jordanknight/substrate/minih/src/runner/pretty.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | reviewed | runner | fix F002 |
| `/Users/jordanknight/substrate/minih/src/runner/types.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/test/adapter/deadline.test.ts` | reviewed | adapter tests | none |
| `/Users/jordanknight/substrate/minih/test/adapter/sdk-copilot.test.ts` | reviewed | adapter tests | add F001 regression coverage |
| `/Users/jordanknight/substrate/minih/test/cli/docs-vocabulary.test.ts` | reviewed | cli tests | none |
| `/Users/jordanknight/substrate/minih/test/cli/run-budget-flags.test.ts` | reviewed | cli tests | add/cite resume positive-path evidence |
| `/Users/jordanknight/substrate/minih/test/cli/status-terminal-reason.test.ts` | reviewed | cli tests | add/cite runs passthrough evidence |
| `/Users/jordanknight/substrate/minih/test/runner/runner-stall.test.ts` | reviewed | runner tests | add synchronous-event race coverage if fixing F002 |
| `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts` | reviewed | runner tests | none |

### Required Fixes

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts` and tests | Preserve one turn-accounting signal for streamed assistant turns; add regression coverage for delta + consolidated message shape with `maxTurns`. | AC-4 is not met for normal streaming turns. |
| 2 | `/Users/jordanknight/substrate/minih/src/runner/runner.ts` and tests | Initialize the max-turns race/deferred callback before `adapter.run()` or otherwise make synchronous breach rejection impossible to miss. | Synchronous adapter events can bypass the budget arm. |
| 3 | `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md` | Reclassify `src/adapter/deadline.ts` as contract and add `src/adapter/index.ts` / `src/runner/index.ts` manifest rows. | Domain Manifest should match actual public/import surface. |
| 4 | `/Users/jordanknight/substrate/minih/test/cli/run-budget-flags.test.ts` | Add/cite positive resume budget threading and recording proof. | AC-6 requires run and resume plumbing evidence. |
| 5 | `/Users/jordanknight/substrate/minih/test/cli/status-terminal-reason.test.ts` or appropriate runs tests | Add/cite `runs` passthrough proof for `terminalReason`. | AC-7 names both `status` and `runs`. |

### Domain Artifacts to Update

| File (absolute path) | What's Missing |
|---------------------|----------------|
| `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md` | Correct `src/adapter/deadline.ts` classification; add `src/adapter/index.ts` and `src/runner/index.ts` to Domain Manifest. |

### Next Step

`/the-flow 6 implement --plan /Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md`
