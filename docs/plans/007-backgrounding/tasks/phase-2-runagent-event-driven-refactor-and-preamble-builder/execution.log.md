# Phase 2 — Execution Log

**Plan**: `docs/plans/007-backgrounding/coordination-plan.md`
**Phase**: Phase 2: runAgent Event-Driven Refactor + Preamble Builder
**Status**: Landed

---

## Pre-Phase Validation

| Check | Status | Evidence |
|-------|--------|----------|
| Harness file | unavailable | `docs/project-rules/harness.md` is absent; proceed with standard repository tests |
| Context loaded | complete | Read coordination spec/plan, P0/P1 dossiers and execution logs, P2 dossier/flight plan, runner+adapter domain docs, and current adapter/runner source |
| Starting task | T001 | Adapter contract seam is first dependency for T002/T003 and P3 forwarders |

---

## Tasks

### T010 — Domain documentation updates

**Status**: `[x]` DONE

**Files changed**:
- `docs/domains/runner/domain.md`
- `docs/domains/adapter/domain.md`

**Implementation**:
- Added `preamble-builder.ts`, `buildInsidePreamble`, and the event-driven terminal-condition concept to the runner domain.
- Added `SessionSender`, `onSessionReady`, event-driven `run()`, and fake queued-run helpers to the adapter domain.
- Appended incremental `007/P2` history entries to both domains.

**Evidence**:
```bash
node dist/cli/index.js doctor >/tmp/minih-t010-doctor.json && rm -f /tmp/minih-t010-doctor.json
# exit 0; 9 agents healthy
```

---

### T009 — Quality gates and baseline diff

**Status**: `[x]` DONE

**Commands run**:
- `just fft`
- `MINIH_REGRESSION=1 just fft`
- `bash scripts/capture-p1-baseline.sh /tmp/p2-baselines`
- `node scripts/diff-baselines.mjs docs/plans/007-backgrounding/tasks/phase-1-runner-foundations/baselines /tmp/p2-baselines`

**Evidence**:
```bash
just fft
# exit 0; 253 tests passed, 2 skipped; npm audit found 0 vulnerabilities after audit fix

MINIH_REGRESSION=1 just fft
# exit 0; 255 tests passed; npm audit found 0 vulnerabilities

rm -rf /tmp/p2-baselines && bash scripts/capture-p1-baseline.sh /tmp/p2-baselines && node scripts/diff-baselines.mjs docs/plans/007-backgrounding/tasks/phase-1-runner-foundations/baselines /tmp/p2-baselines && rm -rf /tmp/p2-baselines
# OK: 2 file(s) match (after key-strip)
```

**Discovery**: the first default `just fft` surfaced Vite/PostCSS audit findings. `npm audit fix` updated the lockfile; rerunning both gates reported zero vulnerabilities.

---

### T008 — Re-export contracts

**Status**: `[x]` DONE

**Files changed**:
- `src/runner/index.ts`
- `src/adapter/index.ts`

**Implementation**:
- Re-exported `buildInsidePreamble` and `PreambleAssemblyInput` from the runner barrel.
- Re-exported `SessionSender` from the adapter barrel.

**Evidence**:
```bash
npx tsc --noEmit
# exit 0
```

---

### T007 — Backward-compat regression

**Status**: `[x]` DONE

**Files changed**:
- `test/cli/all-existing-agents-pass-doctor.test.ts`
- `AGENTS.md`

**Implementation**:
- Added a gated Vitest suite enabled only when `MINIH_REGRESSION=1`.
- Shells the built CLI for `doctor` and `list`, strips transient keys with the same key set as `scripts/diff-baselines.mjs`, and compares against the P1 baselines.
- Drives a representative `hello-world` run-path with `FakeAgentAdapter` and checks the persisted `report.json` shape without invoking the real SDK.
- Emits the first differing JSON path in the assertion message.
- Documented the regression gate in `AGENTS.md`.

**Evidence**:
```bash
npx vitest run test/cli/all-existing-agents-pass-doctor.test.ts
# 2 tests skipped

npm run build -- --pretty false
# exit 0

MINIH_REGRESSION=1 npx vitest run test/cli/all-existing-agents-pass-doctor.test.ts
# 3 tests passed
```

**Discovery**: the P1 baseline capture is aggregate `doctor` + `list` output. Running those two commands once each covers all nine current agents and avoids unnecessary subprocess fan-out.

---

### T006 — Terminal condition helper

**Status**: `[x]` DONE

**Files changed**:
- `src/runner/runner.ts`
- `test/runner/runner-event-driven.test.ts`

**Implementation**:
- Added `awaitTerminalCondition(adapterResult, pendingForwarderCount: () => number)`.
- Wrapped `adapter.run().then(awaitTerminalCondition)` inside the runner's existing timeout `Promise.race`.
- Used `() => 0` as the P2 placeholder pending-forwarder getter.
- Removed the runner-to-adapter `timeout` option so the runner remains the sole timeout owner for `runAgent`.

**Evidence**:
```bash
npx vitest run test/runner/runner-event-driven.test.ts test/runner/runner.test.ts
# 20 tests passed

npx tsc --noEmit
# exit 0
```

**Discovery**: the old timeout unit-confusion risk is best avoided by not passing runner timeouts into the SDK adapter at all for `runAgent`; the outer runner race now guards both adapter idle and pending-forwarder drain.

---

### T001 — Extend adapter contract

**Status**: `[x]` DONE

**Files changed**:
- `src/adapter/interface.ts`
- `src/adapter/events.ts`

**Implementation**:
- Added `SessionSender` to the adapter contract surface.
- Added optional `AgentRunOptions.onSessionReady?: (sender: SessionSender) => void`.
- Expanded `IAgentAdapter.run()` JSDoc to lock the event-driven terminal condition: idle resolves, session error returns failed result, and the live session sender is surfaced once the initial prompt is sent.

**Evidence**:
```bash
npx tsc --noEmit
# exit 0
```

**Notes**: T001 intentionally does not change runtime behavior yet. T002 and T003 wire the callback in the real and fake adapters.

---

### T002 — Rewrite SdkCopilotAdapter.run()

**Status**: `[x]` DONE

**Files changed**:
- `src/adapter/copilot-types.ts`
- `src/adapter/sdk-copilot.ts`
- `test/adapter/sdk-copilot.test.ts`

**Implementation**:
- Extended the local SDK facade with `ICopilotSession.send(...)`.
- Replaced the `run()` path's `sendAndWait` call with `session.send(...)` plus an idle Promise resolved by `session.idle` / `session_idle`.
- Rejected the idle Promise on `session.error` / `session_error`, returning a failed `AgentResult` rather than hanging.
- Captured and invoked the session event unsubscribe function in `finally` before `session.disconnect()`.
- Added an `idleSettled` guard so duplicate idle events are emitted but settle the Promise only once.
- Invoked `onSessionReady` after the initial `session.send` is issued, passing a bound sender that records the live session-send seam for P3.
- Left `compact()` and `terminate()` unchanged.

**Evidence**:
```bash
npx vitest run test/adapter/sdk-copilot.test.ts
# 4 tests passed

npx tsc --noEmit
# exit 0
```

**Discovery**: `ICopilotSession` needed an explicit `send()` member in the local facade; without it the adapter would either reach into SDK internals or keep a hidden `any` seam.

---

### T003 — Extend FakeAgentAdapter

**Status**: `[x]` DONE

**Files changed**:
- `src/adapter/fake.ts`
- `test/adapter/fake.test.ts`

**Implementation**:
- Added `emitSessionIdle()`.
- Added `setQueuedRun(turns)` that emits each turn followed by `session_idle`.
- Added `emitPendingMessagesModified(queueDepth)` as a fake-only raw event.
- Added `onSessionReady` support in `run()` with a sender that records prompts.
- Added `getSessionSendHistory()`.
- Preserved existing event helpers and runner-test behavior.

**Evidence**:
```bash
npx vitest run test/adapter/fake.test.ts test/runner/runner.test.ts
# 36 tests passed

npx tsc --noEmit
# exit 0
```

**Discovery**: `setQueuedRun` auto-inserts idle events to make callers describe logical turns instead of SDK lifecycle boilerplate.

---

### T004 — Create preamble-builder

**Status**: `[x]` DONE

**Files changed**:
- `src/runner/preamble-builder.ts`
- `test/runner/preamble-builder.test.ts`

**Implementation**:
- Added `PreambleAssemblyInput` and `buildInsidePreamble`.
- Preserved the disabled path as the exact old inline join order.
- Added identity/tools/peer-contract stub sections for `coordination.enabled`.
- Blockquote-framed `outsideContract` under `## Peer's Contract (from outside.md)`.
- Added JSDoc requiring callers not to use the builder for resume turns.

**Evidence**:
```bash
npx vitest run test/runner/preamble-builder.test.ts
# 5 tests passed

npx tsc --noEmit
# exit 0
```

**Discovery**: Enabled coordination prompt order can follow workshop 008 without changing any current agent because the disabled branch is pinned byte-for-byte against the pre-T005 inline assembly.

---

### T005 — Refactor runner.ts

**Status**: `[x]` DONE

**Files changed**:
- `src/runner/runner.ts`

**Implementation**:
- Imported and used `buildInsidePreamble` in the fresh-run branch.
- Left the resume branch sending only the follow-up prompt.
- Passed `onSessionReady: () => {}` through `adapter.run()` as the P2 placeholder for P3 forwarder wiring.

**Evidence**:
```bash
npx vitest run test/runner/runner.test.ts test/runner/preamble-builder.test.ts
# 21 tests passed

npx tsc --noEmit
# exit 0
```
