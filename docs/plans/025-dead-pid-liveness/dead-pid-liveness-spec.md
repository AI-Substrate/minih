# Dead-PID Liveness — status tells the truth about dead runs

**Mode**: Simple

📚 Specification incorporates findings from research-dossier.md

## Research Context

From `research-dossier.md` (8 subagents, 58 findings, 2026-06-11):

- `minih status` is the **last liveness path that never probes the pid** — verdict comes from an `events.ndjson` mtime heuristic (`status.ts:258-264`, 60s threshold). The probe (`isProcessAliveDefault`, `run-eligibility.ts:37-45`) already exists and is already used by the resolver (plan 016) and `minih runs` inventory (plan 023). This fix is assembly, not invention.
- All three plan-018 FX dossiers (FX009 status probe, FX011 reconcile healer, FX012 provider_stream_aborted event) **survive code drift untouched and are 0% implemented**. Plan 023 even pre-built FX011's `--all` discovery walker (`run-inventory.ts:213-244`).
- The proof question is answered by repo precedent: injected-predicate unit tests (`test/runner/run-resolver.test.ts:204-252`) + real-reaped-pid CLI smoke (`run-target-ambiguity.test.ts` live-pid fixture pattern).
- ⚠️ CF-02: adding `verdict: 'dead'` is a **documented breaking change** — `select(.verdict == "active")` jq filters are load-bearing in AGENTS.md, AGENTS_README.md (×3), and the companion's outside.md.

## Summary

Issue #24: a run whose process died (SIGKILL, OOM, provider death) reads `verdict: "active"` from `minih status` for up to 60 seconds, then `"stale"` forever — never `dead`. `run.json.status` stays `'active'` permanently because crashes never write a terminal event. Host agents poll, see "active", and have to go digging.

This plan ships Group 1 as a staged trio, in dossier dependency order, each stage independently shippable:

1. **FX009 — detection**: `minih status` probes the recorded pid; dead → `verdict: "dead"` plus gated diagnostic fields. Kills the headline lie at read time.
2. **FX012 — diagnosis**: the adapter emits a synthetic `provider_stream_aborted` event when a stream dies mid-flight; the runner maps it to `terminalReason: 'provider-stream-aborted'` in run.json. Records *why* at crash time (when the runner process survives the provider).
3. **FX011 — healing**: `minih reconcile` walks runs, flips dead "active" runs to `status: 'crashed'` + `terminalReason: 'pid-vanished'` (never overwriting an existing terminalReason), lock-guarded. Makes the *record* stop lying, not just the status read.

## Goals

- `minih status <target>` never reports a dead process as active: probe the recorded pid; dead → `verdict: "dead"` with diagnostic payload fields (pid, pidAlive, last-activity timestamp, terminalReason passthrough).
- **One liveness vocabulary**: `minih runs` inventory also reports dead-pid runs as `'dead'` (today it demotes them to `'stale'`). Status and runs speak the same language; one CHANGELOG story.
- **One probe, one error semantics**: upgrade shared `isProcessAliveDefault` to the FX009-3 spec — ESRCH→dead, **EPERM→alive (conservative)**, EINVAL→dead. Resolver, inventory, and status all inherit it.
- Crash-time diagnosis (FX012) and on-demand healing (FX011) per the Summary stages.
- **Deterministic proof**: 9-case unit matrix via injected `isProcessAlive` predicate + 1-2 real-reaped-pid CLI smokes. No eyeball-only acceptance criteria.
- Orchestrator-facing docs migrate cleanly: jq filter migration snippet, `dead`/`crashed` treated as terminal in every documented polling loop.

## Non-Goals

- Inbox/communication fixes (Groups 2-3: issues #40, #32, #35, #36) — separate plans.
- State-channel schema fixes (issues #27, #31, #29).
- A background auto-reconcile daemon/watcher — `minih reconcile` is on-demand in v1.
- The permission-prober scenario matrix as liveness proof (rejected in dossier: wrong layer, not in CI).
- `peer-activity.ts`'s unrelated `'dead'` vocabulary (different envelope; docs must not conflate, but no code change).
- Multi-message in-flight tracking for FX012 (latest in-flight messageId only — intentional v1 per dossier PL-06).

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|---------------------|
| cli | existing | **modify** | status verdict probe + envelope gating + TTY `dead` render; `runs` liveness vocabulary; new `reconcile` command (thin shell) |
| runner | existing | **modify** | probe error-spec upgrade (`run-eligibility.ts`); type widenings (`terminalReason`, `LiveRunStatus` +`'crashed'`, liveness +`'dead'`); reconcile core + lock (mirrors `resume-lock.ts`); map `provider_stream_aborted` → terminalReason |
| adapter | existing | **modify** | `AgentEvent` union + `provider_stream_aborted` emit on truncated stream (`sdk-copilot.ts`; precedent: `AgentPermissionDeniedEvent`) |

No new domains. Import direction holds throughout (cli→runner, runner→adapter); runner owns all run.json writes.

## Testing Strategy

- **Approach**: Hybrid.
  - **TDD** for the logic cores: status verdict function (9-case matrix), probe error discrimination (ESRCH/EPERM/EINVAL), reconcile healer core (incl. terminalReason preservation invariant + lock TTL/steal), adapter abort tracking (fake adapter).
  - **Lightweight** for shells: CLI wiring, TTY rendering, envelope shape — covered by 1-2 real-reaped-pid subprocess smokes (`node -e "process.exit(0)"`, reap, probe corpse pid through built CLI) plus a live twin using `process.pid`.
- **Mock Usage**: Targeted — injected `isProcessAlive` predicates (PL-08: never hardcode fake pids) and the existing fake-adapter pattern at the SDK boundary. Real tmpdir fixtures (`makeManifest`/`writeManifest` builders) everywhere else.
- **Focus Areas**: verdict precedence (completed.json > probe > mtime), probe error spec across all three consumers, preservation invariant (healer never overwrites `provider-stream-aborted`), reconcile idempotency, existing live-pid verdict assertions keep passing (regression).
- **Excluded**: permission-prober scenarios, real-SDK end-to-end stream aborts (fake adapter stands in), pid-reuse race simulation (accepted residual risk, see Risks).

## Documentation Strategy

- **Location**: Hybrid (README + docs/how/).
  - README: status verdict vocabulary (`dead` added), `minih reconcile` CLI reference rows.
  - `docs/how/run-liveness.md` (new): how dead detection works, what each `terminalReason` means, when to run reconcile — joins `parallel-runs.md`.
- **Mandatory regardless of location choice** (breaking change, CF-02): CHANGELOG entry with jq migration snippet (FX009 dossier has one ready), AGENTS_README.md (×3 spots), AGENTS.md:161 docstring, `agents/code-review-companion/outside.md` — every documented polling loop treats `dead` as terminal.
- **Rationale**: orchestrating agents are the primary consumers of these envelopes; agent-facing docs are load-bearing contract surface here, not garnish.

## Complexity

- **Score**: CS-3 (medium, upper end)
- **Breakdown**: S=2, I=1, D=1, N=0, F=1, T=2 → P=7
- **Confidence**: 0.85
- **Assumptions**: plan-023 working-tree changes (`runs.ts`, `run-inventory.ts`) land with or before this work; status/reconcile run on the same host as the probed run (single-machine pid semantics); `process.kill(pid, 0)` behavior on darwin/linux per Node docs.
- **Dependencies**: none external. Internal staging: FX012 needs the `terminalReason` type widening; FX011 needs FX009's probe pattern + FX012's terminalReason value (preservation test b2). Ship order FX009 → FX012 → FX011.
- **Risks**: see Risks & Assumptions.
- **Phases**: Simple mode — single implementation flow, internally staged FX009 → FX012 → FX011 (each stage leaves the repo shippable).

## Acceptance Criteria

1. **Dead detection**: an `'active'`-status run whose pid is not alive yields `verdict: "dead"` from `minih status --json`, with payload fields `pid`, `pidAlive: false`, and last-activity timestamp. Proven by injected-predicate unit tests.
2. **No live regression**: an `'active'`-status run whose pid IS alive keeps today's verdict semantics (`active` under the 60s mtime threshold, `stale` past it). Existing live-pid fixtures (`run-target-ambiguity.test.ts`) pass unmodified.
3. **Terminal precedence**: runs with `completed.json` report `completed`/`failed` and never probe the pid.
4. **Vocabulary unified**: `minih runs` reports `'dead'` (not `'stale'`) for dead-pid active runs; alive-run rows unchanged.
5. **Probe error spec**: `isProcessAliveDefault` returns false on ESRCH/EINVAL/non-positive pid, **true on EPERM**; unit-tested, and both pre-existing consumers (resolver, inventory) have coverage of the EPERM-alive path.
6. **Stream-abort diagnosis**: when a provider stream ends without settlement, a `provider_stream_aborted` event lands in `events.ndjson` and run.json gains `terminalReason: 'provider-stream-aborted'`. Proven via fake adapter.
7. **Healing**: `minih reconcile <target>` and `--all` flip dead `'active'` runs to `status: 'crashed'` + `terminalReason: 'pid-vanished'`; an existing terminalReason is **never overwritten** (preservation invariant AC-FX11.9); re-running reconcile is a no-op.
8. **Reconcile safety**: concurrent reconcile invocations are lock-guarded (mirrors `resume-lock.ts`), with stale-lock TTL + steal (PL-10).
9. **terminalReason surfaced**: `minih status` passes through all three terminalReason values when present (`permission-denied`, `provider-stream-aborted`, `pid-vanished`).
10. **TTY render**: `verdict: dead` and `status: crashed` render distinctly in human output.
11. **Deterministic proof**: the 9-case verdict matrix (alive / dead / completed-skips-probe / no-pid / injection-override / pid 0 / pid<0 / EPERM→alive / EINVAL→dead) passes with zero real processes; ≥1 reaped-real-pid CLI smoke + 1 live-pid twin pass end-to-end.
12. **Docs migrated**: CHANGELOG breaking-change entry with jq migration snippet; AGENTS_README.md, AGENTS.md, companion outside.md polling examples treat `dead`/`crashed` as terminal states.
13. **Domain currency**: History rows added to cli, runner, and adapter domain.md files (the F004/F005 lesson from the 024 review).

## Risks & Assumptions

| Risk | Mitigation |
|------|------------|
| Breaking change strands existing jq filters / polling loops | CHANGELOG migration snippet + all documented filters updated in the same release (AC-12) |
| Pid reuse: recycled pid reads "alive" for a dead run | Accepted residual risk — window is small, consequence is the status quo (false active); reconcile uses the same probe so healing converges |
| EPERM→alive keeps a truly-dead run "active" in permission-restricted sandboxes | Conservative-alive is the correct failure direction (never falsely kill); documented in run-liveness.md |
| Real-pid smoke flake (pid reuse inside test window) | Keep to 1-2 smokes; the matrix runs on injected predicates (PL-08) |
| Reconcile racing a live writer | Lock + TTL/steal; probe immediately before write; preservation invariant limits damage |
| Probe behavior change ripples to resolver/inventory | Deliberate (clarified): covered by new tests on both existing callers (AC-5) |

**Assumptions**: single-host pid semantics; plan-023 inventory code is present; no AJV schema work needed (run.json/events are TypeScript-typed by design, `types.ts:265-268`).

## Open Questions

None — the dossier's four open questions were resolved in the 2026-06-11 clarification session below.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| — | — | None identified: all three fixes have validated design dossiers (plan 018) with ACs, plus shipped repo precedent for every pattern (probe injection, synthetic events, lock files). A workshop would re-litigate settled designs. | — |

## Clarifications

### Session 2026-06-11

- Q: Scope — FX009 alone, FX009+FX012, or full trio staged? → A: **Full trio, staged** (FX009 → FX012 → FX011, each independently shippable).
- Q: Liveness vocabulary (CF-01) — should `minih runs` also say `'dead'`, or keep demoting to `'stale'`? → A: **Unify on `'dead'`** (023 behavior is uncommitted; change is free now).
- Q: Test injection seam (CF-04) — exported verdict fn, handler deps param, or subprocess-only? → A: **Exported verdict function** with optional `{isProcessAlive}` deps param; unit matrix imports it directly; subprocess smokes stay end-to-end.
- Q: Probe error handling (CF-03) — upgrade shared probe, fork status-local, or defer? → A: **Upgrade shared `isProcessAliveDefault`** to the FX009-3 error spec; resolver + inventory + status all inherit.
- Q: Workflow Mode — Full (recommended for 3 phases/3 domains) or Simple? → A: **Simple** (user override; CS-3 supports it — staged trio runs as one implementation flow).
- Q: Testing strategy? → A: **Hybrid** (TDD logic cores, lightweight CLI shells/smokes).
- Q: Mock usage? → A: **Targeted** (injected predicates + fake adapter; real fixtures elsewhere).
- Q: Documentation strategy? → A: **Hybrid** (README + docs/how/run-liveness.md; breaking-change updates mandatory regardless).
