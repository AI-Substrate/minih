# Phase 3: SDK Adapter — Tasks

**Plan**: [miniharness-extraction-plan.md](../../miniharness-extraction-plan.md)
**Phase**: Phase 3: SDK Adapter
**Generated**: 2026-04-03
**Status**: Ready for implementation

---

## Executive Briefing

**Purpose**: Extract the `SdkCopilotAdapter` — the only code that touches `@github/copilot-sdk` — into minih's adapter domain. This is the bridge between the adapter-agnostic runner (Phase 2) and the real SDK. After this phase, minih can execute agents for real (once the CLI wires it up in Phase 4).

**What We're Building**: `SdkCopilotAdapter` class that implements `IAgentAdapter`, plus the SDK interface types (`ICopilotClient`, `ICopilotSession`) that describe what the SDK provides. The adapter translates SDK events to our `AgentEvent` union, auto-approves all permissions (yolo), suppresses duplicate consolidated events, and validates prompts.

**Goals**:
- ✅ `SdkCopilotAdapter` compiles with zero `@chainglass/*` imports
- ✅ Event translation covers all SDK event types → AgentEvent union
- ✅ Permission auto-approval (yolo — all tool requests approved)
- ✅ Duplicate event suppression (streamed deltas then consolidated message)
- ✅ Prompt validation (empty, oversized, control characters)
- ✅ SDK interface types inlined locally (ICopilotClient, ICopilotSession)
- ✅ `just fft` passes

**Non-Goals**:
- ❌ No CLI commands (Phase 4)
- ❌ No unit tests for SdkCopilotAdapter (requires real SDK — test via FakeAgentAdapter)
- ❌ No multi-backend support (copilot-only for V1)
- ❌ No logger integration (strip ILogger — use console.log for debug)

---

## Prior Phase Context

### Phase 1: Project Scaffold + Types
- **Deliverables**: All type definitions, FakeAgentAdapter, build pipeline
- **Available**: `AgentEvent` union, `IAgentAdapter`, `AgentResult`, `AgentRunOptions`, barrel exports
- **Pattern**: Plain TS types (no zod), ESM with `.js` extensions

### Phase 2: Runner Core
- **Deliverables**: folder.ts, validator.ts, display.ts, runner.ts, retrospective.json
- **Available**: `runAgent()` accepts `IAgentAdapter` — adapter-agnostic
- **Pattern**: Runner never imports SDK — adapter injected at composition root (Phase 4)

---

## Pre-Implementation Check

| File | Exists? | Domain | Notes |
|------|---------|--------|-------|
| `src/adapter/sdk-copilot.ts` | ❌ create | adapter | Extract from source (~530 LOC). Drop ILogger, inline SDK types. |
| `src/adapter/copilot-types.ts` | ❌ create | adapter | ICopilotClient, ICopilotSession, event types — local interfaces for SDK |
| `src/adapter/index.ts` | ✅ modify | adapter | Add SdkCopilotAdapter export |
| `package.json` | ✅ modify | — | Add @github/copilot-sdk as devDependency for compilation |

No concept duplication. No harness available.

---

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Install @github/copilot-sdk as devDependency | — | `package.json` | `npm install --save-dev @github/copilot-sdk` succeeds. SDK available for type resolution at build time. Remains as peerDependency for consumers. | User confirmed SDK access. |
| [ ] | T002 | Create src/adapter/copilot-types.ts | adapter | `src/adapter/copilot-types.ts` | ICopilotClient, ICopilotSession, CopilotSessionConfig, CopilotResumeSessionConfig, CopilotSessionEventLike, CopilotReasoningEffort — local interfaces mirroring SDK shapes. No SDK import required. | Source: packages/shared/src/interfaces/copilot-sdk.interface.ts. Extract only the types the adapter uses. Drop model listing, status, billing types (not needed for V1). |
| [ ] | T003 | Create src/adapter/sdk-copilot.ts | adapter | `src/adapter/sdk-copilot.ts` | SdkCopilotAdapter implements IAgentAdapter. Event translation for all SDK event types → AgentEvent. Auto-approve permissions. Duplicate event suppression. Prompt validation. Session create/resume/abort/destroy lifecycle. | Source: packages/shared/src/adapters/sdk-copilot-adapter.ts (~530 LOC). Adaptations: replace @chainglass/shared imports with local types, drop ILogger (use console.log), drop workspaceRoot validation (minih doesn't need it), simplify constructor to just `(client: ICopilotClient)`. |
| [ ] | T004 | Update adapter barrel export | adapter | `src/adapter/index.ts` | Export `SdkCopilotAdapter` and `ICopilotClient`, `ICopilotSession` types from barrel. | CLI composition root will import these in Phase 4. |
| [ ] | T005 | Verify build + fft | — | — | `just fft` passes. `npm run build` succeeds. No @chainglass/* imports in src/. All 63 existing tests still pass. | Final gate. Biome lint must pass too. |

---

## Context Brief

**Key findings from plan**:
- Finding 01: SDK lazy-loaded via dynamic import — the adapter file imports from the SDK at the top level, but the CLI only dynamically imports the adapter in the `run` command (Phase 4)
- Finding 02: AgentEvent union fully expanded in Phase 1 — adapter translates SDK events to these types
- Finding 05: Zod dropped — adapter uses plain TS types for SDK interfaces

**Domain dependencies**:
- `adapter`: AgentEvent union (`src/adapter/events.ts`) — adapter translates TO these types
- `adapter`: IAgentAdapter (`src/adapter/interface.ts`) — adapter implements this
- `adapter`: AgentResult, AgentRunOptions (`src/adapter/events.ts`) — adapter consumes/returns these

**Domain constraints**:
- All Phase 3 code lives in `src/adapter/` — adapter domain only
- The adapter is the ONLY code that imports `@github/copilot-sdk` types
- The adapter imports from local `./events.ts`, `./interface.ts`, `./copilot-types.ts` — never from `@chainglass/shared`

**Source adaptation notes**:
- **Drop ILogger**: Source adapter accepts optional logger. Minih uses `console.log` for debug output (can be refined later).
- **Drop workspaceRoot validation**: Source validates cwd against workspace root. Minih doesn't need this (agents run in cwd).
- **Simplify constructor**: Source takes `(client: ICopilotClient, options?: SdkCopilotAdapterOptions)`. Minih simplifies to `(client: ICopilotClient)`.
- **Keep event translation**: All SDK event types → AgentEvent mapping preserved exactly.
- **Keep duplicate suppression**: `hasStreamedThinking` / `hasStreamedText` logic preserved.
- **Keep prompt validation**: MAX_PROMPT_LENGTH, empty check, control char check.
- **console.log debug lines**: Source has `console.log('[SdkCopilotAdapter]...')` — keep for now, replace with configurable logging later.

**SDK event translation map**:
```
SDK Event Type                 → AgentEvent Type
──────────────────────────────────────────────────
assistant.message_delta        → text_delta
assistant.message              → message (suppressed if streamed)
assistant.usage                → usage
assistant.reasoning            → thinking (suppressed if streamed)
assistant.reasoning_delta      → thinking
session.idle                   → session_idle
session.error                  → (handled in catch block)
tool.execution_start           → tool_call
tool.execution_complete        → tool_result
pending_messages.modified      → (skip)
user.message                   → (skip)
assistant.turn_start           → (skip)
assistant.turn_end             → (skip)
session.usage_info             → (skip)
(unknown)                      → raw
```

---

## Discoveries & Learnings

_Populated during implementation by plan-6._

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
