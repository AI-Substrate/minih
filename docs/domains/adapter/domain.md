# Domain: adapter

**Purpose**: Wraps `@github/copilot-sdk` behind a clean interface (`IAgentAdapter`), translating SDK-specific events into a unified `AgentEvent` discriminated union.

## Boundary

**Owns**: IAgentAdapter interface, SdkCopilotAdapter implementation, AgentEvent union types, AgentResult structure, FakeAgentAdapter test double, session creation/termination, permission auto-approval

**Excludes**: Prompt assembly and terminal-condition policy (runner), CLI concerns and SDK bootstrap (cli), schema validation and coordination file forwarders (runner), MCP server/tool implementation (mcp)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/adapter/events.ts` | contract | AgentEvent union (13 types incl. `permission_denied`, `provider_stream_aborted`), AgentResult, AgentRunOptions, SessionSender, TokenMetrics |
| `src/adapter/interface.ts` | contract | IAgentAdapter — run(), compact(), terminate() |
| `src/adapter/copilot-types.ts` | contract | Local Copilot SDK facade — ICopilotClient, ICopilotSession with send/sendAndWait, session configs |
| `src/adapter/fake.ts` | internal | FakeAgentAdapter test double with event-driven queued-run/session-ready helpers |
| `src/adapter/sdk-copilot.ts` | internal | SdkCopilotAdapter — wraps @github/copilot-sdk; run() uses session.send + session_idle |
| `src/adapter/deadline.ts` | contract | `withDeadline` + `DEADLINE_EXPIRED` — deadline-bounding for SDK cleanup awaits (plan 026) |
| `src/adapter/index.ts` | contract | Barrel export |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `IAgentAdapter` | Interface | runner (via injection), cli (composition root) |
| `AgentEvent` | Discriminated union | runner (event handling, NDJSON), cli (display) |
| `AgentThinkingEvent.data.isDelta` | Field | runner/pretty.ts (delta vs final suppression) |
| `AgentResult` | Type | runner (result processing) |
| `AgentRunOptions` | Type | runner (adapter invocation) |
| `SessionSender` | Type | runner/P3 forwarders (`onSessionReady` live session.send handle) |
| `SdkCopilotAdapter` / `SdkCopilotAdapterOptions` | Class/Type | cli (composition root), external programmatic consumers; options carry the injectable `cleanupRungTimeoutMs` bound (plan 026) |
| `ICopilotClient` / `ICopilotSession` | Interface | cli (SDK client wiring), adapter tests/fakes — SDK 1.0.1 shape: no `session.destroy()`, optional `client.forceStop?()` (plan 026) |
| `withDeadline(promise, ms, onTimeout?)` / `DEADLINE_EXPIRED` | Function/Sentinel | adapter cleanup rungs, runner kill path (bounding `adapter.terminate()`) — plan 026 |
| `AgentStalledEvent` (`run_stalled`) | Event type | runner (synthetic watchdog diagnosis — emitted by the runner, rendered by pretty) — plan 026 |

## Concepts

| Concept | Definition |
|---------|-----------|
| Adapter pattern | Runner is adapter-agnostic; accepts IAgentAdapter. Tests inject FakeAgentAdapter, prod uses SdkCopilotAdapter. |
| Event translation | SDK-specific events mapped to stable AgentEvent union so consumers never see SDK internals. |
| Auto-approve | All agent permissions auto-approved (yolo). No safety gates. |
| Local Copilot facade | `copilot-types.ts` defines the subset of SDK types the adapter depends on, so the rest of minih avoids SDK internals. |
| Duplicate suppression | SDK emits deltas during streaming then re-emits consolidated content; adapter suppresses the duplicates. |
| Event-driven run | `run()` sends the initial prompt with `session.send`, streams events through `onEvent`, and resolves on the first `session_idle`; `compact()` remains a terminal `sendAndWait` call. |
| Session error handling | If `session_error` arrives before idle, the adapter emits a normalized `session_error` event and returns `AgentResult.status: 'failed'` instead of hanging. |
| Subscription cleanup | The SDK event subscription is captured and unsubscribed in `finally`; sessions disconnect after `run()`/`compact()` to preserve resume state. |
| Session sender seam | `AgentRunOptions.onSessionReady` receives a `SessionSender` after the initial send is queued so runner forwarders can send mid-run peer updates without importing SDK-specific adapter internals. |
| Fake queued-run seam | `FakeAgentAdapter.setQueuedRun()` emits per-turn event batches plus `session_idle`, and records `SessionSender.send()` calls for runner terminal-condition tests. |
| Bounded cleanup ladder | Plan 026: every SDK cleanup await (terminate rungs, run/compact `finally` disconnects) is deadline-bounded via `withDeadline`; a hung or rejected terminate rung escalates to `client.forceStop?.()`. Terminal artifacts never depend on SDK cooperation. |

## Tests & Validation

| Area | Tests |
|------|-------|
| SDK event translation and event-driven lifecycle | `test/adapter/sdk-copilot.test.ts` |
| Bounded cleanup ladder + forceStop escalation (hung sessions) | `test/adapter/sdk-copilot.test.ts` (terminate describe), `test/adapter/deadline.test.ts` |
| Fake adapter run history, queued runs, and session sender seam | `test/adapter/fake.test.ts` |
| Runner-facing event-driven integration | `test/runner/runner-event-driven.test.ts` |
| SDK permission/version shape pin (bump canary) | `test/adapter/sdk-permission-shapes.test.ts` |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Events, interface, FakeAgentAdapter extracted. |
| Phase 3 | Added SdkCopilotAdapter (~250 LOC), copilot-types.ts (local SDK interfaces). Event translation, permission auto-approval, prompt validation, duplicate suppression. |
| 002-pretty-mode | Added `isDelta?: boolean` to `AgentThinkingEvent.data`. Adapter sets `true` for `reasoning_delta`, `false` for `reasoning` — enables pretty display to suppress duplicate thinking finals. |
| 003-resume-prompt | Switched `run()` from `session.destroy()` to `session.disconnect()` — sessions preserved for resumption. |
| 007/P2 (2026-04-26) | Switched `SdkCopilotAdapter.run()` to event-driven `session.send` + idle subscription; added `SessionSender`/`onSessionReady`; extended `FakeAgentAdapter` with queued-run and session-send test helpers. |
| 007-backgrounding P7 | Finalized adapter documentation for event-driven idle/error behavior, subscription cleanup, session sender seams, fake queued-run tests, and no runner/MCP ownership. |
| 018-agent-permissions R1 | NARROWED `copilot-types.ts:onPermissionRequest` from `() => {kind: string}` to the real SDK 0.3.0 `PermissionHandler` shape with pinned `CopilotPermissionKind` string-literal union (`shell`/`write`/`mcp`/`read`/`url`/`custom-tool`/`memory`/`hook`) and `CopilotPermissionDecision` (`approve-once`|`reject` with optional `feedback`). NEW `AgentPermissionDeniedEvent` in `events.ts:AgentEvent` union — fired when wrapper handler returns `reject`. NEW `AgentRunOptions.permissionHandler?` optional field — structural type so runner can wire without importing copilot-types directly. EXTENDED `sdk-copilot.ts:run` to wrap user-supplied `permissionHandler` (idempotent on requestId via `deniedRequestIds: Set<string>`) and emit `permission_denied` events through `onEvent`. **4× `approveAll` call sites preserved as fallback** at lines 22 (const), 64 (createSession), 56 (resumeSession), 197 (compact resumeSession), 235 (terminate resumeSession): when no `permissionHandler` passed → fallback to `approveAll` for backward-compat with un-migrated agents. New `test/adapter/sdk-permission-shapes.test.ts` (T-R1.14) snapshots the SDK 0.3.0 union; failure points at the renamed name with explicit guidance. Domain rule preserved: `adapter` only imports SDK + own types. |
| 025-dead-pid-liveness | Stream-abort diagnosis (FX012): NEW `AgentProviderStreamAbortedEvent` (`{messageId?, reason}`) in the `AgentEvent` union. `sdk-copilot.run()` tracks the LATEST in-flight message (delta sets it; consolidated message — including the dup-suppressed branch — and idle clear it) and emits `provider_stream_aborted` exactly once from the catch path when the stream dies unsettled, ordered before the generic `session_error`; pre-stream failures emit nothing new. `FakeAgentAdapter.setQueuedRun(turns, {suppressFinalIdle})` seam lets tests simulate never-settling aborted streams (earlier turns keep auto-idle). |
| 026-stall-watchdog | Bounded cleanup + SDK 1.0.1. NEW `deadline.ts` (contract): `withDeadline(promise, ms, onTimeout?)` resolves to the `DEADLINE_EXPIRED` sentinel on expiry (never throws raw, clears + unrefs its timer, swallows the abandoned promise's late rejection); consumed by the runner's kill path (runner→adapter direction already existed). `SdkCopilotAdapter` gains `SdkCopilotAdapterOptions.cleanupRungTimeoutMs` (default 5000ms; tests inject ~20ms) + private `_boundedRung()`; `terminate()` rewritten as the bounded ladder resume → abort → disconnect with escalation to `client.forceStop?.()` (SIGKILL on the CLI subprocess — the only rung that can't hang on RPC) on any hung/rejected rung; run()/compact() `finally` disconnects bounded. Mirror updated for SDK 1.0.1: `ICopilotSession.destroy()` REMOVED (1.0.1 moved deletion to `client.deleteSession`; the old runtime call would have thrown TypeError silently absorbed by try/catch), `ICopilotClient.forceStop?()` added (optional — absent client shapes skip escalation gracefully). NEW `AgentStalledEvent` (`run_stalled`, `{stallTimeoutSec, lastEventAt?}`) in the `AgentEvent` union — synthetic, emitted by the RUNNER's watchdog race arm, never by the adapter. `FakeAgentAdapter` gains opt-in `hangOnTerminate` option + `setTerminateHang()`. `@github/copilot-sdk` pinned 1.0.1 (devDep exact). NEW `test/adapter/deadline.test.ts` (7) + 6 hung-session/forceStop tests in sdk-copilot.test.ts. |
| 026 fix pass (review F001) | Consolidated-message suppression REMOVED from `sdk-copilot.run()`: after streaming deltas, the consolidated `assistant.message` now flows through `translateEvent`/`onEvent` as the single turn-accounting `message` event the runner counts for `--max-turns` (it was suppressed since Phase 3, so streamed turns never counted and `view`'s coalescing model never saw turn finalization). Display dedup is downstream by design: `pretty.ts` (`inDeltaStream`/`lastDeltaMessageId`), `human-view-model.ts` (messageId coalescing), `display.ts` (char-count line). Reasoning-duplicate suppression unchanged. Adapter test pins exactly one `message` per streamed turn. |
