# Dead-PID Liveness Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-11
**Spec**: [dead-pid-liveness-spec.md](./dead-pid-liveness-spec.md)
**Status**: READY

📚 Informed by [research-dossier.md](./research-dossier.md) (58 findings) and [backpressure-coverage.md](./backpressure-coverage.md) (Certainty: Partial — its Recommended Phase 0 is folded in as the seams-first task ordering: T001/T002 before any behavior, T006 smoke, T014 guard).

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; all 4 dossier open questions resolved in spec Clarifications (2026-06-11) |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` (domain-map direction checked under G7) |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required sections present; task table carries Done-When per row |
| G6 | Testing Alignment | PASS | Hybrid per spec: TDD tasks (T001, T003, T008–T011) note tests-first; shell tasks each carry a validation step; mocks targeted (injected predicates + fake adapter) |
| G7 | Domain Completeness | PASS | cli/runner/adapter all existing in registry; no NEW domains; manifest covers every task file; import direction holds (cli→runner→adapter) |

## Summary

`minih status` (and the run record itself) reports dead runs as active because no liveness path in the status command probes the recorded pid. This plan ships the Group-1 trio staged in dependency order — FX009 (status probes the pid → verdict `dead` + diagnostics), FX012 (adapter emits `provider_stream_aborted`; runner records `terminalReason`), FX011 (`minih reconcile` heals `run.json` to `crashed`/`pid-vanished` under a lock) — with the two test-injection seams built first so every behavior lands with its sensor already reachable. The verdict vocabulary unifies on `dead` across `status` and `runs`, shipped as a documented breaking change (jq filter migration).

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| cli | existing | modify | status verdict probe + envelope/TTY; runs `dead` rendering; new `reconcile` command (thin shell); error code E190 |
| runner | existing | modify | probe error spec + kill-fn seam; type widenings; reconcile core + lock; `provider_stream_aborted` → terminalReason mapping |
| adapter | existing | modify | `AgentProviderStreamAbortedEvent` + emit on unsettled stream end; fake-adapter abort seam |

## Domain Manifest

> Anchors and behavior descriptions below describe the **post-implementation** state; current-state deltas (e.g. `run-inventory.ts:192` returns `'stale'` today, `RunLiveness` has 5 values today) are owned by the task that changes them.

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/runner/run-eligibility.ts` | runner | contract | `isProcessAliveDefault` exported via `runner/index.ts:235`, consumed by cli |
| `src/runner/types.ts` | runner | contract | `RunLiveness` (+`'dead'`, :453-458), `LiveRunStatus` (+`'crashed'`, :347-354), `terminalReason` widening (:420) |
| `src/runner/run-inventory.ts` | runner | contract | `computeLiveness` dead branch (:192) returns `'dead'`; walkers reused by reconcile |
| `src/runner/reconcile.ts` (NEW) | runner | contract | healer core, exported for cli shell |
| `src/runner/reconcile-lock.ts` (NEW) | runner | contract | lock mirror of `run-lock.ts`; cli consumes `withReconcileLock`/`ReconcileLockHeldError` via the barrel (reclassified per review F004) |
| `src/runner/runner.ts` | runner | internal | event → `terminalReason` mapping (mirrors :767-794, :1201-1225) |
| `src/runner/index.ts` | runner | contract | export reconcile surface |
| `src/adapter/events.ts` | adapter | contract | `AgentEvent` union (:235-247) + new event interface |
| `src/adapter/sdk-copilot.ts` | adapter | internal | abort detection in idle-promise region (:135-177) |
| `src/adapter/fake.ts` | adapter | internal | abort-scenario seam (auto-idle at :84 must be suppressible) |
| `src/cli/commands/status.ts` | cli | internal | exported verdict fn (new pattern; today only `registerStatusCommand` exports), probe wiring, envelope (:341-358), TTY switch (:279-299) |
| `src/cli/commands/runs.ts` | cli | internal | `dead` row rendering |
| `src/cli/commands/reconcile.ts` (NEW) | cli | internal | thin shell over runner core |
| `src/cli/index.ts` | cli | internal | register `reconcile` |
| `src/cli/output.ts` | cli | contract | E190 RECONCILE_IN_PROGRESS |
| `test/runner/run-eligibility.test.ts` | runner | internal | probe error-spec matrix |
| `test/cli/status-verdict.test.ts` (NEW) | cli | internal | direct-import 9-case verdict matrix |
| `test/cli/status-dead-smoke.test.ts` (NEW) | cli | internal | reaped-pid + live-twin subprocess smokes |
| `test/runner/run-inventory.test.ts` | runner | internal | dead → `'dead'` liveness |
| `test/cli/runs.test.ts` | cli | internal | dead row in `runs list` |
| `test/adapter/sdk-copilot.test.ts` | adapter | internal | abort emit scenarios |
| `test/adapter/fake.test.ts` | adapter | internal | abort seam coverage |
| `test/runner/runner-event-driven.test.ts` | runner | internal | abort event → run.json mapping |
| `test/runner/reconcile.test.ts` (NEW) | runner | internal | healer core incl. preservation case b2 |
| `test/runner/reconcile-lock.test.ts` (NEW) | runner | internal | lock contention/steal |
| `test/cli/reconcile-command.test.ts` (NEW) | cli | internal | end-to-end heal via built CLI |
| `test/cli/docs-vocabulary.test.ts` (NEW) | cli | internal | dead-is-terminal guard over 4 doc surfaces |
| `CHANGELOG.md`, `AGENTS_README.md`, `AGENTS.md`, `agents/code-review-companion/outside.md`, `README.md`, `docs/how/run-liveness.md` (NEW) | — | docs | breaking-change migration + liveness guide (AC-12) |
| `docs/domains/{cli,runner,adapter}/domain.md` | — | docs | History/Composition currency (AC-13) |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | status.ts is the **last** liveness path not probing the pid — the probe is already exported (`runner/index.ts:235`) and already injectable in resolver (`DetectRunStateOptions`) and inventory (`computeLiveness` takes `isProcessAlive`) | Wire, don't reinvent (PL-01); status gains the same injection shape |
| 02 | Critical | `verdict: 'dead'` breaks documented jq filters (`AGENTS.md:161`, `AGENTS_README.md:1116,1140-1153`, companion `outside.md`) | T013 docs migration + T014 vocabulary guard test; CHANGELOG carries the jq snippet |
| 03 | High | EPERM is unproducible against real pids in CI, and `run-eligibility.test.ts` exercises the real probe in exactly one place (line 153) | T001 adds a kill-fn injection seam FIRST (backpressure Phase-0, seams-before-behavior) |
| 04 | High | `terminalReason` is the cross-FX spine; the healer must never overwrite FX012's diagnosis (AC-FX11.9) | One widening in `types.ts:420` (T007); preservation invariant test case b2 (T010) |
| 05 | High | The synthetic-event → manifest-write precedent exists end-to-end for `permission_denied` (`events.ts:201-233`; `runner.ts:720-794, 1201-1225`) | T007–T009 mirror it exactly: event shape, NDJSON append, `updateManifest` write |
| 06 | High | `FakeAgentAdapter` auto-appends `session_idle` after every turn (`fake.ts:84`) — an aborted stream cannot currently be simulated | T008 adds an abort-scenario seam to the fake (adapter-internal test-double change) |

## Implementation

**Objective**: Make every liveness surface tell the truth about dead runs — detection (`status`), diagnosis (`terminalReason`), and healing (`reconcile`) — each stage proven by deterministic tests before the next begins.

**Testing Approach**: Hybrid (from spec) — TDD for logic cores (probe error spec, verdict matrix, abort tracking, healer, lock); lightweight subprocess smokes for CLI shells. Mocks targeted: injected `isProcessAlive`/kill-fn predicates and the fake adapter only; real tmpdir fixtures everywhere else.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Implementation" --plan-dir docs/plans/025-dead-pid-liveness` | — | — | Router envelope handled; verdict narrated verbatim before any code | _Harness seam_ |
| [x] | T001 | Probe error spec + kill seam: `isProcessAliveDefault(pid, deps?)` gains an injectable `kill` fn (default `process.kill`) and discriminates `err.code` in the catch: ESRCH→false, **EPERM→true**, EINVAL→false, unknown→false (non-positive/non-integer pid stays false, kill never called) | runner | `src/runner/run-eligibility.ts`, `src/runner/index.ts`, `test/runner/run-eligibility.test.ts` | TDD: error-spec tests written first with fake kill fns throwing coded errors (ESRCH/EPERM/EINVAL/unknown); ≥1 EPERM→alive case exercised through resolver AND inventory injected probes; existing suites stay green | Finding 03; CF-03; backpressure seam #2 |
| [x] | T002 | Extract exported `computeStatusVerdict(...)` from the status.ts verdict chain (:240-264) with explicit inputs + optional `{isProcessAlive, now}` deps — **no behavior change** | cli | `src/cli/commands/status.ts`, `test/cli/status-verdict.test.ts` | Characterization tests pin current verdicts (completed/failed/active/stale/unknown) via direct import; all existing subprocess suites green | FX009-2; backpressure seam #1; new-but-clean direct-import pattern for test/cli; refactor-for-testability only — T003 then extends behavior and updates the matrix |
| [x] | T003 | Wire the probe: manifest non-terminal + dead pid → verdict `'dead'` (union at :240 widens 5→6 values, adds `'dead'`); completed.json still wins; mtime semantics unchanged for live pids | cli | `src/cli/commands/status.ts`, `test/cli/status-verdict.test.ts` | TDD: 9-case matrix green — alive / dead / completed-skips-probe (throwing predicate proves not-called) / no-pid fall-through (probe not attempted) / injection override / pid 0 / pid<0 / EPERM→active / EINVAL→dead | AC-1/2/3; Finding 01; healed-manifest (`'crashed'`) matrix case lands in T010, after the type exists |
| [x] | T004 | Envelope + TTY: payload (:341-358) gains `pid`, `pidAlive`, `lastEventAt` when probe ran; TTY **color AND icon ternary chains** (:279-299) gain explicit `'dead'` arms — their default fallbacks would otherwise swallow `'dead'` silently (no tsc exhaustiveness protection there); `terminalReason` passthrough verified for all three values | cli | `src/cli/commands/status.ts`, `test/cli/status-verdict.test.ts` | Envelope keys asserted in matrix tests; gating: fields absent when probe not consulted; `'dead'` color/icon arms asserted (no default fall-through) | AC-1/9/10 |
| [x] | T005 | Vocabulary unify: `RunLiveness` +`'dead'` (`types.ts:453-458`); `computeLiveness` dead branch (`run-inventory.ts:192`) returns `'dead'`; `runs` table/TTY renders it | runner, cli | `src/runner/types.ts`, `src/runner/run-inventory.ts`, `src/cli/commands/runs.ts`, `test/runner/run-inventory.test.ts`, `test/cli/runs.test.ts` | Inventory unit test: dead pid → `'dead'` not `'stale'`; `runs list` subprocess test shows dead row; live rows unchanged | AC-4; CF-01; `run-resolver.ts` `computeLiveness` (:407-427) deliberately stays mtime-only this plan (`collectActiveRuns` already probes) — asymmetry documented in run-liveness.md (T013) |
| [x] | T006 | Reaped-pid smokes: spawn `node -e "process.exit(0)"`, await exit, write corpse pid into fixture run.json, exec built CLI → `verdict: 'dead'`; live twin uses `process.pid` → `'active'` | cli | `test/cli/status-dead-smoke.test.ts` | Smoke (a) reaped corpse pid → `'dead'`; smoke (b) live `process.pid` → `'active'`; both via built CLI with the REAL probe; ≤2 spawn tests total | AC-11; PL-08; spawn precedent `test/mcp/leak-regression.test.ts`; smokes are confirmatory — the T003 matrix carries the deterministic proof |
| [x] | T007 | Type widenings: `terminalReason` (:420) → `'permission-denied' \| 'provider-stream-aborted' \| 'pid-vanished'`; `LiveRunStatus` (:347-354) +`'crashed'`; new `AgentProviderStreamAbortedEvent` + `AgentEvent` union entry (:235-247) | runner, adapter | `src/runner/types.ts`, `src/adapter/events.ts` | `npx tsc --noEmit` green across all consumers (tsc is the contract sensor); event shape mirrors `AgentPermissionDeniedEvent` (:201-233) | Findings 04/05; CF-05 |
| [x] | T008 | Adapter abort detection: track latest in-flight messageId; stream end/error without settlement (idle-promise region `sdk-copilot.ts:135-177`) emits `provider_stream_aborted` exactly once; extend `FakeAgentAdapter` with an abort-scenario seam (suppress auto-idle at `fake.ts:84`) | adapter | `src/adapter/sdk-copilot.ts`, `src/adapter/fake.ts`, `test/adapter/sdk-copilot.test.ts`, `test/adapter/fake.test.ts` | TDD: fake-driven tests prove abort emits one event (messageId + reason); normal settle emits none | AC-6; PL-06 (latest in-flight only); Finding 06 |
| [x] | T009 | Runner mapping: `provider_stream_aborted` → events.ndjson append + `updateManifest` writes `terminalReason: 'provider-stream-aborted'` (mirror permission-denial precedent `runner.ts:767-794`, `:1201-1225`; atomic write) | runner | `src/runner/runner.ts`, `test/runner/runner-event-driven.test.ts` | TDD: fake-adapter abort run yields run.json terminalReason + event in events.ndjson | AC-6; Finding 05 |
| [x] | T010 | Reconcile core: export `listAgentSlugs`/`listRunDirs` from `run-inventory.ts` (private today), walk via them (:213-244), probe pid (injected), heal non-terminal+dead → `status: 'crashed'` + `terminalReason: 'pid-vanished'` **only when unset**; idempotent | runner | `src/runner/reconcile.ts` (NEW), `src/runner/run-inventory.ts`, `src/runner/index.ts`, `test/runner/reconcile.test.ts`, `test/cli/status-verdict.test.ts` | TDD: preservation case b2 (existing `'provider-stream-aborted'` survives heal), idempotent re-run no-op, completed runs untouched, atomic writes; status matrix gains the healed-manifest case (`status:'crashed'` + dead pid → verdict `'dead'`) | AC-7; PL-07; Finding 04; reuse walker (anti-reinvention) |
| [x] | T011 | Reconcile lock: mirror `run-lock.ts` (`'wx'` first-write-wins, `staleAfterMs` + dead-owner steal using the T001 probe) | runner | `src/runner/reconcile-lock.ts` (NEW), `test/runner/reconcile-lock.test.ts` | TDD: concurrent acquire fails cleanly; stale + dead-owner lock stolen; release idempotent | AC-8; PL-10 |
| [x] | T012 | CLI `reconcile` command: `minih reconcile [slug] [--run <id>] [--all]` thin shell; envelope lists healed runs; E190 RECONCILE_IN_PROGRESS on lock contention | cli | `src/cli/commands/reconcile.ts` (NEW), `src/cli/index.ts`, `src/cli/output.ts`, `test/cli/reconcile-command.test.ts` | Subprocess test: dead-pid fixture heals (run.json flipped); re-run reports nothing to heal; envelope shape + E190 asserted | AC-7/8 |
| [x] | T013 | Docs migration: CHANGELOG breaking-change entry + jq migration snippet; `AGENTS_README.md` (:1116 vocabulary + :1140-1153 polling loops); `AGENTS.md` (jq filter :99 + load-bearing note :161); companion `outside.md`; README CLI rows (verdict vocabulary + reconcile); NEW `docs/how/run-liveness.md` incl. disambiguation note: run-liveness `'dead'` vs peer-activity `'dead'` are unrelated envelopes | — | `CHANGELOG.md`, `AGENTS_README.md`, `AGENTS.md`, `agents/code-review-companion/outside.md`, `README.md`, `docs/how/run-liveness.md` | Every documented polling loop treats `dead`/`crashed` as terminal; jq snippet present; resolver-asymmetry + peer-activity disambiguation present in run-liveness.md | AC-12; Finding 02; CF-02; AGENTS_README.md re-bundles to dist/ via `scripts/copy-schemas.js` — rebuild after editing |
| [x] | T014 | Vocabulary guard test over the 4 doc surfaces (precedent: `test/cli/doctor-state-vocabulary.test.ts`) | cli | `test/cli/docs-vocabulary.test.ts` (NEW) | Guard fails if any surface loses dead-is-terminal vocabulary | AC-12 mechanical half; backpressure optional sensor |
| [x] | T015 | Domain currency: History rows + Composition/Contract entries for new files in cli, runner, adapter domain.md | — | `docs/domains/cli/domain.md`, `docs/domains/runner/domain.md`, `docs/domains/adapter/domain.md` | Each has a `025-dead-pid-liveness` History row; new files in Composition tables | AC-13; the F004/F005 lesson from 024 review |
| [x] | T016 | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/025-dead-pid-liveness` | — | — | Router envelope handled at phase end | _Harness seam_ |

### Acceptance Criteria

- [x] AC-1: dead-pid active run → `verdict: "dead"` with `pid`/`pidAlive: false`/last-activity in `minih status --json` (injected-predicate unit proof) — `status-verdict.test.ts` matrix case 2 + T004 diagnostics cases
- [x] AC-2: live-pid runs keep today's active/stale mtime semantics; `run-target-ambiguity.test.ts` passes unmodified — green throughout, 0 edits
- [x] AC-3: `completed.json` precedence unchanged; probe never called for terminal runs (throwing-predicate proof) — matrix case 3 + terminal-manifest case
- [x] AC-4: `minih runs` reports `'dead'` (not `'stale'`) for dead-pid runs — `run-inventory.test.ts` + `runs.test.ts` subprocess (real probe, PID_MAX-exceeding fixture)
- [x] AC-5: probe returns false on ESRCH/EINVAL/non-positive pid, **true on EPERM**; resolver + inventory callers covered — `run-eligibility.test.ts` error-spec describe + EPERM cases in resolver/inventory suites
- [x] AC-6: unsettled stream end → `provider_stream_aborted` in events.ndjson + `terminalReason: 'provider-stream-aborted'` in run.json (fake-adapter proof) — `sdk-copilot.test.ts` ×3 + `runner-event-driven.test.ts` mapping + clean-settle twin
- [x] AC-7: `minih reconcile` flips dead active runs → `'crashed'` + `'pid-vanished'`; never overwrites existing terminalReason; idempotent — `reconcile.test.ts` (case b2, idempotence) + `reconcile-command.test.ts` end-to-end
- [x] AC-8: reconcile is lock-guarded with stale-lock TTL + dead-owner steal — `reconcile-lock.test.ts` 6/6 + E190 subprocess case
- [x] AC-9: status passes through all three terminalReason values — `status-dead-smoke.test.ts` passthrough loop (3 values, built CLI)
- [x] AC-10: `dead` verdict and `crashed` status render distinctly in TTY — `status-tty-render.test.ts` exercises the real built-CLI TTY branch (forced `isTTY` wrapper): `☠ dead` + explanation line for both the unhealed dead-pid route and the healed `crashed` route (live pid, proving no-re-probe in the human path); `Record<StatusVerdict,…>` arms additionally asserted unit-side. The crashed-vs-unhealed *machine* distinction is the `runs` surface (`manifestStatus: 'crashed'` — `run-inventory.test.ts`/`runs.test.ts`); the `status` envelope deliberately does not carry `manifestStatus` (review F003)
- [x] AC-11: 9-case matrix green with zero real processes; ≥1 reaped-pid smoke + 1 live twin green end-to-end — matrix 12 cases injected-only; 2 spawn smokes exactly
- [x] AC-12: CHANGELOG breaking-change entry + jq migration; all 4 doc surfaces treat dead/crashed as terminal (guard test) — `docs-vocabulary.test.ts` 7/7 incl. dist-bundle staleness guard
- [x] AC-13: History rows in cli/runner/adapter domain.md — appended + Composition currency

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| jq-filter consumers strand on `dead` verdict | Medium | High | T013 migration docs + T014 guard, single release with CHANGELOG snippet |
| Pid reuse reads recycled pid as alive | Low | Low | Accepted residual (status quo on false-active); reconcile converges via same probe |
| EPERM→alive keeps truly-dead runs active in restricted sandboxes | Low | Low | Conservative-alive is the correct failure direction; documented in run-liveness.md |
| Reaped-pid smoke flake | Low | Low | ≤2 spawn smokes; matrix carries the proof load (PL-08) |
| Reconcile races a live writer | Low | Medium | Lock + TTL/steal (T011); probe immediately before write; preservation invariant bounds damage |
| Probe upgrade changes resolver/inventory behavior | Certain (deliberate) | Low | Clarified decision; AC-5 covers both existing callers |

## Discoveries & Learnings (Implementation, 2026-06-11)

| # | Discovery | Action taken / follow-up |
|---|-----------|--------------------------|
| D1 | Boot's lint sensor covers `docs/**` JSON — the-flow's hand-cranked `the-flow.json` broke the gate (single-line arrays) | Formatted; future the-flow bookkeeping must be biome-formatted |
| D2 | Pre-existing resolver gap: plain `minih status <slug>` on a slug whose ONLY run died → `E171 No runs found` (active-collection filters dead pids since plan 016; completed fallback needs completed.json) | Not a verdict lie; out of scope (deliberate resolver asymmetry). Documented in run-liveness.md + AGENTS_README poll-by-runId tip. **Candidate plan-7 fix-loop follow-up: latest-any could fall back to manifest-only runs** |
| D3 | `agents/code-review-companion/outside.md` was at 98.9% of doctor's 8192-byte hard cap — a 178-byte doc note broke `minih doctor` (and an unrelated test suite) | Trimmed to 64 chars (8181 bytes); guard test now pins the budget. The file needs a diet — flag for companion maintainers |
| D4 | TS control-flow analysis narrows closure-mutated `let`s to their initializer inside `catch` blocks — the abort tracker read as `never` | Snapshot-cast with explanatory comment (sdk-copilot.ts) |
| D5 | Inventory mapping for healed (`crashed`) manifests was unpinned by the plan | Decision: liveness `'dead'` (vocabulary unified) but excluded from `--active` — the heal is what clears the attention queue. Documented in run-liveness.md |
| D6 | `Record<StatusVerdict, …>` beats "explicit ternary arms": tsc now *forces* an arm for every future verdict value | Shipped as the T004 implementation (upgrade over the plan's letter) |

## Review Fix Pass (2026-06-11, post-APPROVE)

Stage 7 review returned APPROVE with 4 MEDIUM + 2 LOW findings (`reviews/review.md`); all code/doc findings fixed in-session:

| Finding | Fix | Proof |
|---------|-----|-------|
| F001 `--all`+slug scope ambiguity | `minih reconcile` now rejects `--all` combined with a slug or `--run` (E108); `--all` help text updated | `reconcile-command.test.ts` new case (both combos + manifest untouched) |
| F002 lock steal race → raw fs errors | Steal window hardened: competitor's unlink (ENOENT) tolerated; competitor's completed steal (EEXIST on rewrite) translated to `ReconcileLockHeldError` | `reconcile-lock.test.ts` unlink-race case (no mocks — the injected probe is the interleave point) + `reconcile-lock-race.test.ts` write-race case (module-mocked `node:fs`) |
| F003 AC-10 TTY proof indirect | NEW `status-tty-render.test.ts`: forced-`isTTY` wrapper exercises the real built-CLI render for both dead routes; AC-10 evidence corrected | 2 subprocess tests green |
| F004 lock contract undocumented | `reconcile-lock.ts` reclassified internal→contract here + runner `domain.md` Composition/Contracts/Concepts rows added | docs |
| F005 map/concepts stale | `domain-map.md` cli→runner edge + prose name the reconcile/probe contracts; runner Concepts gained dead-pid liveness + reconcile healing | docs |
| F006 plan-022 close-out bundled | Deferred to commit time — split into its own commit | commit plan |

Additional discoveries from the fix pass:

| # | Discovery | Action taken / follow-up |
|---|-----------|--------------------------|
| D7 | Commander v13 detects `node -e` eval context via `process.execArgv` and slices argv differently — a forced-TTY harness using `-e` gets its CLI path parsed as an unknown command | Wrapper *file* instead of `-e` in `status-tty-render.test.ts` (comment explains) |
| D8 | The injectable `isProcessAlive` probe fires exactly between the lock's stealability read and its unlink — its side effect can simulate a competing stealer deterministically, no fs mocking needed | Used for the unlink-race test; write-race still needs `vi.mock('node:fs')` (isolated in its own file) |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named in this plan.
- **Backpressure** (post-spec seam): ran before this plan — see `backpressure-coverage.md` (Certainty: **Partial**). Recommended Phase 0 folded in: **yes**, as the seams-first ordering (T001/T002 precede all behavior; T006 smoke; T014 guard).
- **Pre-implement** (`--event pre-implement`): fired by `/plan-6` at phase start (T000); verdicts narrated verbatim from the router's envelope (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`). `UNAVAILABLE` is not an error — falls back to standard testing.
- **Phase end** (`--event phase-end`): fired by `/plan-6` at the phase seam (T016); `--event plan-complete` fires at merge (plan-8).
- **Best-effort**: every item above is advisory and never blocks; the router decides what the harness does at each seam.

---

## Validation Record (2026-06-11)

### Validation Thesis

**Raison d'être**: Issue #24 — `minih status` reports dead runs as active; "Host agents poll, see 'active', and have to go digging" (spec Summary); the original ask added "not sure how we prove hte fix though."

**Value claim**: Implementation becomes mechanical and provable — every behavior lands with its deterministic sensor already reachable (seams-first), and orchestrators stop being lied to about run liveness.

**Artifact promise**: A plan-6 implementer executes T001–T016 in order with minimal clarification; each FX stage leaves the repo shippable; the breaking change ships documented.

**Intended beneficiaries**: plan-6 implementer (primary), plan-7 reviewer, host orchestrator agents (ultimate users), future maintainers.

**Proof target**: Implementation (the work itself targets Validated Evidence via AC-11).

**Evidence standard**: source-code match for every anchor; dependency-consistent ordering; measurable Done-Whens; spec-AC ↔ task traceability.

**Thesis source**: original-ask.md, dead-pid-liveness-spec.md, research-dossier.md.

**Thesis verdict**: Advanced (after fixes — was "Partially advanced, Implementation 80%"; the four named clarification gaps were closed in-place: T001 kill-seam signature, T002/T003 framing, healed-case resequenced to T010, T013 exact migration targets).

**Main thesis risk**: "Implementer may miss exact jq-filter migration targets if T013 Done-When is not tightened, leaving orchestrator agents stranded with old filters" — mitigated by the T013 tightening + T014 guard.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Source Truth & Coherence | System Behavior, Technical Constraints, Hidden Assumptions, Concept Documentation | Implementation Readiness | 2 CRIT* + 3 HIGH + 2 MED — all fixed or discarded* | ⚠️ → ✅ |
| Risk & Completeness | Edge Cases, Integration & Ripple, Deployment & Ops, Evidence Sufficiency, Performance | Safety to Change, Downstream Usefulness | 4 HIGH + 3 MED + 3 LOW — fixed or accepted | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit, Evidence Sufficiency, Value Preservation | Thesis Alignment, Proof-Level Fit | 2 HIGH + 4 MED — fixed | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Domain Boundaries | Downstream Usefulness, Contract Integrity | 0 | ✅ |

\* One reported CRITICAL (T001 "EPERM handling missing") described the task's intended change, not a plan defect — discarded as false positive. The LOW "drop the Status column" conflicted with plan-6's consumption contract — discarded (Forward-Compat agent confirmed the column is required).

Notable fixes applied: healed-`'crashed'` matrix case moved T003→T010 (type exists only after T007); `listAgentSlugs`/`listRunDirs` export added to T010 (private today); TTY color/icon default fall-through called out in T004 (no tsc protection at the JSON boundary); kill-seam signature pinned in T001; T013 now lists exact line targets (AGENTS.md:99/:161, AGENTS_README.md:1116/:1140-1153) + dist re-bundle note + peer-activity disambiguation; resolver mtime-only asymmetry documented as deliberate (T005 note).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6-v2-implement-phase (Simple) | mode header, 7-column task table, Status checkboxes, EXEC_LOG convention | shape mismatch | ✅ | `**Mode**: Simple` header; Status column present; PLAN_DIR/execution.log.md convention |
| plan-7-v2-code-review | measurable ACs + Gate Matrix | contract drift | ✅ | 13 ACs with named proof methods; G1–G7 all PASS/N\A |
| /eng-harness-flow seams (T000/T016) | valid router invocations | contract drift | ✅ | `--event pre-implement --phase --plan-dir` and `--event phase-end --plan-dir` match the router's parameter contract |
| Host-agent doc consumers (jq loops) | every documented `verdict == "active"` site migrated | contract drift | ✅ | T013 (now with exact line targets) + T014 vocabulary guard |
| Spec's 13 ACs | each AC reachable from tasks | contract drift | ✅ | AC-1→T003/T004, AC-2→regression net, AC-3→T003, AC-4→T005, AC-5→T001, AC-6→T008/T009, AC-7→T010, AC-8→T011, AC-9→T004, AC-10→T004, AC-11→T006, AC-12→T013/T014, AC-13→T015 |

**Thesis alignment**: Value claim advanced at Implementation proof level (post-fix); main residual risk is jq-filter migration completeness, now bounded by exact line targets in T013 plus the T014 guard test.

**Outcome alignment**: The plan, as shipped, puts the work on trajectory to make the outcome **"Host agents poll, see 'active', and have to go digging"** false — because the trio (FX009 status probe, FX012 diagnostics, FX011 heal) each stage independently detects and records dead runs, and the docs + guard test ensure consuming agents treat `dead`/`crashed` as terminal.

**Standalone?**: No — downstream consumers enumerated above.

Overall: VALIDATED WITH FIXES
