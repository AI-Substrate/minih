# Execution Log — Phase 5: Companion longevity through human gaps

**Plan**: [companion-mode-reliability-plan.md](../../companion-mode-reliability-plan.md)
**Mode**: Full · **Scope this run**: 5a only (T001–T004, T007). 5b (T005/T006) is workshop-gated — NOT built.
**Companion**: `--companion` mode (dogfood) — a live `code-review-companion` reviews each commit.

---

## T000 — Harness pre-flight seam (`--event pre-implement`)

- **Router**: installed (`~/.agents/skills/eng-harness-flow`). minih has full harness adoption (CLI 0.3.0, governance `.harness/engineering-harness.md`, `.harness/` substrate, boot = vitest suite).
- **Decision**: `route` → boot validation; engineering zone (S0+S2+S4 hold).
- **Boot verdict (verbatim)**: `harness doctor` = **degraded** — sole failing layer `toolchain: missing tools: biome` (biome resolves via `just fft`/npx, not a standalone binary on PATH); `cli-build` (n/a, consumer install), `extensions` (1 loaded), `instructions`, `record-types` all `ok`.
- **Action**: non-blocking cosmetic flag → **proceed** with standard + survive-gaps testing. Logged, not escalated.

---

## Companion boot (C0/C0a)

- Booted `code-review-companion` in background — runId `2026-06-16T21-31-43-201Z-ce1c`; reached `active` on first poll.
- Briefed once (type=briefing): scope = 5a only, the 5b scope gate, Finding-11 hazards, domain context.
- At brief time peer `verdict: dead` (run 1min old, no `inbox_list` yet) BUT `currentlyRunningTool: view` / `selfReportedState: reading` → **alive** (the exact premature-death false-positive Phase 5 targets). Did not kill.

## Tasks

### T001 (RED) / T002 (GREEN) — opt-in survive-gaps heartbeat

- **New**: `startManifestHeartbeat(runDir, intervalMs?)` in `run-manifest.ts` — `setInterval` → `updateManifest({ updatedAt })` (applyPatch always re-stamps `updatedAt`), `unref`'d, returns a stop fn. Decoupled from `resetStallDeadline` by construction (module has no access to it).
- **Config**: `AgentRunConfig.surviveGaps?: boolean` + `heartbeatIntervalMs?: number` (test seam); `SURVIVE_GAPS_HEARTBEAT_INTERVAL_MS = 20_000` (3× margin under the 60s window).
- **Wiring**: `runner.ts` starts the heartbeat just before the SDK run try-block when `config.surviveGaps`, clears it in the inner `finally` alongside the watchdog/timeout handles (before the terminal manifest writes — `updateManifest` serializes per-runDir so terminal always lands last).
- **Tests** (`companion-longevity.test.ts`, 4): factory advance; (c) cleanup/no-leak; (a) default run does NOT advance updatedAt through a silent gap while survive-gaps does; (b) survive-gaps run still fires `stalled-stream` (heartbeat never resets the watchdog).
- **Evidence**: 4/4 green; `just format` (1 file), `just typecheck` clean; runner-stall + run-manifest suites still green (26 total).

