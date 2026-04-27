# Flight Plan: Fix FX002 — Blocking inbox list

**Fix**: [FX002-blocking-inbox-list.md](./FX002-blocking-inbox-list.md)  
**Status**: Landed

## What → Why

**Problem**: Inside agents currently sleep-poll `inbox_list` while waiting for outside milestones.  
**Fix**: Add a bounded long-poll option to `inbox_list` so the private MCP inbox read can block until a peer message arrives or a timeout expires.

## Domain Context

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| mcp | Primary owner | Add optional long-poll semantics to `inbox_list`; keep private MCP scope and run-scoped file backing. |
| runner | Contract/docs consumer | Coordinated preamble teaches the new wait parameter without importing MCP. |
| cli | Docs consumer | Existing outside commands remain unchanged; docs explain inside long-poll usage. |

## Stages

- [x] **Stage 1: Contract the wait parameter** — Add bounded millisecond `waitMs` plus `wait` result metadata to the `inbox_list` schema and contract tests.
- [x] **Stage 2: Make dispatch async-safe** — Update MCP server dispatch/request handling and tests so long-poll calls can resolve asynchronously without breaking existing tools.
- [x] **Stage 3: Implement blocking reads** — Make inbox listing wait for filter-matching outside-lane messages or timeout while preserving immediate mode and cleaning up watchers/timers.
- [x] **Stage 4: Teach the harness** — Update coordinated prompt/runbook/eval prompt wording to prefer long-poll over sleep-polling.
- [x] **Stage 5: Validate before eval** — Run targeted tests, build, and the full quality gate before the no-context two-agent eval.

## Architecture Map

```mermaid
flowchart LR
    classDef pending fill:#9E9E9E,stroke:#757575,color:#fff
    classDef inprogress fill:#FFC107,stroke:#FFA000,color:#000
    classDef completed fill:#4CAF50,stroke:#388E3C,color:#fff

    T1[FX002-1 Contract]:::completed --> T2[FX002-2 Long-poll implementation]:::completed
    T2 --> T3[FX002-3 Harness docs]:::completed
    T3 --> T4[FX002-4 Validation]:::completed
    Types[src/mcp/types.ts]:::completed
    TypesTest[test/mcp/types.test.ts]:::completed
    DispatchTest[test/mcp/server-dispatch.test.ts]:::completed
    Inbox[src/mcp/tools/inbox.ts]:::completed
    Server[src/mcp/server.ts]:::completed
    InboxTest[test/mcp/inbox.test.ts]:::completed
    ServerTest[test/mcp/server.test.ts]:::completed
    Preamble[src/runner/preamble-builder.ts]:::completed
    AgentPrompt[agents/coordination-loop-validator/prompt.md]:::completed
    AgentInstructions[agents/coordination-loop-validator/instructions.md]:::completed
    Guide[docs/how/coordination-loop-validator.md]:::completed
    EvalPrompt[no-context-two-agent-eval-prompt.md]:::completed
    Domains[docs/domains/*.md]:::completed
    Validation[tests + build + just fft]:::completed
    T1 --> Types
    T1 --> TypesTest
    T1 --> DispatchTest
    T2 --> Inbox
    T2 --> Server
    T2 --> InboxTest
    T2 --> ServerTest
    T3 --> Preamble
    T3 --> AgentPrompt
    T3 --> AgentInstructions
    T3 --> Guide
    T3 --> EvalPrompt
    T4 --> Domains
    T4 --> Validation
```

## Flight Status

```mermaid
flowchart LR
    classDef pending fill:#9E9E9E,stroke:#757575,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff

    S1[Stage 1 Contract]:::done --> S2[Stage 2 Async dispatch]:::done
    S2 --> S3[Stage 3 Blocking reads]:::done
    S3 --> S4[Stage 4 Harness docs]:::done
    S4 --> S5[Stage 5 Validation]:::done
```

## Checklist

- [x] FX002-1 — Extend the `inbox_list` MCP contract.
- [x] FX002-2 — Implement long-poll behavior for inside inbox reads.
- [x] FX002-3 — Teach coordinated agents to use the blocking read.
- [x] FX002-4 — Validate the fix before the no-context eval.

## Acceptance

- [x] Existing `inbox_list` behavior is unchanged when `waitMs` is omitted.
- [x] `waitMs` is milliseconds, finite, integer, non-negative, capped at `30000`, and validated.
- [x] Long-poll returns promptly when matching messages already exist.
- [x] Long-poll wakes on a newly appended matching outside message.
- [x] Long-poll uses the full current filter set as its match predicate.
- [x] Long-poll times out cleanly with explicit `wait` metadata.
- [x] Watchers/timers are cleaned up after match, timeout, error, and overlapping calls.
- [x] Canonical docs/prompts teach the new usage.
- [x] Targeted tests, `npm run build`, and `just fft` pass.
