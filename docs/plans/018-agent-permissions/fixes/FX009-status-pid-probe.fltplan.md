# Flight Plan: Fix FX009 — `minih status` pid-liveness probe

**Fix**: [FX009-status-pid-probe.md](./FX009-status-pid-probe.md)
**Plan**: [agent-permissions-plan.md](../agent-permissions-plan.md)
**Source issue**: [#24](https://github.com/AI-Substrate/minih/issues/24)
**Generated**: 2026-05-04
**Status**: Ready for takeoff

---

## What → Why

**Problem**: `minih status` uses a 60-second `events.ndjson` mtime heuristic to decide `verdict: 'active'`. Runs whose pid has exited mid-stream stay reported as active for up to 60 s — and orchestrator polling on `verdict == 'active'` selects dead `runId`s and sends briefings into the void. Real-world cost: 14 m 27 s of wasted briefing-then-diagnosis time in Chainglass's repro.

**Fix**: Lift `isProcessAliveDefault` (already exported from `src/runner/index.ts`, used by `attach`/`view` since the prior FX009 era) into `src/cli/commands/status.ts`. When `run.json.status === 'active'` and `run.json.pid` is set, gate `verdict: 'active'` on the pid probe. Dead pid → `verdict: 'dead'` immediately, on the very next status poll.

Read-only. Healing is FX011 `minih reconcile`'s job.

---

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `cli/commands/status` | adds pid probe to verdict resolution | New `else if` clause; new JSON fields when verdict is `'dead'`; new TTY rendering for `'dead'` |

**Domains we depend on (no changes)**:

| Domain | What We Consume | Contract |
|--------|----------------|----------|
| `runner` | `isProcessAliveDefault(pid: number): boolean` | Already exported from `src/runner/index.ts:190` |

---

## Flight Status

```mermaid
stateDiagram-v2
    classDef pending fill:#9E9E9E,stroke:#757575,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff

    state "1: Add probe to status" as S1
    state "2: Inject for testability" as S2
    state "3: Render dead verdict" as S3
    state "4: Unit tests" as S4
    state "5: CHANGELOG + docs" as S5

    [*] --> S1
    S1 --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S5
    S5 --> [*]

    class S1,S2,S3,S4,S5 pending
```

**Legend**: grey = pending | yellow = active | red = blocked/needs input | green = done

---

## Stages

- [ ] **Stage 1: Add pid probe to status verdict chain** — new `else if` between `completedPath` and `eventsPath` checks (`src/cli/commands/status.ts`)
- [ ] **Stage 2: Inject `isProcessAlive` for testability** — match the pattern in `run-resolver.ts:62` (`src/cli/commands/status.ts`)
- [ ] **Stage 3: Render `'dead'` verdict** — TTY red ✗ + remediation hint; JSON envelope adds diagnostic fields conditionally (`src/cli/commands/status.ts`)
- [ ] **Stage 4: Unit tests — 5 cases** (`test/cli/status-pid-probe.test.ts` — new file)
- [ ] **Stage 5: CHANGELOG entry + companion-mode.md polling note** (`CHANGELOG.md`, `docs/how/companion-mode.md`)

---

## Architecture: Before & After

```mermaid
flowchart LR
    classDef existing fill:#E8F5E9,stroke:#4CAF50,color:#000
    classDef changed fill:#FFF3E0,stroke:#FF9800,color:#000
    classDef new fill:#E3F2FD,stroke:#2196F3,color:#000

    subgraph Before["Before FX009"]
        B1[status command]:::existing
        B2[Read run.json]:::existing
        B3{completedPath<br/>exists?}:::existing
        B4[verdict: completed or failed]:::existing
        B5[mtime heuristic<br/>60s threshold]:::existing
        B6[verdict: active or stale]:::existing
        B1 --> B2 --> B3
        B3 -- yes --> B4
        B3 -- no --> B5 --> B6
    end

    subgraph After["After FX009"]
        A1[status command]:::changed
        A2[Read run.json]:::existing
        A3{completedPath<br/>exists?}:::existing
        A4[verdict: completed or failed]:::existing
        A5{run.json.status==active<br/>AND pid set AND<br/>pid dead?}:::new
        A6[verdict: dead<br/>+ diagnostic fields]:::new
        A7[mtime heuristic<br/>60s threshold]:::existing
        A8[verdict: active or stale]:::existing
        A1 --> A2 --> A3
        A3 -- yes --> A4
        A3 -- no --> A5
        A5 -- yes --> A6
        A5 -- no --> A7 --> A8
    end
```

**Legend**: existing (green, unchanged) | changed (orange, modified) | new (blue, created)

---

## Acceptance Criteria

- [ ] **AC-FX9.1** Dead pid → `verdict: 'dead'` within one `status` call (no 60 s window)
- [ ] **AC-FX9.2** Read-only — `run.json` checksum unchanged before/after probe
- [ ] **AC-FX9.3** Completed runs → `verdict: 'completed'` (probe NOT consulted)
- [ ] **AC-FX9.4** Missing `pid` field → falls through to mtime heuristic
- [ ] **AC-FX9.5** `isProcessAlive` injection works (no hidden globals)
- [ ] **AC-FX9.6** JSON envelope has diagnostic fields ONLY when verdict is `'dead'`
- [ ] **AC-FX9.7** TTY display: red `✗` + hint pointing at `minih reconcile <slug>` (or "coming soon" if FX011 not yet shipped)
- [ ] **AC-FX9.8** CHANGELOG entry with orchestrator migration note

## Goals & Non-Goals

**Goals**: Cut Chainglass's 14-m-27-s window down to one status poll. Stay read-only — `status` is a fast read; healing belongs in FX011. Match the FX009-prior probe semantics already in use by `attach`/`view`.

**Non-Goals**: Mutate `run.json`. Race-safe concurrent writes. Cross-host pid probe. Heal `run.json.status` to `'crashed'`. Surface synthetic events for the death (FX012's job).

---

## Checklist

- [ ] FX009-1: Import `isProcessAliveDefault`; add resolution clause
- [ ] FX009-2: Inject for testability
- [ ] FX009-3: Render `'dead'` in TTY + JSON envelope
- [ ] FX009-4: Unit tests — 5 cases
- [ ] FX009-5: CHANGELOG + companion-mode.md polling note
