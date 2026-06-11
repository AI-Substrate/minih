# Fix Tasks: Simple Mode

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Count streamed assistant turns for `--max-turns`

- **Severity**: HIGH
- **File(s)**: `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts`, relevant tests under `/Users/jordanknight/substrate/minih/test/`
- **Issue**: After `assistant.message_delta`, the adapter returns early for the consolidated `assistant.message`. The runner counts turns only on translated `message` events, so normal streaming turns can bypass `--max-turns`.
- **Fix**: Preserve exactly one turn-accounting signal for each assistant turn, including streamed turns. Add a regression test using SDK-shaped events: deltas followed by a consolidated message, with `maxTurns` low enough to breach.
- **Patch hint**:

```diff
- if (event.type === 'assistant.message' && hasStreamedText) {
-   output = event.data?.content ?? '';
-   inFlightMessage = null;
-   return;
- }
+ if (event.type === 'assistant.message' && hasStreamedText) {
+   output = event.data?.content ?? '';
+   inFlightMessage = null;
+   // Still emit/count one completed turn; suppress duplicate display elsewhere if needed.
+ }
```

The exact patch may differ; the invariant is that streaming chunks do not produce multiple turns, but the final assistant turn is counted once.

## Medium / Low Fixes

### FT-002: Preinitialize budget race callbacks before adapter events can fire

- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/minih/src/runner/runner.ts`, `/Users/jordanknight/substrate/minih/test/runner/runner-stall.test.ts`
- **Issue**: `adapter.run()` is invoked before `fireMaxTurns` is assigned. Synchronous `message` events can execute `fireMaxTurns?.()` while it is undefined.
- **Fix**: Build the max-turns/stall deferred promises before calling `adapter.run()`, or use a preinitialized deferred object that cannot miss synchronous breaches. Add a regression test with synchronous fake-adapter events.

### FT-003: Fix Domain Manifest currency

- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md`
- **Issue**: `src/adapter/deadline.ts` is classified as internal even though runner imports it and adapter domain docs expose it as contract. `src/adapter/index.ts` and `src/runner/index.ts` changed but are absent from the manifest.
- **Fix**: Reclassify `src/adapter/deadline.ts` as `adapter` / `contract`; add manifest rows for `src/adapter/index.ts` and `src/runner/index.ts`.

### FT-004: Add missing resume positive-path budget evidence

- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/minih/test/cli/run-budget-flags.test.ts`
- **Issue**: AC-6 covers run/resume validation and run budget echo, but does not show positive resume-path budget threading/recording.
- **Fix**: Add or cite a test that supplies resume budget flags and verifies effective config/run.json budgets.

### FT-005: Add missing `runs` terminalReason passthrough evidence

- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/minih/test/cli/status-terminal-reason.test.ts` or the existing runs command tests
- **Issue**: AC-7 explicitly names `status` and `runs`; current evidence covers `status` only.
- **Fix**: Add or cite a `runs` test seeded with `terminalReason: 'stalled-stream'`.

## Re-Review Checklist

- [x] FT-001 fixed with regression coverage — `ab0be14`: suppression removed; adapter test pins one consolidated `message` per streamed turn
- [x] FT-002 fixed or proven impossible with regression coverage — `dd9d7a0`: race arms built before `adapter.run()`; `SyncEmitAdapter` regression
- [x] FT-003 manifest updates applied — `1997b3f`: deadline.ts → contract; adapter/runner barrel rows added
- [x] FT-004 evidence added or cited — `d713af9`: shared `resolveEffectiveBudgets` + unit pins + resume-in-place run.json recording test
- [x] FT-005 evidence added or cited — `4b3d20f`: `RunInventoryRow.terminalReason` passthrough + unit + built-CLI tests
- [ ] Re-run `/the-flow 7 review --plan /Users/jordanknight/substrate/minih/docs/plans/026-stall-watchdog/stall-watchdog-plan.md` and achieve zero HIGH/CRITICAL findings

> **Companion-mode disposition (2026-06-12)**: the fix pass ran under stage 6c with a live `code-review-companion` (run `2026-06-12T08-39-31-885Z-544e`) that reviewed every FT commit plus the full range `752945f..a75d435` — farewell envelope: **zero findings, six APPROVE summaries**. Per stage-6c doctrine the companion review supersedes a stage-7 re-run; the row above stays available if a fresh review artifact is preferred before merge.
