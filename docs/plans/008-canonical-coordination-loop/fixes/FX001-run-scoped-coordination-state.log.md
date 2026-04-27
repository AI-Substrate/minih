# Execution Log: Fix FX001 - Run-Scoped Coordination State

_Populated during implementation._

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-04-27 | FX001-1 | Started | Beginning runner path contract change from agent-scoped `agents/<slug>/{inbox,state}` to run-scoped `agents/<slug>/runs/<runId>/{inbox,state}`. |
| 2026-04-27 | FX001-1 | Complete | Added `CoordinationRunLocation`, run-scoped inbox/state/history/watermark helpers, and moved runner state helper signatures to the run location contract. `npm run build -- --pretty false` passed after the source migration. |
| 2026-04-27 | FX001-2 | Started | Wiring runner env, forwarders, MCP spawn/context, and inside MCP tools to `runId`/`runDir` as the coordination authority. |
| 2026-04-27 | FX001-3 | Started | Adding run targeting for outside commands so mutable outside writes choose a conversation run instead of an agent-level shared inbox/state. |
| 2026-04-27 | FX001-2 | Complete | Runner env now points `MINIH_INBOX_DIR`/`MINIH_STATE_DIR` at the active run, forwarders carry `runId`, MCP spawn/context validates run-scoped directories, and inside MCP tools derive all paths from the hidden run context. |
| 2026-04-27 | FX001-3 | Complete | Outside send/list/retro/state/validate/retros flows now resolve a run target, support explicit `--run` where coordination data is read/written, and include `runId` in coordination envelopes. |
| 2026-04-27 | FX001-4 | Complete | Migrated runner, MCP, CLI, and skipped e2e tests to run-scoped fixtures; added same-agent isolation coverage for outside messages, outside state, and forwarder watermarks. Targeted suite passed: 18 files passed, 185 tests passed, 2 expected e2e skips. |
| 2026-04-27 | FX001-5 | Started | Beginning doc/runbook/domain alignment so current guidance teaches run-scoped mutable coordination state and records the first-run correction. |
| 2026-04-27 | FX001-5 | Complete | Updated domain docs, current runbooks, README/AGENTS references, and first-run evidence docs to describe agent-level files as definitions/defaults and run folders as mutable conversation boundaries. |
| 2026-04-27 | Validation | Complete | `just fft` passed after fixing the stale runner env-var expectation to assert `<runDir>/inbox` and `<runDir>/state`; final suite reported 417 passing tests, 9 skipped tests, and 0 audit vulnerabilities. |
| 2026-04-27 | Live rerun | Complete | Ran `coordination-loop-validator` with `--model gpt-5.5`; run `2026-04-27T19-13-21-327Z-ebc1` completed in 455.4s with 5622 events, 55 tool calls, schema validation passing, all three milestones acknowledged, and final report verdict `pass`. Evidence recorded in `../run-scoped-rerun-evidence.md`. |
