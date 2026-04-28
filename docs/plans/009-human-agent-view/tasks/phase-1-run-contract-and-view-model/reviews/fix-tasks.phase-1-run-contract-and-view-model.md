# Fix Tasks: Phase 1: Run Contract & View Model

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Export Phase 2 entry points from the runner barrel
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/index.ts
- **Issue**: `resolveRun()` and `buildHumanViewModel()` are implemented but not exported from the public runner surface, so the Phase 2 CLI cannot consume them through the contract documented in the phase dossier.
- **Fix**: Add barrel exports for both runtime functions and add a regression test that imports them through `src/runner/index.ts`.
- **Patch hint**:
  ```diff
  + export { buildHumanViewModel } from './human-view-model.js';
  + export { resolveRun } from './run-resolver.js';
  ```

### FT-002: Stop leaving dead manifests behind on invalid-input failure
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/runner.ts
- **Issue**: The initial manifest write now happens before input validation, but the invalid-input early return never finalizes `run.json` or writes `completed.json`.
- **Fix**: Either move the first `writeManifest()` call below successful input validation, or keep the early write and explicitly patch/write failure artifacts before returning.
- **Patch hint**:
  ```diff
  - const initialManifest: LiveRunManifest = { ... };
  - await writeManifest(runDir, initialManifest);
  ...
    if (!inputValidation.valid) {
  +   await writeManifest(runDir, {
  +     ...initialManifest,
  +     status: 'failed',
  +     updatedAt: new Date().toISOString(),
  +   });
        return { ... };
    }
  ```

## Medium / Low Fixes

### FT-003: Align stale detection default with the Phase 1 dossier
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/run-resolver.ts, /Users/jordanknight/substrate/minih/test/runner/run-resolver.test.ts
- **Issue**: The shared resolver defaults to `60_000` ms even though T005 documents a 10-second default.
- **Fix**: Change the default to `10_000` ms and add a regression test that asserts the default.
- **Patch hint**:
  ```diff
  - const DEFAULT_STALE_THRESHOLD_MS = 60_000;
  + const DEFAULT_STALE_THRESHOLD_MS = 10_000;
  ```

### FT-004: Preserve a known sessionId on failure and timeout
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/runner.ts
- **Issue**: If `session_start` fires and the run later fails/times out, the final metadata and manifest overwrite the known session id with an empty string/null.
- **Fix**: Fall back to `activeSessionId` whenever `agentResult.sessionId` is empty.
- **Patch hint**:
  ```diff
  - sessionId: agentResult.sessionId,
  + sessionId: agentResult.sessionId || activeSessionId,
  ...
  - sessionId: agentResult.sessionId || null,
  + sessionId: agentResult.sessionId || activeSessionId || null,
  ```

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Medium fixes applied or explicitly triaged
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
