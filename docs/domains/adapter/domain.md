# Domain: adapter

**Purpose**: Wraps `@github/copilot-sdk` behind a clean interface (`IAgentAdapter`), translating SDK-specific events into a unified `AgentEvent` discriminated union.

## Boundary

**Owns**: IAgentAdapter interface, SdkCopilotAdapter implementation, AgentEvent union types, AgentResult structure, FakeAgentAdapter test double, session creation/termination, permission auto-approval

**Excludes**: Prompt assembly (runner), CLI concerns (cli), schema validation (runner)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/adapter/events.ts` | contract | AgentEvent union (10 types), AgentResult, AgentRunOptions, SessionSender, TokenMetrics |
| `src/adapter/interface.ts` | contract | IAgentAdapter — run(), compact(), terminate() |
| `src/adapter/copilot-types.ts` | contract | Local Copilot SDK facade — ICopilotClient, ICopilotSession with send/sendAndWait, session configs |
| `src/adapter/fake.ts` | internal | FakeAgentAdapter test double with event-driven queued-run/session-ready helpers |
| `src/adapter/sdk-copilot.ts` | internal | SdkCopilotAdapter — wraps @github/copilot-sdk; run() uses session.send + session_idle |
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
| `SdkCopilotAdapter` | Class | cli (composition root), external programmatic consumers |
| `ICopilotClient` / `ICopilotSession` | Interface | cli (SDK client wiring), adapter tests/fakes |

## Concepts

| Concept | Definition |
|---------|-----------|
| Adapter pattern | Runner is adapter-agnostic; accepts IAgentAdapter. Tests inject FakeAgentAdapter, prod uses SdkCopilotAdapter. |
| Event translation | SDK-specific events mapped to stable AgentEvent union so consumers never see SDK internals. |
| Auto-approve | All agent permissions auto-approved (yolo). No safety gates. |
| Local Copilot facade | `copilot-types.ts` defines the subset of SDK types the adapter depends on, so the rest of minih avoids SDK internals. |
| Duplicate suppression | SDK emits deltas during streaming then re-emits consolidated content; adapter suppresses the duplicates. |
| Event-driven run | `run()` sends the initial prompt with `session.send`, streams events through `onEvent`, and resolves on `session_idle`; `compact()` remains a terminal `sendAndWait` call. |
| Session sender seam | `AgentRunOptions.onSessionReady` receives a `SessionSender` after the initial send so future forwarders can queue mid-turn messages without importing SDK-specific adapter internals. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Events, interface, FakeAgentAdapter extracted. |
| Phase 3 | Added SdkCopilotAdapter (~250 LOC), copilot-types.ts (local SDK interfaces). Event translation, permission auto-approval, prompt validation, duplicate suppression. |
| 002-pretty-mode | Added `isDelta?: boolean` to `AgentThinkingEvent.data`. Adapter sets `true` for `reasoning_delta`, `false` for `reasoning` — enables pretty display to suppress duplicate thinking finals. |
| 003-resume-prompt | Switched `run()` from `session.destroy()` to `session.disconnect()` — sessions preserved for resumption. |
| 007/P2 (2026-04-26) | Switched `SdkCopilotAdapter.run()` to event-driven `session.send` + idle subscription; added `SessionSender`/`onSessionReady`; extended `FakeAgentAdapter` with queued-run and session-send test helpers. |
