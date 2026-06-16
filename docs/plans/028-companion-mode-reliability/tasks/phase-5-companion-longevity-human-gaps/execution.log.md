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

### T003 (RED) / T004 (GREEN) — stallTimeout frontmatter→config leg + survive-gaps profile

- **Parse**: `folder.ts` `parseYamlSimple` now reads `stallTimeout` (mirrors the `timeout` regex; `0` honoured) + `surviveGaps` (boolean); `parseFrontmatter`'s explicit return type + `listAgents` thread both onto `AgentDefinition` (new fields in `types.ts`).
- **Resolve**: `resolveEffectiveBudgets` gains a 4th `definitionStallTimeout?` param → stall precedence is now flag → frontmatter → `DEFAULT_STALL_TIMEOUT_SEC` (`0` honoured via `??`, not collapsed). Callers `run.ts:274` + `resume.ts:623` pass `definition.stallTimeout`.
- **Profile**: both callers set `config.surviveGaps` from `definition.surviveGaps`. The real `agents/code-review-companion/prompt.md` frontmatter now carries `stallTimeout: 0` (watchdog disabled — wall-clock `timeout: 7200` is the backstop) + `surviveGaps: true` (heartbeat on). `idleBudgetMs` (the third ceiling) stays the durable run.json input #49 reads — left for 5b.
- **Tests** (+4 in `companion-longevity.test.ts`): frontmatter parse; `resolveEffectiveBudgets` definition-fallback + flag-wins + default; the real companion frontmatter carries the profile; a survive-gaps profile (stallTimeout 0) times out on wall-clock instead of `stalled-stream`.
- **Evidence**: typecheck clean (caught + fixed `parseFrontmatter`'s return-type annotation); 68 green across companion-longevity + budget-flags + folder.
- **Type gotcha**: `parseFrontmatter` has an explicit return-type annotation (not inferred), so new `parseYamlSimple` fields must be added there too or `listAgents` can't see them.

### T007 (NOTE/DOC) — survival vs engagement

- Added `docs/how/companion-mode.md` § "Surviving long human gaps — the survive-gaps profile": the three killers (staleness/stall/wall-clock) + the profile that addresses each; the heartbeat decoupling; **survival is necessary, not sufficient**; the deferred **`git log`-cursor → `outside inbox send` feeder** as the engagement-half fast-follow (its own small plan); AC-H proves alive, not that a review happened.


