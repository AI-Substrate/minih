# Flight Plan: Phase 3 — File Watcher + Daemon-Light Forwarders

**Plan**: [coordination-plan.md](../../coordination-plan.md)
**Phase**: Phase 3: File Watcher + Daemon-Light Forwarders
**Generated**: 2026-04-26
**Status**: Landed

---

## Departure → Destination

**Where we are**: Phase 2 landed the event-driven runner and adapter seam. `runAgent` now sends the initial prompt with `session.send`, resolves on `session_idle`, exposes `SessionSender` through `onSessionReady`, and already has a `pendingForwarderCount` terminal-condition placeholder. The inbox/state filesystem paths, atomic write helper, and per-agent shared layout are available from Phase 1, but no production watcher or forwarder exists yet.

**Where we're going**: By the end of Phase 3, a live `minih run` can receive cross-process inbox and state changes from disk and push them into the active SDK session as queued turns. A developer can write an outside inbox message or outside-state update while the run is alive, and runner-owned forwarders will deliver it through the Phase 2 session sender without adding a separate queue.

---

## Domain Context

### Domains We're Changing

| Domain | What Changes | Key Files |
|--------|--------------|-----------|
| `runner` | Add file watcher, inbox forwarder, state forwarder, durable watermark helper, single-run guard, runner lifecycle wiring, tests, and domain docs. | `src/runner/file-watcher.ts`, `src/runner/inbox-forwarder.ts`, `src/runner/state-forwarder.ts`, `src/runner/forwarder-watermark.ts`, `src/runner/run-lock.ts`, `src/runner/runner.ts` |

### Domains We Depend On (no changes)

| Domain | What We Consume | Contract |
|--------|-----------------|----------|
| `adapter` | Live session send handle for mid-run message injection. | `SessionSender`, `AgentRunOptions.onSessionReady` |
| `runner` | P1 path/state/atomic helpers and P2 terminal-condition seam. | `watermarkPath`, `inboxLanePath`, `stateFilePath`, `readStateLazy`, `writeFileAtomic`, `awaitTerminalCondition` |

---

## Flight Status

<!-- Updated by /plan-6-v2: pending → active → done. Use blocked for problems/input needed. -->

```mermaid
stateDiagram-v2
    classDef pending fill:#9E9E9E,stroke:#757575,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff

    state "1: Watch files" as S1
    state "2: Track watermark" as S2
    state "3: Forward inbox" as S3
    state "4: Forward state" as S4
    state "5: Drain backlog" as S5
    state "6: Wire runner" as S6
    state "7: Wait for drain" as S7
    state "8: Guard runs" as S8
    state "9: Test e2e" as S9
    state "10: Update docs" as S10

    [*] --> S1
    S1 --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S5
    S5 --> S8
    S8 --> S6
    S6 --> S7
    S7 --> S9
    S9 --> S10
    S10 --> [*]

    class S1 done
    class S2 done
    class S3 done
    class S4 done
    class S5 done
    class S8 done
    class S6 done
    class S7 done
    class S9 done
    class S10 done
```

**Legend**: grey = pending | yellow = active | red = blocked/needs input | green = done

---

## Stages

<!-- Updated by /plan-6 during implementation: [ ] → [~] → [x] -->

- [x] **Stage 1: Watch files** — Create the debounced native `fs.watch` wrapper for burst, missing-path, watcher-error, and atomic-rename tolerant change detection (`src/runner/file-watcher.ts` — new file).
- [x] **Stage 2: Track watermark** — Define private durable forwarder progress in `state/sdk-watermark.json` with atomic writes and containment tests (`src/runner/forwarder-watermark.ts` — new file).
- [x] **Stage 3: Forward inbox** — Tail outside inbox NDJSON, render messages, send them through `SessionSender`, and advance the watermark only after success (`src/runner/inbox-forwarder.ts` — new file).
- [x] **Stage 4: Forward state** — Detect outside-state changes, send concise state-change prompts, and retry on send failure without adding transition rules (`src/runner/state-forwarder.ts` — new file).
- [x] **Stage 5: Drain backlog** — Send unforwarded inbox/state changes before live watch delivery begins (`src/runner/inbox-forwarder.ts`, `src/runner/state-forwarder.ts`).
- [x] **Stage 6: Wire runner** — Start and stop forwarders in `runAgent` using the Phase 2 `onSessionReady` seam (`src/runner/runner.ts`).
- [x] **Stage 7: Wait for drain** — Feed the live pending-forwarder count into the terminal condition so idle waits for queued sends to settle (`src/runner/runner.ts`, `test/runner/runner-event-driven.test.ts`).
- [x] **Stage 8: Guard runs** — Prevent two live runs from owning watchers for the same agent slug and expose a typed runner error for later CLI mapping (`src/runner/run-lock.ts` — new file).
- [x] **Stage 9: Test e2e** — Add the opt-in daemon-light cross-process test and document how to run it (`test/e2e/daemon-light.test.ts` — new file, `CONTRIBUTING.md`).
- [x] **Stage 10: Update docs** — Re-export intentional contracts, update runner domain docs, and record plan progress (`src/runner/index.ts`, `docs/domains/runner/domain.md`).

---

## Architecture: Before & After

```mermaid
flowchart LR
    classDef existing fill:#E8F5E9,stroke:#4CAF50,color:#000
    classDef changed fill:#FFF3E0,stroke:#FF9800,color:#000
    classDef new fill:#E3F2FD,stroke:#2196F3,color:#000

    subgraph Before["Before Phase 3"]
        B1[runAgent event loop]:::existing
        B2[SessionSender seam]:::existing
        B3[Per-agent inbox/state files]:::existing
        B4[SDK queue]:::existing
        B1 --> B2
        B2 --> B4
    end

    subgraph After["After Phase 3"]
        A1[runAgent lifecycle]:::changed
        A2[SessionSender seam]:::existing
        A3[Per-agent inbox/state files]:::existing
        A4[File watcher]:::new
        A5[Inbox forwarder]:::new
        A6[State forwarder]:::new
        A7[Watermark store]:::new
        A8[Single-run guard]:::new
        A9[SDK queue]:::existing

        A1 --> A8
        A1 --> A4
        A4 --> A5
        A4 --> A6
        A3 --> A5
        A3 --> A6
        A5 --> A7
        A6 --> A7
        A5 --> A2
        A6 --> A2
        A2 --> A9
    end
```

**Legend**: existing (green, unchanged) | changed (orange, modified) | new (blue, created)

---

## Acceptance Criteria

- [x] Inbox NDJSON lines written by another process are forwarded into the in-flight SDK session through `session.send` within 5 seconds.
- [x] Outside-state changes are forwarded into the in-flight SDK session through `session.send` within 5 seconds.
- [x] Cold-start drain forwards unwatermarked inbox/state changes before live watch delivery.
- [x] Restarting a run does not re-forward already-watermarked messages.
- [x] Malformed or torn NDJSON lines do not advance the watermark and are retried on the next drain.
- [x] Rapid write bursts are debounced/coalesced without assuming one watch event equals one write.
- [x] Forwarded messages are visible to the agent after the next idle boundary.
- [x] Empty inbox/state inputs do not produce spurious `session.send` calls.
- [x] A first-ever run with an empty watermark forwards all existing inbox messages.
- [x] Two simultaneous runs for the same agent slug are rejected before watcher ownership conflicts.

## Goals & Non-Goals

**Goals**:
- Add live inbox and state push from per-agent shared files to the active SDK session.
- Reuse Phase 1 path/state/atomic helpers and Phase 2 `SessionSender`/terminal-condition seams.
- Keep delivery idempotent with a durable watermark.
- Add targeted unit tests and an opt-in daemon-light e2e gate.

**Non-Goals**:
- MCP server or tool implementation; Phase 4 owns that.
- Outside CLI commands; Phase 5 owns those.
- Prompt copy for identity/tools/peer-contract sections; Phase 6 owns that.
- Full daemon start/stop/status commands or pidfiles.

---

## Checklist

- [x] T001: Implement the native file watcher primitive (CS-3)
- [x] T002: Define the SDK forwarder watermark helper (CS-3)
- [x] T003: Implement the inbox forwarder drain loop (CS-3)
- [x] T004: Implement the state forwarder diff loop (CS-3)
- [x] T005: Add cold-start drain orchestration (CS-3)
- [x] T006: Wire forwarders into `runAgent` lifecycle (CS-4)
- [x] T007: Integrate the live pending-forwarder terminal count (CS-2)
- [x] T008: Add the single-run guard (CS-2)
- [x] T009: Add the opt-in daemon-light e2e test (CS-3)
- [x] T010: Re-export contracts and update docs (CS-2)

---

## PlanPak

Not active for this plan.
