# Backpressure Coverage — Dead-PID Liveness

**Spec**: [dead-pid-liveness-spec.md](./dead-pid-liveness-spec.md)
**Generated**: 2026-06-11
**Certainty**: Partial

> Advisory only — informs `plan-3`. Never blocks, never gates, no scores. (See eng-harness-2-backpressure.)

## Existing Sensors (inventory)

Discovered by filesystem probe (single-package repo, no workspaces; probes run at root + `test/**`):

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| Full gate | `just fft` (lint · format · build · typecheck · test · audit · sdk-check) | maintainability + behaviour | `justfile` |
| Quick gate | `just check` (build + test) | behaviour | `justfile` |
| Unit/integration suite | `npx vitest run` — 110 test files (runner/cli/adapter/mcp/e2e) | behaviour | `vitest.config.ts`, `test/` |
| Typecheck | `npx tsc --noEmit` | maintainability + contract drift (union widenings force every consumer through tsc) | root |
| Lint/format | `npx biome check .` | maintainability | root |
| CI PR gate | `.github/workflows/ci.yml` (biome → build → typecheck → test) | all of the above, on every PR | `.github/workflows/` |
| Harness boot | `harness boot` (composite: biome, tsc, just check, minih doctor, npm audit) | behaviour + environment | `.harness/extensions/boot/` |
| Injected-predicate liveness tests | `test/runner/run-resolver.test.ts:204-252`, `run-eligibility.test.ts`, `run-inventory.test.ts` | behaviour | `test/runner/` |
| CLI subprocess harness | `execFileSync` against built CLI (`test/cli/runs.test.ts:26-45` pattern, ×33 files) | behaviour (end-to-end envelopes) | `test/cli/` |
| Live-pid verdict fixtures | `test/cli/run-target-ambiguity.test.ts` (`pid: process.pid`) | behaviour (alive-run regression net) | `test/cli/` |
| Fake adapter | `test/adapter/fake.test.ts` pattern | behaviour (SDK boundary, no real SDK) | `test/adapter/` |
| Lock tests | `test/runner/run-lock.test.ts` | behaviour (concurrency) | `test/runner/` |
| Atomic-write tests | `test/runner/atomic-write.test.ts` | data integrity | `test/runner/` |
| Spawn/reap precedent | `test/mcp/leak-regression.test.ts` (child_process spawn) | behaviour | `test/mcp/` |
| Architecture-fitness checks | **none** — no `.dependency-cruiser.*`, ArchUnit, CodeQL, or rulesets | architecture-fitness | — |
| Schema validators | **none** for run.json/events — TypeScript-typed by design (`types.ts:265-268`) | — | — |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (required if ABSENT) |
|--------------------------|----------------------|--------|------|----------------------------------|
| AC-1 dead detection (verdict "dead" + diagnostics) | 9-case verdict matrix, injected predicate (mirrors `run-resolver.test.ts:204-252`) | BUILDABLE | computational | — |
| AC-2 no live regression | `run-target-ambiguity.test.ts` live-pid verdict assertions — already passing | **EXISTS** | computational | — |
| AC-3 terminal precedence (completed.json never probes) | matrix case with throwing injected predicate proves "not called" | BUILDABLE | computational | — |
| AC-4 runs-list says 'dead' | `run-inventory.test.ts` + `runs.test.ts` (suites exist; new assertions) | BUILDABLE | computational | — |
| AC-5 probe error spec (ESRCH/EPERM/EINVAL) | **needs a kill-injection seam** — `run-eligibility.test.ts` has exactly one real-probe test (line 153) and EPERM cannot be produced against a real pid in CI | BUILDABLE | computational | — |
| AC-6 stream-abort event + terminalReason mapping | fake-adapter scenario (`fake.test.ts` pattern) + runner mapping test | BUILDABLE | computational | — |
| AC-7 healing + preservation invariant | reconcile core unit tests (tmpdir builders, case b2: never overwrite terminalReason) | BUILDABLE | computational | — |
| AC-8 reconcile lock safety | mirrors `run-lock.test.ts` precedent | BUILDABLE | computational | — |
| AC-9 terminalReason passthrough in status | envelope assertion in matrix/smoke | BUILDABLE | computational | — |
| AC-10 TTY render of dead/crashed | string assertion in subprocess smoke | BUILDABLE | computational | — |
| AC-11 deterministic proof (meta) | the matrix + reaped-pid smoke ARE the sensors; this AC specs them | BUILDABLE | computational | — |
| AC-12 docs migrated (jq filters, CHANGELOG) | mechanical presence: one-line grep data-check ('dead' appears as terminal in the 4 doc surfaces); semantic quality stays with plan-7 | BUILDABLE (mechanical) | computational + inferential | — |
| AC-13 domain History rows | grep for `025-dead-pid-liveness` in 3 domain.md files (or plan-7 eyeball) | BUILDABLE | computational | — |
| FM: verdict precedence inversion (dead overrides completed) | pinned by AC-3 matrix case | BUILDABLE | computational | — |
| FM: probe upgrade ripples to resolver/inventory | existing `run-resolver.test.ts` / `run-inventory.test.ts` suites catch regressions; new EPERM-path cases extend them | **EXISTS** (net) + BUILDABLE (new paths) | computational | — |
| FM: healer corrupts run.json mid-write | `atomic-write.test.ts` + reuse of atomic helper | **EXISTS** | computational | — |
| FM: cross-domain import direction drift (cli↔runner↔adapter) | no dep-direction rule exists; tsc catches missing exports, not direction | ABSENT (this plan) | inferential | globbed `.dependency-cruiser.*`, `*.ruleset`, `codeql/`, archunit signatures at root + all of `test/`, `src/`, `.github/` — no match. A dep-cruiser rule is buildable someday; low risk here (3 small seams on established patterns) → routed to plan-7 review. |
| FM: real-pid smoke flake (pid reuse) | bounded by design: 1-2 smokes only, matrix carries the load (PL-08) | BUILDABLE | computational | — |

## Certainty: Partial

The regression net already EXISTS (live-pid verdict fixtures, resolver/inventory suites, atomic-write, CI gate); every new-behaviour criterion is BUILDABLE on existing harnesses (vitest + tmpdir builders + fake adapter + subprocess CLI) — nothing material is ABSENT. Two criteria need **new injection seams before their sensors are reachable** (AC-1/3/11: exported verdict fn; AC-5: kill-fn injection), which is what keeps this Partial rather than Strong.

## Recommended Phase 0: Establish Backpressure

Small — these are the plan's *first tasks*, not a separate infrastructure effort. The advisory point for `plan-3`: **build the seams before the behavior**, so every later task lands with its sensor already reachable.

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Exported verdict function with optional `{isProcessAlive}` deps (FX009-2) | AC-1, AC-3, AC-9, AC-11 — makes the 9-case matrix importable instead of subprocess-only | injection seam (refactor in `status.ts` → exported fn) |
| Kill-fn injection point in `isProcessAliveDefault` (or `vi.spyOn(process,'kill')`) | AC-5 — EPERM/EINVAL discrimination is unreachable against real pids in CI | unit seam |
| Reaped-pid smoke helper (spawn `node -e "process.exit(0)"`, await exit, write pid to fixture) | AC-1/AC-10 end-to-end through the built CLI with the REAL probe | smoke (precedent: `leak-regression.test.ts` spawn) |
| Docs-grep data check (optional, cheap) | AC-12 mechanical half — 'dead' present as terminal in AGENTS_README.md, AGENTS.md, companion outside.md, CHANGELOG | data-script (one-liner) |

**Not recommended this plan**: a dependency-direction analyzer (dep-cruiser) for the cross-domain FM — buildable but out of proportion to the risk; plan-7 review covers it.
