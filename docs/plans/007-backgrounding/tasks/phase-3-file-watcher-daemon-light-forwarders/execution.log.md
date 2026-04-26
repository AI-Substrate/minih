# Execution Log — Phase 3: File Watcher + Daemon-Light Forwarders

**Plan**: [coordination-plan.md](../../coordination-plan.md)
**Phase**: Phase 3: File Watcher + Daemon-Light Forwarders
**Started**: 2026-04-26

---

## Pre-Phase Validation

| Check | Result | Evidence |
|-------|--------|----------|
| Harness | Not configured | `docs/project-rules/harness.md` is absent; standard testing applies. |
| Baseline tests | PASS | `npm test -- --run` passed before source edits: 254 passed, 3 skipped. |

---

## T001 — File watcher

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Implement `src/runner/file-watcher.ts` and `test/runner/file-watcher.test.ts` with debounced `node:fs.watch` delivery, missing-path startup behavior, watcher error handling, atomic-rename tolerance, and idempotent close semantics.

**Implementation**:

- Added `watchFileChanges()` in the runner domain. It watches the parent directory, filters target filenames, coalesces native events with a debounce timer, exposes `flush()` for deterministic drains, and keeps `close()` idempotent.
- Added error handling for startup failures and native watcher `error` events. Errors after close are ignored so stale native events cannot leak into later test or runner lifecycle.
- Added deterministic unit coverage with an injectable watch factory for missing target files, unrelated filename filtering, null filename conservative hints, debounce bursts, flush, close semantics, watcher errors, and startup failures.

**Evidence**:

- `npx vitest run test/runner/file-watcher.test.ts` — PASS, 7 tests.
- `npm run build` — PASS.

**Discovery**: Native `fs.watch` is path-existence sensitive for file targets, so the primitive watches the parent directory to support missing-file startup and atomic rename/first-write creation.

---

## T002 — Forwarder watermark helper

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Implement `src/runner/forwarder-watermark.ts` and `test/runner/forwarder-watermark.test.ts` with private durable progress for inbox byte offsets and state fingerprints, explicit corrupt-data recovery, symlink containment, and atomic writes.

**Implementation**:

- Added private forwarder watermark helpers: `readForwarderWatermark()`, `writeForwarderWatermark()`, `updateForwarderWatermark()`, `withInboxOffset()`, and `withStateFingerprint()`.
- Kept the persisted shape private while supporting the required durable outcomes: inbox byte-offset progress for torn-line retry and outside-state fingerprint progress for send-failure retry.
- Added `assertPathInsideAgentsDir()` with lexical and realpath containment checks so watermark symlinks or parent-directory symlinks cannot escape `agentsDir`.
- Defined corrupt watermark recovery as a Phase 3 internal rule: return default progress plus `recoveredFromCorruption` and `recoveryReason`.

**Evidence**:

- `npx vitest run test/runner/forwarder-watermark.test.ts` — PASS, 8 tests.
- `npm run build` — PASS.

**Discovery**: Symlink escape prevention must inspect the nearest existing real path, not just the final lexical target, because the `state/` directory or `sdk-watermark.json` itself can be a symlink.

---

## T003 — Inbox forwarder

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Implement `src/runner/inbox-forwarder.ts` and `test/runner/inbox-forwarder.test.ts` so outside inbox NDJSON lines are parsed in byte-offset order, rendered into session prompts, sent through `SessionSender.send`, and committed to the watermark only after successful sends.

**Implementation**:

- Added `createInboxForwarder()` with queued `drain()` execution, pending-drain counting, and close semantics.
- Added byte-offset NDJSON scanning from `inbox/outside/messages.ndjson`; complete lines are parsed and sent in order, while an unterminated final line is left uncommitted for retry.
- Added `renderInboxMessageForAgent()` to convert a valid outside inbox message into a prompt for `SessionSender.send`.
- Advanced the inbox watermark only after each individual `send()` resolves, so send failures retry from the failed line while preserving earlier successful progress.
- Applied `assertPathInsideAgentsDir()` to the inbox path before reading so symlink escapes are rejected.

**Evidence**:

- `npx vitest run test/runner/inbox-forwarder.test.ts` — PASS, 9 tests.
- `npm run build` — PASS.

**Discovery**: Torn final lines are not parse errors; they are incomplete writes and should wait for a later drain. Complete malformed lines are errors and must stop progress without advancing their byte range.

---

## T004 — State forwarder

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Implement `src/runner/state-forwarder.ts` and `test/runner/state-forwarder.test.ts` so outside state changes are fingerprinted, rendered into concise session prompts, sent only when changed, and committed to the watermark only after `SessionSender.send` succeeds.

**Implementation**:

- Added `createStateForwarder()` with queued `drain()` execution, pending-drain counting, and close semantics.
- Added `fingerprintOutsideState()` using stable JSON over `status` and `data` so meaningful state changes are forwarded while `updatedAt`-only touches do not produce spurious sends.
- Added `renderStateChangeForAgent()` to send concise outside-state prompts through `SessionSender.send`.
- Persisted `state.outsideFingerprint` only after successful sends, preserving retry behavior on failure.
- Applied `assertPathInsideAgentsDir()` to `state/outside.json` before reading and continued to surface `StateCorruptError` from `readStateLazy()`.

**Evidence**:

- `npx vitest run test/runner/state-forwarder.test.ts` — PASS, 9 tests.
- `npm run build` — PASS.

**Discovery**: `readStateLazy()` produces a synthetic default with a fresh timestamp for absent files, so the forwarder checks physical file existence first to avoid spurious first-run state sends.

---

## T005 — Cold-start drain orchestration

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Extend inbox/state forwarders with a start lifecycle that drains durable backlog before installing live file watchers, then uses watcher events to enqueue subsequent drains without re-forwarding already-watermarked work.

**Implementation**:

- Added `start()` to both forwarders. It drains existing durable backlog first, then creates the `watchFileChanges()` subscription, then performs one immediate post-subscribe drain to catch writes that land between cold drain completion and watcher creation.
- Added watcher-triggered live drains for inbox and state changes, with async errors routed through an explicit `onError` callback when provided.
- Added close handling that shuts down the file watcher and prevents future drains from doing work.
- Extended forwarder tests to assert cold backlog sends occur before watcher subscription and live watcher events enqueue subsequent sends.

**Evidence**:

- `npx vitest run test/runner/inbox-forwarder.test.ts test/runner/state-forwarder.test.ts` — PASS, 20 tests.
- `npm run build` — PASS.

**Discovery**: The drain-first/subscribe-second ordering avoids live watcher callbacks racing ahead of backlog sends, but an immediate post-subscribe drain is needed to avoid missing writes in the subscription gap.

---

## T008 — Single-run guard

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Implement `src/runner/run-lock.ts` and `test/runner/run-lock.test.ts` with an exclusive per-agent lock, typed conflict error for later CLI mapping, stale-lock recovery, and idempotent release suitable for `finally` cleanup in `runAgent`.

**Implementation**:

- Added `acquireRunLock()`, `withRunLock()`, and `runLockPath()` in the runner domain.
- Added typed `RunLockHeldError` with `code = RUN_LOCK_HELD`, `slug`, and `lockPath` for later CLI envelope mapping without introducing CLI imports.
- Implemented exclusive lock creation with `openSync(..., 'wx')`, stale-lock replacement, owner-token release, idempotent release, and symlink containment checks.

**Evidence**:

- `npx vitest run test/runner/run-lock.test.ts` — PASS, 8 tests.
- `npm run build` — PASS.

**Discovery**: Release must compare an owner token before unlinking so a stale/replaced lock cannot be removed by an older run's `finally` block.

---

## T006 — Runner lifecycle wiring

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Replace the Phase 2 runner placeholders by acquiring the per-agent run lock, attaching inbox/state forwarders through `onSessionReady`, exposing their live pending count to the terminal condition, and closing all forwarder resources in terminal paths.

**Implementation**:

- Replaced the Phase 2 `onSessionReady: () => {}` placeholder with `startForwarders(sender)` for coordination-enabled agents.
- Created inbox/state forwarders using the live `SessionSender`, acquired the per-agent run lock before watcher startup, and routed async forwarder errors back into runner failure handling.
- Replaced the zero pending getter with a live sum of inbox/state forwarder pending drain counts.
- Added idempotent cleanup for forwarders and run locks on adapter completion and in the outer timeout/failure cleanup path.
- Added runner tests for coordinated cold-start inbox/state sends, empty coordinated no-op runs, and lock release after timeout.

**Evidence**:

- `npx vitest run test/runner/runner-event-driven.test.ts` — PASS, 7 tests.
- `npm run build` — PASS.

**Discovery**: Adapter timeout races can leave the adapter promise alive briefly, so the runner must close forwarders from its own outer `finally` instead of relying only on the adapter promise's `finally`.

---

## T007 — Terminal drain count

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Extend event-driven runner tests to prove the terminal condition uses the live forwarder pending count: adapter completion/idle must wait for queued `SessionSender.send` work, and timeout must still terminate and clean up when a forwarder send never resolves.

**Implementation**:

- Added a targeted `PendingSendAdapter` test double that reports `session_start`/`session_idle`, then keeps `SessionSender.send` unresolved until the test releases it.
- Added runner tests proving coordinated runs remain unsettled after adapter idle while forwarder sends are pending, then complete once the pending send resolves.
- Added timeout coverage proving the runner timeout still terminates the active session when forwarder sends never drain.

**Evidence**:

- `npx vitest run test/runner/runner-event-driven.test.ts` — PASS, 9 tests.
- `npm run build` — PASS.

**Discovery**: The terminal condition must model runner-owned forwarder work, not just adapter lifecycle; otherwise idle can finish before the queued session turn is actually delivered.

---

## T009 — Opt-in daemon-light e2e

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Add `test/e2e/daemon-light.test.ts` as an opt-in `MINIH_E2E=1` gate that starts a coordinated run, launches a sibling Node process to write outside inbox/state files, and proves native watcher events reach the live `SessionSender`.

**Implementation**:

- Added `test/e2e/daemon-light.test.ts`, skipped by default unless `MINIH_E2E=1`.
- The e2e creates a coordination-enabled agent, starts `runAgent` with an in-process adapter that owns the live `SessionSender`, then spawns a sibling Node process to append outside inbox and write outside state.
- The adapter waits up to 5 seconds for both forwarded prompts, proving native file watcher events and forwarder drains deliver to the active session.
- Documented the focused opt-in command in `CONTRIBUTING.md`.

**Evidence**:

- `npx vitest run test/e2e/daemon-light.test.ts` — PASS with 1 skipped test by default.
- `MINIH_E2E=1 npx vitest run test/e2e/daemon-light.test.ts` — PASS, 1 test.
- `npm run build` — PASS.

**Discovery**: A sibling writer process plus an in-process adapter is enough to validate the daemon-light contract without adding process-manager or daemon commands in Phase 3.

---

## T010 — Exports, docs, and quality gates

**Status**: Complete.

**Started**: 2026-04-26.

**Plan**: Export only deliberate public runner contracts from Phase 3, update runner domain docs and plan-level flight status, then run the default and opt-in gates before Phase 3 is marked landed.

**Implementation**:

- Exported only the new public Phase 3 runner error surface: `RunLockHeldError` and `RUN_LOCK_HELD`.
- Kept file watcher, watermark, inbox forwarder, and state forwarder modules internal so their private shapes can evolve through P6/P7.
- Updated `docs/domains/runner/domain.md` composition, contracts, concepts, and history for Phase 3.
- Updated `docs/domains/domain-map.md`, `CONTRIBUTING.md`, the phase flight plan, and the plan-level flight plan.

**Evidence**:

- `npm test -- --run` — PASS, 302 tests passed, 4 skipped.
- `MINIH_E2E=1 npx vitest run test/e2e/daemon-light.test.ts` — PASS, 1 test.
- `just fft` — PASS, including Biome, build, typecheck, tests, and audit.
- `MINIH_E2E=1 npx vitest run test/e2e/daemon-light.test.ts` — PASS after final formatting, 1 test.

**Discovery**: The only Phase 3 surface that needs to be public immediately is the typed run-lock conflict signal; exporting forwarder internals now would freeze implementation details that Phase 6 prompting and Phase 7 docs may still refine.

---

## Post-Phase Minih Code Review

**Status**: Complete.

**Command**: `node dist/cli/index.js run code-review --timeout 1200 -p context='Review Phase 3 of docs/plans/007-backgrounding: File Watcher + Daemon-Light Forwarders...'`

**Report**: `/Users/jordanknight/substrate/minih/agents/code-review/runs/2026-04-26T18-01-49-596Z-d85d/output/report.json`

**Initial verdict**: `REQUEST_CHANGES`.

**Findings fixed**:

- `CR-001` (HIGH durability): forwarders committed `sdk-watermark.json` after `SessionSender.send()` resolved even if the run later timed out. Fixed by adding manual commit mode for runner-owned forwarders and committing progress only after a completed terminal result.
- `CR-002` (HIGH terminal-drain): debounced watcher hints were invisible to the terminal condition. Fixed by adding `FileWatcher.pendingCount()` and including scheduled watcher callbacks in forwarder pending counts.

**Post-fix evidence**:

- `npx vitest run test/runner/file-watcher.test.ts test/runner/inbox-forwarder.test.ts test/runner/state-forwarder.test.ts test/runner/runner-event-driven.test.ts` — PASS, 39 tests.
- `npm run build` — PASS.
- `just fft` — PASS after formatting, 305 tests passed, 4 skipped, zero audit vulnerabilities.
- `MINIH_E2E=1 npx vitest run test/e2e/daemon-light.test.ts` — PASS, 1 test.
