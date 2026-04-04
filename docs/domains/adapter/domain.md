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
| `src/adapter/fake.ts` | internal | FakeAgentAdapter test double |
| `src/adapter/sdk-copilot.ts` | internal | SdkCopilotAdapter (Phase 3) |
| `src/adapter/index.ts` | contract | Barrel export |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `IAgentAdapter` | Interface | runner (via injection), cli (composition root) |
| `AgentEvent` | Discriminated union | runner (event handling, NDJSON), cli (display) |
| `AgentResult` | Type | runner (result processing) |
| `AgentRunOptions` | Type | runner (adapter invocation) |

## Concepts

| Concept | Definition |
|---------|-----------|
| Adapter pattern | Runner is adapter-agnostic; accepts IAgentAdapter. Tests inject FakeAgentAdapter, prod uses SdkCopilotAdapter. |
| Event translation | SDK-specific events mapped to stable AgentEvent union so consumers never see SDK internals. |
| Auto-approve | All agent permissions auto-approved (yolo). No safety gates. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Events, interface, FakeAgentAdapter extracted. |
| Phase 3 | Added SdkCopilotAdapter (~250 LOC), copilot-types.ts (local SDK interfaces). Event translation, permission auto-approval, prompt validation, duplicate suppression. |
