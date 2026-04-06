# Domain: adapter

**Purpose**: Wraps `@github/copilot-sdk` behind a clean interface (`IAgentAdapter`), translating SDK-specific events into a unified `AgentEvent` discriminated union.

## Boundary

**Owns**: IAgentAdapter interface, SdkCopilotAdapter implementation, AgentEvent union types, AgentResult structure, FakeAgentAdapter test double, session creation/termination, permission auto-approval

**Excludes**: Prompt assembly (runner), CLI concerns (cli), schema validation (runner)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/adapter/events.ts` | contract | AgentEvent union (10 types), AgentResult, AgentRunOptions, TokenMetrics |
| `src/adapter/interface.ts` | contract | IAgentAdapter — run(), compact(), terminate() |
| `src/adapter/copilot-types.ts` | contract | Local Copilot SDK facade — ICopilotClient, ICopilotSession, session configs |
| `src/adapter/fake.ts` | internal | FakeAgentAdapter test double |
| `src/adapter/sdk-copilot.ts` | internal | SdkCopilotAdapter — wraps @github/copilot-sdk |
| `src/adapter/index.ts` | contract | Barrel export |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `IAgentAdapter` | Interface | runner (via injection), cli (composition root) |
| `AgentEvent` | Discriminated union | runner (event handling, NDJSON), cli (display) |
| `AgentThinkingEvent.data.isDelta` | Field | runner/pretty.ts (delta vs final suppression) |
| `AgentResult` | Type | runner (result processing) |
| `AgentRunOptions` | Type | runner (adapter invocation) |
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

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Events, interface, FakeAgentAdapter extracted. |
| Phase 3 | Added SdkCopilotAdapter (~250 LOC), copilot-types.ts (local SDK interfaces). Event translation, permission auto-approval, prompt validation, duplicate suppression. |
| 002-pretty-mode | Added `isDelta?: boolean` to `AgentThinkingEvent.data`. Adapter sets `true` for `reasoning_delta`, `false` for `reasoning` — enables pretty display to suppress duplicate thinking finals. |
| 003-resume-prompt | Switched `run()` from `session.destroy()` to `session.disconnect()` — sessions preserved for resumption. |
