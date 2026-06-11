# Stall Watchdog + Run Budgets — guaranteed terminal artifact on every run

**Mode**: Simple
**Created**: 2026-06-11
**Issue**: [#44](https://github.com/AI-Substrate/minih/issues/44)

📚 Specification incorporates findings from [research-dossier.md](./research-dossier.md) (CD-01…CD-06, PL-01…PL-05).

## Research Context

Three load-bearing findings shape this spec:

1. **CD-01 (the #44 mechanism)**: a run-level `--timeout` already exists and fires — but its cleanup path `await adapter.terminate()` (→ `resumeSession`/`abort`/`destroy`, plus `disconnect()` in the adapter `finally`) makes unbounded JSON-RPC awaits into the hung Copilot CLI subprocess. A hang there blocks **every** terminal write; `run.json` stays `active` forever.
2. **CD-02**: there is no inactivity detection. The adapter settles only on `session.idle` (resolve) or `session.error` (reject); a silently-stopped stream settles neither.
3. **SDK truth**: latest `@github/copilot-sdk` is **1.0.1** (we run 1.0.0); its release notes contain nothing stall/abort-related. The watchdog must be entirely minih-side.

## Summary

Guarantee that **every run reaches a terminal artifact** (`run.json` terminal status + machine-readable `terminalReason`, `completed.json`) no matter how the provider stream dies: silent mid-delta stall, wall-clock timeout, or runaway agent loop. Three mechanisms: (1) make all SDK cleanup awaits **deadline-bounded** with a `forceStop` escalation so terminal writes can never be blocked (fixes CD-01); (2) an **inactivity watchdog** that aborts a stream which stops advancing and terminalizes the run with `terminalReason: 'stalled-stream'` (fixes CD-02); (3) a **`--max-turns` budget** so a looping agent self-terminates with a partial-but-terminal record. Plus: SDK 1.0.1 bump, run/resume timeout-default reconciliation, and `terminalReason: 'timeout'` for the existing timeout path.

## Goals

- A stalled live run (the #44 shape: pid alive, stream quiet, non-terminal manifest) terminalizes itself within the stall budget — pollers get `failed` + `stalled-stream` instead of forever-`active`.
- A timed-out run **always** finishes its terminal writes, even when the SDK subprocess is wedged (bounded cleanup; escalate `session.abort` → `session.destroy` → `client.forceStop`).
- A looping agent capped by `--max-turns` still emits its terminal record (`max-turns`).
- The `minih run` process **exits** after terminalization (no manually-killed zombies).
- Operators can tune or disable each budget per run (`--timeout` exists; new `--stall-timeout`, `--max-turns`; `0` disables stall/turn budgets); budgets are recorded in `run.json` for forensics.
- `@github/copilot-sdk` current (1.0.1) with the permission-shape pin proving no drift.

## Non-Goals

- **Windows CI / first-class detached mode** (#44 Q3): documented stance only — `detached:true + unref()` remains unsupported-but-tolerated; the watchdog is the universal mitigation. No Windows-specific code paths this plan.
- **Recovering/resuming a stalled turn**: we terminalize honestly; `minih resume` already exists for continuation.
- **E170 behavior change**: auto-selecting among multiple active runs stays off; only remedy-text polish (point at `--latest`/`--run`). The watchdog dissolves the accumulation that made E170 painful (#44 minor note).
- **Diagnosing the upstream root cause** inside Copilot CLI/service (35-min server kills, pipe backpressure, …): the watchdog defends against all of them uniformly.
- New status-verdict vocabulary: a terminalized stall is plain `failed` (+ reason); no new verdicts after 025's `dead`.
- **minih-process signal death** (SIGTERM/SIGKILL of minih itself): already covered by the runner's try/finally crashed-stub plus plan 025's `reconcile`/`dead` verdict — not re-solved here.
- **Protecting a run with all budgets disabled**: `--stall-timeout 0` plus a huge `--timeout` means no protection by explicit operator choice — allowed and documented, not prevented.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| runner | existing | **modify** | Stall watchdog + turn budget in the event funnel; terminal-artifact-first ordering; `terminalReason` values; budget config/types |
| adapter | existing | **modify** | Deadline-bounded `terminate()`/`disconnect()`; `forceStop` escalation; SDK 1.0.1 bump |
| cli | existing | **modify** | `--stall-timeout`/`--max-turns` on `run` + `resume`; timeout-default reconciliation; E170 remedy polish; docs vocabulary |

## Testing Strategy

- **Approach**: Full TDD (red → green per behavior).
- **Rationale**: timer/race/abort logic is precisely where untested async code rots; the repo already has the seams to make it deterministic — `FakeAgentAdapter.setQueuedRun(..., { suppressFinalIdle: true })` simulates a never-settling stream (PL-02), and the injectable clock/probe idiom (PL-03) extends naturally to an injectable scheduler/clock for the watchdog.
- **Focus areas**: stall detection + terminal writes; bounded-cleanup behavior when terminate/disconnect hang; max-turns breach; no-false-trigger on healthy slow streams (any event type resets the timer); disable knobs; flag plumbing + manifest recording; end-to-end `status`/`runs` passthrough of new reasons.
- **Excluded**: real-time waits (fake timers / injected `now` only); Windows-specific behavior; real SDK subprocess tests.
- **Mock usage**: targeted — MockSession/MockClient and FakeAgentAdapter at the SDK boundary (existing pattern), vitest fake timers or injected clocks for time; no fs mocks except where 025 already isolates them.

## Documentation Strategy

- **Location**: Hybrid — README flag tables + budget semantics; CHANGELOG entry; docs/how note on run lifecycles/terminal reasons if an existing page fits (extend, don't proliferate).
- **Rationale**: operator-facing flags belong in README; the terminal-reason vocabulary feeds the docs-vocabulary guard (025 T014 pattern).

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=2, D=1, N=1, F=1, T=1 → 7
- **Confidence**: 0.8
- **Assumptions**: SDK `client.forceStop()` reliably kills the CLI subprocess even when JSON-RPC is wedged (it SIGKILLs the child — process-level, not RPC); `stats.messages` is an acceptable turn proxy.
- **Dependencies**: plan 025 vocabulary (`terminalReason`, verdicts) shipped on main; FakeAgentAdapter T008 seam.
- **Risks**: see § Risks & Assumptions.
- **Phases**: 1 (Simple).

## Behavior Contract (the decisions, made)

These were the workshop-candidate topics; the dossier evidence was sufficient to settle them here (workshop skipped deliberately):

1. **Inactivity semantics**: the watchdog deadline resets on **every adapter event of any type** (deltas, tool events, thinking, usage). Inactivity = zero events for `stallTimeout`. No tool-in-flight special-casing in v1 — a silently-running >stall-budget tool is indistinguishable from a hang; the knob (`--stall-timeout`) is the mitigation and the limitation is documented. Default **300s**, `0` disables.
2. **Terminal-artifact-first ordering**: on stall/timeout/max-turns the runner proceeds to terminal writes after a **bounded** cleanup attempt — every SDK call on the cleanup path (`resumeSession`, `abort`, `destroy`, `disconnect`) is raced against a short deadline (~5s each, single shared budget acceptable); final rung `client.forceStop()`. No code path between trigger and terminal write may await an unbounded SDK promise.
3. **Trigger plumbing**: stall and turn budgets settle the existing `Promise.race` (third arm), mirroring the `timedOut` flag pattern (`stalled` / `turnsExceeded`), with the same `handleEvent` guard treatment.
4. **Vocabulary**: `terminalReason` gains `'stalled-stream'`, `'max-turns'`, `'timeout'` (the existing timeout path writes nothing today — CD-04). `completed.json.result` keeps its current vocabulary (`timeout` for wall-clock; `failed` for stall/max-turns). Synthetic diagnosis events follow the FX012/permission-denied precedent (PL-01).
5. **Exit/CLI mapping**: stall and max-turns map to the existing timeout family **in exit code and CLI error only** (in-memory `AgentResult.status: 'killed'`, exit 124, CLI `E123 AGENT_TIMEOUT`) with reason-bearing messages — no new error codes. The three-trigger matrix, precisely:

   | Trigger | run.json `status` | run.json `terminalReason` | completed.json `result` | exit | CLI |
   |---------|------------------|---------------------------|------------------------|------|-----|
   | wall-clock timeout | `failed` | `timeout` | `timeout` | 124 | E123 |
   | stall watchdog | `failed` | `stalled-stream` | `failed` | 124 | E123 |
   | max-turns breach | `failed` | `max-turns` | `failed` | 124 | E123 |

6. **Turn counting**: `stats.messages` (assistant-message count) is the turn proxy; breach checked in the event funnel. A turn is **one consolidated assistant message regardless of streaming chunking**; tool calls/results and thinking events do not increment the counter.
7. **Defaults reconciliation (CD-05)**: one shared default (900s, frontmatter-overridable) for `run` and `resume`; the runner's timeout message reports the actual configured value.
8. **Budget forensics**: effective budgets recorded in `run.json` (e.g. `budgets: { timeoutSec, stallTimeoutSec, maxTurns }`) so a #44-style report shows what protection was active.

## Acceptance Criteria

1. **Stall terminalizes**: fake-adapter run that streams then goes silent (suppressed idle) with `--stall-timeout` S → within the budget (fake clock): `run.json` `status: 'failed'`, `terminalReason: 'stalled-stream'`; `completed.json` written (`result: 'failed'`, exit 124); a synthetic diagnosis event appended to `events.ndjson`; process path returns (no hang).
2. **Hung cleanup cannot block terminal writes**: with an adapter whose `terminate()`/`disconnect()` never settles, a timeout/stall still produces all terminal artifacts after the bounded cleanup window, and the escalation (`forceStop`) is invoked.
3. **Existing timeout path gains a reason**: wall-clock timeout → `run.json` `terminalReason: 'timeout'` (plus today's `completed.json result: 'timeout'`).
4. **Max-turns**: run emitting > N assistant messages with `--max-turns N` → terminal `failed` + `terminalReason: 'max-turns'`; healthy run with ≤ N turns unaffected.
5. **No false trigger**: a run whose events keep flowing (any type — tool/thinking included) never trips the watchdog even when individual gaps approach the budget; `--stall-timeout 0` disables stall detection entirely.
6. **Flags + plumbing**: `--stall-timeout <seconds>` and `--max-turns <n>` accepted by `minih run` and `minih resume`, threaded via `AgentRunConfig`, recorded in `run.json` budgets; rejected with `E108` on invalid values.
7. **Status passthrough end-to-end**: `minih status`/`runs` on a stall-terminalized run shows `verdict: failed` with `terminalReason: 'stalled-stream'` in the envelope (no CLI special-casing needed — proven by test).
8. **Defaults reconciled**: `run` and `resume` share the same default timeout source; the runner's timeout error message reports the configured value (no hardcoded `300`).
9. **SDK current**: `@github/copilot-sdk` at 1.0.1 in package.json + lockfile; `sdk-permission-shapes.test.ts` green; full gate (`just fft`) green.
10. **Docs**: README documents the three budgets + defaults + disable semantics; CHANGELOG entry; docs-vocabulary guard covers the new `terminalReason` values; Windows stance + tool-silence limitation documented.
11. **E170 remedy polish**: `status` E170 error remedies mention `--latest` (text only; behavior unchanged).

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Legitimate silent gaps (long tool executions) > 300s false-trigger the watchdog | Medium | Medium | Any-event reset (tool events count); documented `--stall-timeout` knob + `0` disable; default chosen above typical tool runs |
| `forceStop()` leaves orphaned grandchildren on some platforms | Low | Medium | It SIGKILLs the CLI child minih owns; document; out-of-scope beyond that (Windows non-goal) |
| `forceStop()` itself misbehaves (the last escalation rung is process-level and not TDD-provable) | Low | Medium | Terminal writes ordered before/independent of cleanup, so even a wedged `forceStop` cannot block the artifact; real-process teardown verification is integration-scoped, documented |
| Third race arm interacts badly with `timedOut`/`adapterSettled` early-returns in the `.then()` chain | Medium | High | TDD the matrix (stall-before-idle, idle-before-stall, stall-during-completing); mirror the existing flag pattern exactly |
| SDK 1.0.1 surprises (shape drift) | Low | Low | Permission-shape pin + `.d.ts` sanity diff at bump time |
| Stall timer in resumed runs double-counts old events | Low | Low | Watchdog observes live adapter events only (handleEvent), not events.ndjson replay |

## Open Questions

None blocking — sketch-dependent choices were settled in § Behavior Contract. (Round 2 skipped: no NEW domains, no critical markers.)

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions | Disposition |
|-------|------|--------------|---------------|-------------|
| Stall semantics (tool-aware vs any-event) | State Machine | options existed | reset policy, default budget | **Settled in § Behavior Contract (1)** — workshop skipped |
| Cleanup escalation ladder | Integration Pattern | hang-proofing | bounding, forceStop | **Settled in § Behavior Contract (2)** |

## Clarifications

### Session 2026-06-11

- **Workflow Mode**: Simple — set by Jordan in the kickoff ("for spec phase we will do simple mode then defer to you for other choices").
- **Testing Strategy**: Full TDD with deterministic time (delegated decision) — timer/race logic; seams already exist (PL-02/PL-03).
- **Mock Usage**: Targeted — SDK-boundary mocks + fake adapter + fake timers only (repo's established pattern).
- **Documentation Strategy**: Hybrid (README + CHANGELOG + docs/how extension where an existing page fits).
- **Scope of E170/E171** (delegated): remedy-text polish only; watchdog dissolves the accumulation pain; behavior change declared a non-goal.
- **Windows** (delegated): documented stance, no Windows code/CI this plan.
- **Workshop** (delegated, "if needed"): skipped — contested topics settled in § Behavior Contract from dossier evidence; no genuinely open design space remained.
