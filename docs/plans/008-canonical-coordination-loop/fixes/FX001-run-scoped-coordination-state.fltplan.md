# Flight Plan: Fix FX001 - Run-Scoped Coordination State

**Fix**: [FX001-run-scoped-coordination-state.md](./FX001-run-scoped-coordination-state.md)
**Status**: Landed - implementation, quality gate, and live rerun complete

## What -> Why

**Problem**: Mutable coordination inbox/state files are agent-scoped, so overlapping runs of the same agent can collide.
**Fix**: Make the run folder the conversation boundary and route inbox/state/history/watermark reads and writes through run-scoped paths.

## Domain Context

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| runner | Contract owner | Path helpers, state helpers, forwarders, env setup, and snapshots target `runs/<runId>/{inbox,state}`. |
| mcp | Consumer | Hidden context and inside tools validate/use run-scoped dirs. |
| cli | Consumer | Outside commands resolve a run before mutable coordination reads/writes. |
| adapter | Indirect consumer | No adapter API change expected. |

## Stages

- [x] **Stage 1: Change runner path contract** - Add run-scoped coordination path/state helpers and move the watermark path into the run boundary.
- [x] **Stage 2: Rewire inside runtime** - Point runner env, forwarders, MCP spawn/context, and MCP tools at the active run's coordination folders.
- [x] **Stage 3: Rewire outside commands** - Add run targeting for outside inbox/state/retro surfaces and include run ids in coordination envelopes.
- [x] **Stage 4: Prove isolation** - Update CLI, runner, MCP, and e2e tests for same-agent multi-run isolation and current command behavior.
- [x] **Stage 5: Align documentation** - Update current docs, agent contracts, and the first-run write-up with the run-scoped model.

## Acceptance

- [x] Mutable coordination files live below `agents/<slug>/runs/<runId>/`.
- [x] Same-agent concurrent runs do not share inbox, state, history, or watermark data.
- [x] Outside CLI commands can address the intended run and fail safely on ambiguous targets.
- [x] MCP hidden context prevents access outside the active run.
- [x] Current docs and prompts teach run-scoped mutable state.

## Flight Log

| Date | Event | Evidence |
|------|-------|----------|
| 2026-04-27 | Full quality gate passed after updating the stale coordination env test to expect run-scoped paths. | `just fft` passed: lint, format, build, typecheck, tests, audit. |
| 2026-04-27 | Live `coordination-loop-validator` rerun completed on `gpt-5.5`. | Run `2026-04-27T19-13-21-327Z-ebc1`, result `completed`, `5622` events, `55` tool calls, `validated: true`. |
| 2026-04-27 | Rerun evidence written. | [002-run-scoped-rerun-evidence.md](../posts/002-run-scoped-rerun-evidence.md) |
