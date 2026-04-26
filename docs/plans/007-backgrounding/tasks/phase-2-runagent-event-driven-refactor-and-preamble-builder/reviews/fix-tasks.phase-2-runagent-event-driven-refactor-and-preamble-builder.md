# Fix Tasks: Phase 2: runAgent Event-Driven Refactor + Preamble Builder

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Reset duplicate suppression per queued turn

- **Severity**: HIGH
- **File(s)**:
  - /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts
  - /Users/jordanknight/substrate/minih/test/adapter/sdk-copilot.test.ts
- **Issue**: `hasStreamedText` and `hasStreamedThinking` are never reset after a queued turn reaches `session_idle`, so a later queued turn can have its consolidated `assistant.message` or `assistant.reasoning` event suppressed as a duplicate from the earlier turn.
- **Fix**:
  1. Reset the per-turn suppression flags on a real turn boundary (`session_idle` at minimum; `assistant.turn_start` / `assistant.turn_end` if the SDK emits them consistently).
  2. Add a regression that models: delta turn -> consolidated message -> idle -> second turn consolidated message/no delta -> idle, and assert both turns produce the expected event stream.
  3. Mirror the same shape for reasoning if the suppression logic stays shared.
- **Patch hint**:
  ```diff
   if (event.type === 'assistant.reasoning_delta') {
     hasStreamedThinking = true;
   }
   if (event.type === 'assistant.message_delta') {
     hasStreamedText = true;
   }
  +if (isSessionIdleEvent(event)) {
  +  hasStreamedThinking = false;
  +  hasStreamedText = false;
  +}
   if (event.type === 'assistant.reasoning' && hasStreamedThinking) {
     return;
   }
   if (event.type === 'assistant.message' && hasStreamedText) {
     output = event.data?.content ?? '';
     return;
   }
  ```

## Medium / Low Fixes

### FT-002: Align backward-compat evidence with the phase contract

- **Severity**: MEDIUM
- **File(s)**:
  - /Users/jordanknight/substrate/minih/test/cli/all-existing-agents-pass-doctor.test.ts
  - /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
- **Issue**: The implemented regression gate proves only `doctor`/`list` stability, but the Phase 2 plan still claims representative run-path/report compatibility evidence.
- **Fix**:
  1. Preferred: add a deterministic run-path regression that snapshots a representative `report.json` shape without depending on a real SDK session.
  2. Acceptable fallback: narrow the plan/execution-log wording so the acceptance evidence explicitly says the Phase 2 gate covers `doctor`/`list` plus preamble byte-equivalence, not a live representative run.
- **Patch hint**:
  ```diff
  regressionDescribe('existing agents backward compatibility', () => {
    it.each(['doctor', 'list'] as const)(...)
  +  it('matches a representative run-path report shape', () => {
  +    // Drive runAgent with a deterministic fake adapter and compare the
  +    // stripped report shape to a frozen fixture.
  +  })
   });
  ```

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Representative queued-turn regression added or phase docs narrowed to the implemented evidence
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
