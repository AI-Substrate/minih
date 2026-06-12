# Stall Watchdog + Run Budgets Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-11
**Spec**: [stall-watchdog-spec.md](./stall-watchdog-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; delegated choices recorded in spec § Clarifications |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` (only harness.md present) |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required sections present; cross-refs resolve |
| G6 | Testing Alignment | PASS | Full TDD — every behavior task leads with its red test (test clause precedes impl clause in each row; T005a/T006a are pure test tasks) |
| G7 | Domain Completeness | PASS | adapter/runner/cli all existing + in Target Domains; Domain Manifest covers every file in the task table |

## Summary

Issue #44: runs whose provider stream silently stops advancing never reach a terminal state. Research (CD-01) showed the existing `--timeout` fires but its cleanup path can hang on unbounded SDK awaits, blocking every terminal write; there is also no inactivity detection (CD-02) and no turn budget (CD-03). This plan makes terminal artifacts unconditional: deadline-bounded SDK cleanup with a `forceStop` escalation, an inactivity watchdog (`stalled-stream`), a `--max-turns` budget (`max-turns`), a `terminalReason` for the existing timeout path (`timeout`), plus the SDK 1.0.1 bump and run/resume default reconciliation. Single phase, Full TDD on the existing fake-adapter/injected-clock seams.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | modify | Watchdog + budgets in the event funnel; terminal-first ordering; `terminalReason` vocabulary; config/manifest types |
| adapter | existing | modify | Bounded `terminate()`/`disconnect()`; `forceStop` escalation; `run_stalled`-adjacent event creator; SDK 1.0.1 |
| cli | existing | modify | `--stall-timeout`/`--max-turns` flags on run+resume; default reconciliation; status reason line + E170 remedy polish; docs |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| src/adapter/deadline.ts (NEW) | adapter | contract | `withDeadline`/`DEADLINE_EXPIRED` exported via the adapter barrel and imported by runner across the domain boundary (review FT-003: reclassified from internal) |
| src/adapter/index.ts | adapter | contract | Barrel gains `withDeadline`, `DEADLINE_EXPIRED`, `DeadlineExpired`, `AgentStalledEvent`, `SdkCopilotAdapterOptions` exports (review FT-003: added) |
| src/adapter/sdk-copilot.ts | adapter | internal | Bound `terminate()` rungs + run-`finally` `disconnect()`; escalate to `forceStop` |
| src/adapter/copilot-types.ts | adapter | contract | `ICopilotClient` mirror gains optional `forceStop?(): Promise<void>` |
| src/adapter/events.ts | adapter | contract | New synthetic `run_stalled` event creator (permission_denied precedent) |
| src/adapter/fake.ts | adapter | internal | Test affordances: hang-mode `terminate`/`disconnect`, multi-message turn queues |
| src/runner/runner.ts | runner | internal | Stall/turn race arms, flags mirror `timedOut`, bounded terminate call, terminal-reason writes |
| src/runner/types.ts | runner | contract | `AgentRunConfig.stallTimeout/maxTurns`; `LiveRunManifest.budgets?`; `terminalReason` union + `'timeout' \| 'stalled-stream' \| 'max-turns'` |
| src/runner/index.ts | runner | contract | Barrel gains `DEFAULT_TIMEOUT_SEC`/`DEFAULT_STALL_TIMEOUT_SEC` exports — the single default source run/resume share (review FT-003: added) |
| src/cli/commands/run.ts | cli | internal | New flags + validation (E108); shared default; budgets echo |
| src/cli/budget-flags.ts (NEW) | cli | internal | Shared budget-flag parser for run+resume (added during build — single E108 validation source instead of duplicating it) |
| src/cli/commands/resume.ts | cli | internal | Same flags; default aligned to shared constant |
| src/cli/commands/status.ts | cli | internal | TTY `reason:` line when `terminalReason` present; E170 remedy mentions `--latest` |
| test/adapter/deadline.test.ts (NEW) | adapter | internal | Helper red tests |
| test/adapter/sdk-permission-shapes.test.ts | adapter | internal | SDK shape pin — must stay green across the 1.0.1 bump (T001) |
| src/runner/pretty.ts | runner | internal | Render arm (or safe fallthrough) for the new `run_stalled` event |
| test/adapter/sdk-copilot.test.ts | adapter | internal | Hung-session bounding + forceStop escalation tests |
| test/runner/runner-stall.test.ts (NEW) | runner | internal | Stall/max-turns/terminal-first matrix |
| test/runner/runner.test.ts | runner | internal | Timeout test extended: `terminalReason: 'timeout'`, hung-terminate variant |
| test/cli/run-budget-flags.test.ts (NEW) | cli | internal | Flag parsing/validation/budget recording via built CLI |
| test/cli/status-terminal-reason.test.ts (NEW) | cli | internal | Envelope + TTY passthrough of new reasons |
| test/cli/docs-vocabulary.test.ts | cli | internal | Guard rows for new `terminalReason` values |
| README.md · CHANGELOG.md · docs/domains/{runner,adapter,cli}/domain.md | — | docs | Budgets, vocabulary, Windows stance, domain history |
| package.json · package-lock.json | — | infra | `@github/copilot-sdk` ^1.0.0 → 1.0.1 installed |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | CD-01 — timeout cleanup awaits (`terminate()` → `resumeSession`/`abort`/`destroy`, `sdk-copilot.ts:306-324`; run-`finally` `disconnect()` :263) are unbounded JSON-RPC calls into the hung subprocess; a hang blocks all terminal writes (`runner.ts:1171-1207` → :1380-1399 never reached) | T002–T004: `withDeadline` + bounded rungs + `forceStop` escalation; bound the runner's `await adapter.terminate()` too |
| 02 | Critical | CD-02 — completion contract is `await idlePromise` (`sdk-copilot.ts:204`), settled only by `session.idle`/`session.error`; silent stalls settle nothing | T005: inactivity race arm reset on every `handleEvent` (`runner.ts:951`) |
| 03 | High | CD-03/CD-04 — no turn budget; existing timeout writes no `terminalReason` (final patch `runner.ts:1390-1399` lacks it) | T004 (`'timeout'`), T006 (`--max-turns` via `stats.messages`, `runner.ts:910-920`) |
| 04 | High | `Number.parseInt` flag parsing accepts NaN/negative (`run.ts:425-427`, `resume.ts:586`); new budget flags need validation | T007: E108 on invalid; `0` = disable for stall/turns |
| 05 | Medium | CD-05 — `DEFAULT_TIMEOUT = 900` (`run.ts:276`) vs resume's hardcoded `'300'` (`resume.ts:586`); runner message hardcodes `?? 300` (`runner.ts:1167`) | T007: single shared default; message reports configured value |
| 06 | Medium | `ICopilotClient` mirror (`copilot-types.ts:105-114`) lacks `forceStop()`; SDK v1.0.0 `client.d.ts` has it (SIGKILL the CLI subprocess — the only rung that can't hang on RPC) | T003: add optional `forceStop?()` to mirror + MockClient + escalation |

## Implementation

**Objective**: Every run reaches a terminal artifact regardless of how the provider stream dies; budgets are operator-tunable and recorded.
**Testing Approach**: Full TDD (red → green per task; deterministic time via short real timers ≤ 500ms following `runner.test.ts:408-439` precedent, or injected deadlines where cheaper). Targeted mocks at the SDK boundary only.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 1: Stall watchdog + budgets" --plan-dir docs/plans/026-stall-watchdog` | — | — | Router envelope handled; boot verdict narrated verbatim before any code | Harness seam — boot `degraded` → SLOW (pre-existing doctor/audit warns); proceeded |
| [x] | T001 | SDK bump: install `@github/copilot-sdk@1.0.1`; sanity-diff installed `.d.ts` (abort/destroy/disconnect/forceStop unchanged) | adapter | package.json, package-lock.json | `just sdk-check` green; `test/adapter/sdk-permission-shapes.test.ts` green; lockfile shows 1.0.1 | Done — drift found: `session.destroy()` removed in 1.0.1 (replacement `client.deleteSession`); handled in T003 |
| [x] | T002 | **TDD** `withDeadline` helper: red tests (passthrough resolve/reject; deadline expiry → resolves to sentinel/`onTimeout`, never throws raw; timer cleared on settle) → implement | adapter | src/adapter/deadline.ts, test/adapter/deadline.test.ts | New tests green; helper leak-free (no open handles in vitest) | Done — 7/7 green; `vi.getTimerCount()===0` leak assertion; timer `unref()`d |
| [x] | T003 | **TDD** bounded adapter cleanup: red tests with never-settling MockSession (`abort`/`destroy`/`disconnect` hang) assert `terminate()` returns within budget and `client.forceStop()` invoked; run-`finally` `disconnect()` bounded → implement (per-rung ~5s via `withDeadline`; add `forceStop?()` to `ICopilotClient` + MockClient) | adapter | src/adapter/sdk-copilot.ts, src/adapter/copilot-types.ts, test/adapter/sdk-copilot.test.ts | Hung-session tests green; existing adapter tests untouched-green | Done — 6 new tests; destroy rung dropped (SDK 1.0.1); `cleanupRungTimeoutMs` injectable; compact-finally bounded too |
| [x] | T004 | **TDD** runner timeout path: **first widen the `terminalReason` union** (`types.ts:430-433` + `'timeout' \| 'stalled-stream' \| 'max-turns'` — prerequisite so this and later red tests compile); red tests — (a) hung `terminate()` fake still yields completed.json + final manifest within bounded window; (b) timeout writes `terminalReason: 'timeout'` **in the final patch (`runner.ts:1390-1399`, which writes no reason today)**; (c) error message reports configured seconds → implement (bound the `await adapter.terminate()` at `runner.ts:1174`) | runner | src/runner/runner.ts, src/runner/types.ts, test/runner/runner.test.ts | Extended timeout tests green (incl. hung-terminate variant); `FakeAgentAdapter` gains an opt-in hang-mode `terminate()` (it returns immediately today, `fake.ts:122-131`) | Done — union widened + `budgets` manifest field + `DEFAULT_TIMEOUT_SEC=900` + `cleanupGraceMs` seam; 19/19 green |
| [x] | T005a | **TDD red** stall watchdog tests: suppressed-idle fake stream goes silent → run terminalizes with `status:'failed'`, `terminalReason:'stalled-stream'`, synthetic `run_stalled` event in events.ndjson, completed.json `result:'failed'` exit 124; twin: continuous events (tool/thinking types included) never trip it; `--stall-timeout 0` disables; stall-vs-idle race matrix (idle lands first → clean completion); **the synthetic `run_stalled` event itself must not reset the deadline or re-trigger the arm** | runner | test/runner/runner-stall.test.ts | Tests exist and fail for the right reason; sub-second stall budgets only (never the 300s default in tests) | Done — 5 red tests via a local `ScriptedAdapter` (real-clock offsets; never-settling run) |
| [x] | T005b | Implement stall watchdog: `stallTimeout` in `AgentRunConfig` (default 300s); inactivity deadline reset in `handleEvent` (`runner.ts:951`); third race arm + `stalled` flag mirroring `timedOut` (incl. handleEvent guard + `.then()` early-return parity); `AgentStalledEvent` interface in events.ts (object-literal emission, `AgentProviderStreamAbortedEvent` shape precedent) + **arms for `run_stalled` in the non-exhaustive switches** (`runner.ts:955` handleEvent, `pretty.ts:27`; `display.ts` already safe via default); emit from the race arm so it bypasses the deadline-reset path; terminal writes reason `'stalled-stream'`; bounded cleanup reused | runner, adapter | src/runner/runner.ts, src/runner/types.ts, src/adapter/events.ts, src/runner/pretty.ts | T005a green; no false trigger in full suite (timers cleaned up) | Done — 5/5 green; full suite 1285 passed, 12s wall (no leaked handles); timeout arm also guards against late double-fire |
| [x] | T006a | **TDD red** max-turns tests: fake run emitting N+1 assistant messages with `maxTurns: N` → terminal `failed` + `'max-turns'`; ≤ N unaffected; `0`/unset = unlimited; a turn = one consolidated assistant message (chunking-independent) | runner | test/runner/runner-stall.test.ts | Tests fail for the right reason | Done — 3 cases incl. chunking-independence (deltas/tool/thinking don't count) |
| [x] | T006b | Implement `maxTurns`: breach check at the `stats.messages` increment; same flag/race/terminal machinery as stall | runner | src/runner/runner.ts, src/runner/types.ts | T006a green | Done — 4th race arm; `budgetBreached()` helper + `budgetMessages` Record (PL-05) unify all three triggers; 838 runner tests green |
| [x] | T007 | **TDD** CLI flags + defaults: red built-CLI tests — `--stall-timeout`/`--max-turns` on `run` **and** `resume` (config assembly at `run.ts:421-430` and its parallel `resume.ts:584-594`); NaN/negative → E108; values threaded to config; effective `budgets: {timeoutSec, stallTimeoutSec, maxTurns}` recorded in run.json; `run`/`resume` share one default-timeout source (frontmatter-aware); → implement | cli, runner | src/cli/commands/run.ts, src/cli/commands/resume.ts, src/runner/types.ts, test/cli/run-budget-flags.test.ts | New CLI tests green; `resume.ts:586` hardcode gone | Done — 14/14; shared parser in NEW src/cli/budget-flags.ts; threading proven via dry-run `budgets` echo; budgets written in initial manifest AND resume-in-place rewrite |
| [x] | T008 | **TDD** status surfacing: red tests — envelope passes `terminalReason:'stalled-stream'` through for a seeded terminalized run; TTY arm prints a `reason:` line when terminalReason present; E170 remedy text mentions `--latest` → implement | cli | src/cli/commands/status.ts, test/cli/status-terminal-reason.test.ts | Tests green via built CLI (NO_COLOR=1 pattern) | Done — 4/4; passthrough was indeed already generic (2 tests green at red stage); TTY `Reason:` line + E170 `--latest` remedy added |
| [x] | T009 | Docs: README budget flags table + semantics (defaults, `0` disables, tool-silence limitation); CHANGELOG; docs-vocabulary guard rows for `'timeout'/'stalled-stream'/'max-turns'`; Windows stance note; draft #44 closing comment correcting the "no --timeout exists" claim (CD-06) | cli | README.md, CHANGELOG.md, test/cli/docs-vocabulary.test.ts, docs/how/* (extend existing page if one fits) | Vocabulary guard green; docs mention every new reason | Done — README § Run budgets; run-liveness.md § Run budgets; CHANGELOG plan-026 block; AGENTS_README polling note; 4 new guard tests (11/11); draft comment at issue-44-comment.md |
| [x] | T010 | Domain docs: History/Contracts rows for runner (config+manifest types), adapter (deadline helper, forceStop mirror, run_stalled), cli (flags); domain-map edge labels if changed | — | docs/domains/{runner,adapter,cli}/domain.md, docs/domains/domain-map.md | Tables updated; `just fft` fully green (1265+ tests) | Done — 3 History rows + Contracts/Concepts/Composition/Tests updates; runner→adapter edge gains `withDeadline`; `just fft` exit 0, **1310 passed** |
| [x] | T011 | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/026-stall-watchdog` | — | — | Router envelope handled (drain-vs-harvest is the router's call) | Done — 2 frictions captured (`DL-001` SDK-method-surface sensor gap; `SUGG-001` no CLI fake-adapter seam); buffer non-empty → route = drain; menu presented to Jordan at the seam |

### Acceptance Criteria

- [x] AC-1 Stall terminalizes: silent stream + stall budget → `run.json` `failed`/`stalled-stream`, `run_stalled` event, completed.json (`failed`, 124), no hang (T005) — `runner-stall.test.ts` silent-stall case
- [x] AC-2 Hung cleanup cannot block terminal writes; `forceStop` escalation invoked (T003/T004) — hung-session terminate tests + hung-terminate runner test
- [x] AC-3 Wall-clock timeout writes `terminalReason: 'timeout'` (T004) — `runner.test.ts` final-patch test
- [x] AC-4 `--max-turns N` breach → `failed`/`max-turns`; ≤ N unaffected (T006) — breach/at-budget/unlimited cases
- [x] AC-5 No false trigger on continuously-flowing events of any type; `--stall-timeout 0` disables (T005) — flowing-events + disable cases
- [x] AC-6 Flags on run+resume, validated (E108), threaded, budgets recorded in run.json (T007) — 14 built-CLI tests + budgets assertion in runner suite
- [x] AC-7 `status`/`runs` envelope passes new reasons through end-to-end (T008) — seeded-run envelope test
- [x] AC-8 Shared default timeout; runner message reports configured value (T004/T007) — defaults-echo test (900/300/0) + message assertion
- [x] AC-9 SDK at 1.0.1; permission-shape pin + `just sdk-check` green (T001) — `✓ 1.0.1 (latest)`
- [x] AC-10 README/CHANGELOG/vocabulary guard cover the three new reasons; Windows + tool-silence stances documented (T009) — 4 new guard tests
- [x] AC-11 E170 remedy text mentions `--latest` (behavior unchanged) (T008) — remedy test

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Third/fourth race arms tangle with `timedOut`/`adapterSettled` early-returns (`runner.ts:1143-1163`) | Medium | High | T005a race matrix (stall-before-idle, idle-before-stall, stall-during-completing); flags mirror the existing pattern exactly |
| Long silent tool executions (>300s) false-trigger | Medium | Medium | Any-event reset; documented knob + `0` disable; README limitation note (T009) |
| Watchdog timers leak handles → vitest hangs / process won't exit | Medium | Medium | T002 leak assertions; timers cleared in `finally` alongside `timeoutHandle` (`runner.ts:1205`) |
| `forceStop` absent on a future client shape | Low | Low | Mirror types it optional (`forceStop?.()`); escalation skips gracefully |
| `forceStop()` itself misbehaves — process-level, not TDD-provable | Low | Medium | Terminal writes never depend on it (bounded ladder + terminal-first invariant); real-process teardown is integration-scoped, documented |
| SDK 1.0.1 shape drift | Low | Low | T001 first + permission-shape pin + sdk-check |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door; child skills never named.
- **Backpressure** (post-spec): ran — see [backpressure-coverage.md](./backpressure-coverage.md) (Certainty: **Partial**). Recommended Phase 0 folded into T002/T003/T005a (the opening TDD tasks) rather than a separate phase.
- **Pre-implement**: T000 fires `--event pre-implement`; verdict narrated verbatim (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`).
- **Phase end**: T011 fires `--event phase-end`; `--event plan-complete` fires at merge.
- **Best-effort**: advisory, never blocks.

## Validation Record (validate-v2, 2026-06-11)

Four parallel validators (coherence · source-truth/completeness · thesis alignment · forward-compatibility) ran against this plan; all fixes applied in the same pass.

- **Coherence**: COHERENT-WITH-FIXES → fixed: spec BC-5 status contradiction resolved with an explicit three-trigger matrix (run.json `failed` for all three; completed.json `timeout`/`failed`/`failed`; exit 124/E123); G6 note corrected (T002 is not a pure test task); `sdk-permission-shapes.test.ts` added to the manifest; T007/T008 dependency notes added.
- **Source-truth**: 16/18 file:line claims CONFIRMED against code; 2 corrected → fixed: `terminalReason` union widening made an explicit early prerequisite (T004); `run_stalled` switch arms (`runner.ts:955`, `pretty.ts:27`) added to T005b; FakeAgentAdapter hang-mode wording corrected (`fake.ts:122-131` returns immediately today); `resume.ts:584-594` pinned as the parallel threading site.
- **Thesis**: SOUND, Implementation-ready; value claim advanced; all 11 ACs map to tasks → fixed: minih-process signal death + both-budgets-disabled documented as spec non-goals; `run_stalled` no-self-reset test added (T005a); turn definition pinned (BC-6); `forceStop` untestability documented as a risk in spec + plan.
- **Forward-compatibility**: manifest readers tolerant (`run-manifest.ts:78` permissive cast; `?? null` patterns); resume eligibility decoupled from reasons; exit-code mapping reason-agnostic (`run.ts:686-687` E123) → fixed: subprocess tests pinned to tiny real budgets (T007 note); vocabulary-guard rows ordered inside T009.
- **Outcome alignment** (echoed verbatim from the FC validator): "The plan **advances the Outcome**. Readers (status, runs, inventory) are tolerant of new fields. Resume eligibility is decoupled from reasons. Exit code path is safe. The plan's T004 must address the pre-existing `config.timeout` message hardcoding to avoid regression."

## Discoveries & Learnings

| # | Type | Discovery | Resolution |
|---|------|-----------|------------|
| 01 | gotcha | SDK 1.0.1 removed `session.destroy()` (replacement: `client.deleteSession(sessionId)`); our mirror `ICopilotSession.destroy()` kept tsc green while the runtime call would have thrown TypeError (absorbed by terminate()'s try/catch). Also: 1.0.1's `exports` map no longer exposes `./package.json`. | T003 drops the destroy rung from `terminate()` and makes the mirror match 1.0.1 (`destroy` removed; optional `forceStop?()` added on the client) |
