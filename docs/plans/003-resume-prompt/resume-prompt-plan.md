# Implementation Plan: Session Resume & Follow-Up Prompts

**Spec**: `resume-prompt-spec.md`
**Mode**: Simple
**Created**: 2026-04-06T02:58:00Z
**Status**: Draft
**Version**: 1.1.0

## DYK Insights Applied (v1.1.0)

| # | Insight | Decision | Impact |
|---|---------|----------|--------|
| 1 | `connect` prints a command but session CWD is the run folder — `copilot --resume` from project root won't work | Print `cd <runDir> && copilot --yolo --resume=<sessionId>` | T007 updated |
| 2 | `resume.ts` will clone 80+ lines of SDK wiring from `run.ts` | Extract shared `sdk-runtime.ts` helper, refactor `run.ts` to use it | T006 updated, new file |
| 3 | `disconnect()` for ALL runs = session accumulation at scale | Validate in scratch test (T001) — check what `destroy()` actually does | T001 scope |
| 4 | stdin blocking if no message | Non-issue — user is always present, message is a required argument | No change |
| 5 | Old `MINIH_OUTPUT_PATH` in conversation history | Non-issue — env vars point to new path, fallback catches raw output | No change |

---

Three new capabilities, built on existing plumbing:

1. **`minih resume <slug> "message"`** — send a follow-up to a completed session via SDK `resumeSession()`. Mechanically identical to `minih run` but resumes instead of creating fresh.
2. **`minih connect <slug>`** — print a ready-to-paste `cd <runDir> && copilot --yolo --resume=<sessionId>` command. No SDK interaction.
3. **Adapter lifecycle change** — switch `run()` from `destroy()` to `disconnect()` so sessions survive for resume. Validate behavior in scratch test first.

The adapter already has `resumeSession()` support and `AgentRunOptions.sessionId`. `completed.json` already stores `sessionId`. The work is mostly wiring these existing capabilities to new CLI commands and adding a session lookup helper in the runner.

**Pre-implementation gate**: Empirical SDK test (scratch script) to validate `disconnect()` → `resumeSession()` → `sendAndWait()` works.

---

## Testing Strategy

- **Approach**: Lightweight
- **Focus**: Session lookup helpers (find latest/specific run, read sessionId from completed.json), runner resume path (sessionId threading), CLI command registration
- **Mocks**: FakeAgentAdapter (already supports sessionId), filesystem fixtures for completed.json
- **Excluded**: E2E SDK resume (requires live auth)

---

## Domain Manifest

| Domain | Changes | Contracts Affected |
|--------|---------|-------------------|
| adapter | `run()` → `disconnect()` instead of `destroy()` | No contract changes — `IAgentAdapter` unchanged |
| runner | `AgentRunConfig.sessionId`, `CompletedMetadata.resumedFromRunId`, session lookup helpers, `resumeAgent()` or modified `runAgent()` | `AgentRunConfig` (new field), `CompletedMetadata` (new field), new `findRunSession()` export |
| cli | New `resume` command, new `connect` command | No existing contracts change |

Import direction `cli → runner → adapter` preserved. No new domains.

---

## Key Research Findings

| ID | Finding | Impact | Source |
|----|---------|--------|--------|
| RF-01 | `SdkCopilotAdapter.run()` already switches on `sessionId` — uses `resumeSession()` when provided | Resume is adapter-ready, just thread the ID | `sdk-copilot.ts:45-58` |
| RF-02 | `session.destroy()` called in `finally` of every `run()` | Must switch to `disconnect()` for sessions to survive | `sdk-copilot.ts:136-141` |
| RF-03 | `compact()` already uses `disconnect()` — proven pattern for preserving sessions | Follow same pattern in `run()` | `sdk-copilot.ts:177-179` |
| RF-04 | `completed.json` stores `sessionId` field | Lookup data already available in every run | `runner.ts:349`, `types.ts:48` |
| RF-05 | `-p` flag is taken by `--param` | Separate `resume` command avoids all flag conflicts | `run.ts:50-56` |
| RF-06 | History reads `completed.json` and returns run list | Session lookup can reuse same filesystem pattern | `history.ts:55-65` |
| RF-07 | CWD isolation via run folder as SDK workingDirectory | Resumed runs in new run folders maintain isolation automatically | Workshop 005 |

---

## Implementation

### T001: Empirical SDK Test Script (Pre-Implementation Gate)

Write a standalone scratch script that:
1. Creates a CopilotClient + SdkCopilotAdapter
2. Runs a simple prompt with `disconnect()` (not `destroy()`)
3. Captures the `sessionId`
4. Calls `resumeSession(sessionId)` with a follow-up message
5. Verifies the agent can reference the prior conversation

**Files**: `scratch/test-resume.mjs` (temporary, delete after validation)
**ACs**: Gate for all other tasks
**Domain**: None (scratch script)

### T002: Adapter Lifecycle — `destroy()` → `disconnect()`

Change `SdkCopilotAdapter.run()` to use `disconnect()` instead of `destroy()` in the `finally` block. This matches the pattern already used by `compact()`.

**Files**: `src/adapter/sdk-copilot.ts`
**ACs**: AC11 (CWD isolation preserved — disconnect doesn't change CWD behavior)
**Domain**: adapter

### T003: Runner Types — Add Resume Fields

Add `sessionId?: string` to `AgentRunConfig` and `resumedFromRunId?: string` to `CompletedMetadata`. These are the data pathways for resume.

**Files**: `src/runner/types.ts`
**ACs**: AC5 (resumedFromRunId in completed.json)
**Domain**: runner

### T004: Session Lookup Helper

Create `findRunSession(slug, runId?, agentsDir?)` in `src/runner/folder.ts` (or a new `src/runner/session.ts`). Reads `completed.json` from the latest (or specified) run and returns `{ sessionId, runId, runDir }` or null. Export from barrel.

**Files**: `src/runner/folder.ts` or `src/runner/session.ts`, `src/runner/index.ts`
**ACs**: AC1, AC2, AC8 (lookup for latest and specific runs, error when missing)
**Domain**: runner
**Tests**: Session lookup — latest run, specific run by ID, missing completed.json, no runs dir, corrupt JSON

### T005: Runner Resume Path

Modify `runAgent()` to support resume:
- If `config.sessionId` is set, skip full prompt assembly — just use the follow-up message as the prompt
- Pass `config.sessionId` through to `adapter.run()`
- Skip system output validation (no summary/retrospective enforcement)
- Write `resumedFromRunId` into `completed.json` metadata

**Files**: `src/runner/runner.ts`
**ACs**: AC3, AC4, AC5 (conversation history, new run folder, linked metadata)
**Domain**: runner
**Tests**: Resume path — sessionId forwarded, system output skipped, resumedFromRunId in metadata

### T006: CLI `resume` Command

New `src/cli/commands/resume.ts`:
- `minih resume <slug> [message]` — positional message argument
- `--run <runId>` — resume specific run
- `--verbose` — verbose display mode
- `--timeout <seconds>` — timeout (default 300)
- Reads message from stdin if not provided as argument
- Uses `findRunSession()` to get sessionId, then calls `runAgent()` with it
- Uses shared SDK runtime helper (extracted from `run.ts`) for composition root
- JSON envelope with `resumedFromRunId` and `originalSessionId`

**Files**: `src/cli/commands/resume.ts`, `src/cli/commands/sdk-runtime.ts` (NEW — shared helper), `src/cli/commands/run.ts` (refactored to use shared helper), `src/cli/index.ts`
**ACs**: AC1, AC2, AC6, AC7, AC8, AC9, AC12
**Domain**: cli

### T007: CLI `connect` Command

New `src/cli/commands/connect.ts`:
- `minih connect <slug>` — prints `cd <runDir> && copilot --yolo --resume=<sessionId>` for latest run
- `--run <runId>` — connect to specific run
- `--list` — show all runs with session IDs, run IDs, timestamps, status
- JSON envelope includes `sessionId`, `runDir`, and `command` string

**Files**: `src/cli/commands/connect.ts`, `src/cli/index.ts`
**ACs**: AC13, AC14, AC15, AC16
**Domain**: cli

### T008: History Enhancement

Add a `↩` indicator to `minih history` output for runs that have `resumedFromRunId` in their `completed.json`. Shows the chain of runs.

**Files**: `src/cli/commands/history.ts`
**ACs**: AC10
**Domain**: cli

### T009: Tests

Write lightweight tests for:
- Session lookup helper (find latest, find by ID, missing, corrupt)
- Runner resume path (sessionId forwarding, skip system validation, resumedFromRunId)
- CLI command registration (resume, connect registered and parseable)

**Files**: `test/runner/session.test.ts` or additions to `test/runner/runner.test.ts`, `test/cli/commands.test.ts`
**ACs**: All functional ACs via unit tests
**Domain**: runner, cli

### T010: README + Domain Docs

- Add `resume` and `connect` to README CLI reference table
- Add usage examples
- Update `docs/domains/{adapter,runner,cli}/domain.md` with new contracts, composition entries, and history

**Files**: `README.md`, `docs/domains/*/domain.md`
**ACs**: AC9 (help text), documentation
**Domain**: All

---

## Task Summary

| Task | Title | Domain | ACs | Depends On |
|------|-------|--------|-----|-----------|
| T001 | SDK Test Script | — | Gate | — |
| T002 | Adapter disconnect | adapter | AC11 | T001 |
| T003 | Runner types | runner | AC5 | — |
| T004 | Session lookup | runner | AC1,2,8 | T003 |
| T005 | Runner resume path | runner | AC3,4,5 | T003, T004 |
| T006 | CLI resume | cli | AC1,2,6-9,12 | T002, T005 |
| T007 | CLI connect | cli | AC13-16 | T004 |
| T008 | History enhancement | cli | AC10 | T003 |
| T009 | Tests | runner, cli | All | T004, T005, T006, T007 |
| T010 | README + docs | All | AC9 | T006, T007 |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│ CLI Layer                                                │
│                                                          │
│  resume.ts (NEW)    connect.ts (NEW)    history.ts (MOD) │
│  ┌───────────┐      ┌────────────┐      ┌────────────┐  │
│  │ resume cmd│      │ connect cmd│      │ + ↩ marker │  │
│  │ --run     │      │ --run      │      │ for resumed│  │
│  │ --verbose │      │ --list     │      │ runs       │  │
│  │ stdin msg │      │ print cmd  │      └────────────┘  │
│  └─────┬─────┘      └─────┬──────┘                      │
│        │                   │                             │
├────────┼───────────────────┼─────────────────────────────┤
│ Runner Layer               │                             │
│        │                   │                             │
│  ┌─────▼─────────┐  ┌─────▼────────┐                    │
│  │ runAgent()    │  │findRunSession│                    │
│  │ +sessionId    │  │ (NEW helper) │                    │
│  │ +skip sysout  │  │ reads        │                    │
│  │ +resumedFrom  │  │completed.json│                    │
│  └─────┬─────────┘  └──────────────┘                    │
│        │                                                 │
│  types.ts (MOD): AgentRunConfig.sessionId,               │
│                  CompletedMetadata.resumedFromRunId       │
│                                                          │
├────────┼─────────────────────────────────────────────────┤
│ Adapter Layer                                            │
│        │                                                 │
│  ┌─────▼──────────┐                                      │
│  │ run()          │                                      │
│  │ destroy() →    │                                      │
│  │ disconnect()   │                                      │
│  │ (already has   │                                      │
│  │ sessionId path)│                                      │
│  └────────────────┘                                      │
└──────────────────────────────────────────────────────────┘
```

---

## Commit Strategy

Single commit after all tasks complete:
```
feat: session resume + connect commands

- `minih resume <slug> "message"` — send follow-up to completed session
- `minih connect <slug>` — print copilot --resume command for session handoff
- Adapter: switch run() from destroy() to disconnect() for session persistence
- Runner: sessionId threading, session lookup, skip system output on resume
- History: show ↩ indicator for resumed runs
```
