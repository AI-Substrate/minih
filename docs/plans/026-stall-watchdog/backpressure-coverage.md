# Backpressure Coverage — Stall Watchdog + Run Budgets

**Spec**: [stall-watchdog-spec.md](./stall-watchdog-spec.md)
**Generated**: 2026-06-11
**Certainty**: Partial

> Advisory only — informs `plan-3`. Never blocks, never gates, no scores. (See eng-harness-2-backpressure.)

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| full gate | `just fft` (lint · format · build · typecheck · test · audit · sdk-check) | maintainability + behaviour | root `justfile` |
| typecheck | `just typecheck` (tsc --noEmit) | maintainability | root |
| unit/integration suite | `just test` (vitest: `test/{adapter,runner,cli,mcp,e2e,...}`) | behaviour | root |
| SDK compat check | `just sdk-check` | architecture-fitness (SDK boundary) | root |
| SDK shape pin | `test/adapter/sdk-permission-shapes.test.ts` (imports real SDK types) | architecture-fitness | `test/adapter/` |
| docs vocabulary guard | `test/cli/docs-vocabulary.test.ts` (025 T014) | behaviour (docs honesty) | `test/cli/` |
| stall-simulation seam | `FakeAgentAdapter.setQueuedRun(..., { suppressFinalIdle: true })` (025 T008) | behaviour (test affordance) | `src/adapter/fake.ts` |
| built-CLI subprocess harness | execFileSync against `dist/cli/index.js` (pattern across `test/cli/*`) | behaviour (end-to-end) | `test/cli/` |
| composite boot | `harness boot` (biome, tsc, just check, minih doctor, npm audit) | maintainability + behaviour | `.harness/extensions/boot/` |
| CI gate | `.github/workflows/ci.yml` | all | `.github/` |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail |
|--------------------------|----------------------|--------|------|-------------|
| AC-1 stall → terminal artifacts | vitest runner test riding the T008 suppressed-idle seam + fake clock | BUILDABLE | computational | — |
| AC-2 hung cleanup can't block terminal writes | vitest with never-settling fake `terminate()`/`disconnect()` | BUILDABLE | computational | — |
| AC-3 timeout writes `terminalReason: 'timeout'` | vitest runner timeout test (existing timeout tests extend) | BUILDABLE | computational | — |
| AC-4 max-turns breach / non-breach | vitest fake-adapter multi-turn runs | BUILDABLE | computational | — |
| AC-5 no false trigger; `0` disables | vitest twin tests (continuous events; disabled knob) | BUILDABLE | computational | — |
| AC-6 flags + plumbing + budgets in run.json | built-CLI subprocess tests (`test/cli` pattern) | BUILDABLE | computational | — |
| AC-7 status/runs passthrough of new reasons | built-CLI subprocess test (status envelope assertion) | BUILDABLE | computational | — |
| AC-8 defaults reconciled | unit test on shared default + message text | BUILDABLE | computational | — |
| AC-9 SDK at 1.0.1, no shape drift | `just sdk-check` + `sdk-permission-shapes.test.ts` + lockfile | **EXISTS** | computational | — |
| AC-10 docs vocabulary covers new reasons | `test/cli/docs-vocabulary.test.ts` (extend rows) | **EXISTS** (sensor) / BUILDABLE (rows) | computational | — |
| AC-11 E170 remedy text mentions `--latest` | vitest CLI error-envelope assertion | BUILDABLE | computational | — |
| Windows detached behavior | — | ABSENT | human-judgement | no Windows CI: globbed `.github/workflows/*` (ci.yml runs ubuntu/macos only); declared a spec non-goal — documented stance routes to docs + plan-7 review |
| Real-SDK stall reproduction (live CLI hang) | — | ABSENT | inferential | no live-subprocess chaos harness: globbed `test/**` for child-process kill/hang fixtures — none; risk accepted, fake-boundary tests are the proxy; reporter's events.ndjson tail (if attached to #44) remains the field evidence |

## Certainty: Partial

9 of 11 acceptance criteria are BUILDABLE with the existing vitest/built-CLI harness (the plan's TDD tasks ARE the sensors); AC-9/AC-10 ride sensors that already exist. The two ABSENT rows are deliberate non-goals (Windows) or inherently inferential (live-SDK chaos) — neither drags the build.

## Recommended Phase 0: Establish Backpressure

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Injectable watchdog clock/scheduler seam | AC-1/AC-2/AC-5 deterministically (no real waits) | the plan's first TDD tasks — fold into the single phase, not a separate Phase 0 |
| Never-settling-cleanup fake (terminate/disconnect hang) | AC-2 | FakeAgentAdapter/MockSession extension, in-phase |

*(Both rows are the natural opening TDD tasks of a Simple single-phase plan — plan-3 should fold them in rather than emit a literal Phase 0.)*
