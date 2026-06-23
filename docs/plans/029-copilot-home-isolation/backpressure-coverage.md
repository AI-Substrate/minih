# Backpressure Coverage — Per-repo Copilot SDK Session Isolation (`COPILOT_HOME`)

**Spec**: [copilot-home-isolation-plan.md](./copilot-home-isolation-plan.md) (unified spec + plan)
**Generated**: 2026-06-23
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| vitest unit/integration | `just test` (`vitest run`) | behaviour | root (`vitest.config.ts`); `test/cli/` (~45 specs, real temp dirs via `mkdtemp`/`os.tmpdir`) |
| typecheck | `just typecheck` (`tsc --noEmit`) | maintainability | root |
| lint / format | `just lint` (`biome check .`) | maintainability | root |
| build | `just build` (`tsc` + copy-schemas) | maintainability | root |
| full gate | `just fft` (format · lint · build · typecheck · test · audit · sdk-check) | maintainability + behaviour | root |
| dep audit | `just audit` (`npm audit --audit-level=high`) | maintainability/security | root + CI |
| CI proof gate | `.github/workflows/ci.yml` (biome → build → tsc --noEmit → vitest → audit → verify-dist) | behaviour + maintainability | CI |

> No browser/e2e harness drives the **real** `copilot` runtime: `test/e2e/` exists but runs through the fake adapter (`MINIH_FAKE_ADAPTER`) — a smoke seam that never spawns the real Copilot SDK. So feature behaviours that depend on the external runtime/auth are inherently manual (see ABSENT rows).

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (required if ABSENT) |
|--------------------------|----------------------|--------|------|----------------------------------|
| AC-04 — `.minih/` git-ignored, `.minih.json` still tracked | `git check-ignore .minih/` / `git status` clean | EXISTS | computational | — |
| AC-05 — `MINIH_COPILOT_HOME` override; log-level default `info` / override / **invalid → info** | vitest unit on `resolveCopilotHome()` + `resolveCopilotLogLevel()` | BUILDABLE (planned T006) | computational | — |
| AC-06 — large-logs warning threshold (over / under / no logs dir) | vitest unit on `warnIfHomeLogsLarge()` (real temp dirs) | BUILDABLE (planned T006) | computational | — |
| AC-01 (wiring) — `baseDirectory`/`gitHubToken`/`logLevel` passed to `CopilotClient` **and** `onGetTraceContext`+`telemetry` preserved | vitest on an extracted `buildCopilotClientOptions()` | BUILDABLE (not yet in plan — see Phase 0) | computational | — |
| `logLevel` is a valid SDK `LogLevel` union member | `just typecheck` (`tsc --noEmit`) | EXISTS | computational | — |
| AC-07 — `docs/how/copilot-home.md` exists + names the 3 env vars | file-exists / `grep` for the 3 var names | BUILDABLE (trivial) | inferential | doc *content* quality stays human-judgement |
| AC-01 (end-to-end) — store physically lands under `.minih/copilot-home/`, none new in `~/.copilot` | real `minih run` + filesystem inspection | ABSENT → manual T007 | inferential | globbed `**/playwright.config.*`, `**/cypress.config.*`, `**/*.e2e.*` under root + `test/e2e/`; only harness is the `MINIH_FAKE_ADAPTER` smoke seam — it does not spawn the real Copilot SDK subprocess |
| AC-02 — `copilot --resume` from repo root lists no minih runs | manual run of the external `copilot` CLI | ABSENT → manual T007 | inferential | depends on the third-party `copilot` CLI's resume picker; no in-repo fixture/harness drives the external CLI (same e2e probe as above) |
| AC-03 — auth succeeds on a fresh/empty home via `GH_TOKEN` | real run, empty home, `GH_TOKEN` set | ABSENT → manual T007 | inferential | requires a live GitHub auth round-trip; plan's "avoid mocks" rules out a stubbed auth; no recorded-cassette harness present |

## Certainty: Partial

Every criterion minih itself controls is deterministically provable — AC-04 has an `EXISTS` sensor; AC-05/AC-06 are `BUILDABLE` and already planned (T006); AC-01's wiring is `BUILDABLE` via a one-function extract. The three end-to-end confirmations (AC-01 landing, AC-02 resume, AC-03 auth) are inherently inferential — they depend on the external `copilot` runtime + live auth, so they legitimately route to the manual T007 and do not drag the rating down. Partial (not Strong) because one controllable behaviour — the client-opts wiring + the T002 telemetry-preservation regression risk — is `BUILDABLE` but not yet covered by a planned sensor.

## Recommended Phase 0: Establish Backpressure

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Extract the `CopilotClient` options into a pure `buildCopilotClientOptions(home, token, logLevel, otlpEndpoint)` and unit-test it | AC-01 **wiring** (`baseDirectory`/`gitHubToken`/`logLevel` all set) **and** the T002 regression risk (`onGetTraceContext`+`telemetry` survive the spread) — without spawning the SDK | small refactor + vitest unit (no real run) |

> This converts AC-01's wiring and the "spread clobbers existing opts" risk from a manual-eyeball-in-T007 into a deterministic `just test` assertion. CS-1; it slots into T002 (extract) + T006 (assert). The actual store-landing/resume/auth still need the T007 manual run — that part is genuinely external.

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| AC-04 | done when `git check-ignore .minih/` exits 0 and `.minih.json` stays tracked | EXISTS |
| AC-05 / AC-06 | done when `just test` (the new `test/cli/copilot-home.test.ts`) is green | BUILDABLE (T006) |
| AC-01 (wiring) | done when `buildCopilotClientOptions()`'s unit test asserts all five opts present | BUILDABLE (Phase 0 above) |
| AC-01/02/03 (end-to-end) | confirmed by hand in T007 — inherently external (no deterministic sensor) | thin — manual only |
