# Execution Log — Phase 5 Outside CLI Surface

## Pre-phase harness validation

No `docs/project-rules/harness.md` exists in this repository, so Phase 5 uses the standard validation path from the task dossier: `npm run build`, focused CLI tests, and `just fft`.

## T001 — Add context block helper

**Status**: complete.

**Scope**: add `E128 INVALID_CONTEXT`, create a command-agnostic inside-context guard in `src/cli/preaction-context.ts`, and cover strict `MINIH === '1'` behavior.

**Changes**:
- Added `ErrorCodes.INVALID_CONTEXT = 'E128'`.
- Added `src/cli/preaction-context.ts` with reusable inside-session detection, invalid-context envelope construction, and a commander `preAction` hook helper.
- Added `test/cli/preaction-context.test.ts` for strict `MINIH === '1'` behavior and envelope shape.

**Evidence**:
- `npx vitest run test/cli/preaction-context.test.ts` — 2 tests passed.

## T002 — Wire context block into commands

**Status**: complete.

**Scope**: attach the T001 guard to `run`, `resume`, `quickstart`, `tail`, and `init`; add built-CLI regression coverage that the blocked path emits a JSON envelope, including for `tail`.

**Changes**:
- Added `assertOutsideContext(...)` hooks to `run`, `resume`, `quickstart`, `tail`, and `init`.
- Added built-CLI command coverage for `MINIH=1` blocked envelopes.

**Evidence**:
- `npm run build && npx vitest run test/cli/commands.test.ts test/cli/preaction-context.test.ts` — 14 tests passed.

## T003 — Implement outside-send

**Status**: complete.

**Scope**: add the outside-lane message append command, including schema validation and required `--ack-of` support for `--type ack`.

**Changes**:
- Added `src/cli/coordination.ts` with agent resolution, JSON Schema validation, and inbox append helpers.
- Added `src/cli/commands/outside-send.ts`.
- Added focused built-CLI tests for normal send, ack send, missing/invalid targets, and schema validation errors.

**Evidence**:
- `npm run build && npx vitest run test/cli/outside-send.test.ts` — 4 tests passed.

## T004 — Implement outside-inbox-list

**Status**: complete.

**Scope**: add the outside reply reader for the inside lane with `--type` and `--unread`, using outside-lane ack records from T003.

**Changes**:
- Added strict inbox lane reading to the CLI coordination helper.
- Added `src/cli/commands/outside-inbox-list.ts`.
- Added focused built-CLI tests for empty lanes, type filtering, unread reconstruction, torn lines, and malformed JSON.

**Evidence**:
- `npm run build && npx vitest run test/cli/outside-inbox-list.test.ts test/cli/outside-send.test.ts` — 7 tests passed.

## T005 — Implement outside state commands

**Status**: complete.

**Scope**: add `state get`, `state set`, and `state transition` for outside-owned state, including local/default schema validation, invalid JSON handling, missing-key reads, inside-write rejection, and append-history-before-write ordering.

**Changes**:
- Added `src/cli/commands/state.ts` with `get`, `set`, and `transition` subcommands.
- Implemented local `outside-state.schema.json` preference with fallback to the bundled default schema.
- Enforced outside-only writes and constrained keyed writes to `status`, `data`, and `data.<path>`.
- Added focused built-CLI tests for read defaults, schema/history writes, key grammar, invalid args, transition no-partial-write behavior, and local schema preference.

**Evidence**:
- `npm run build && npx vitest run test/cli/state.test.ts` — 7 tests passed after minih code-review F001 fix.

## T006 — Implement outside-context

**Status**: complete.

**Scope**: add `outside-context [slug]` with system markdown, per-agent `outside.md` inclusion/stubs, stdout envelope, stderr pretty rendering, and runner-backed outside.md path safety.

**Changes**:
- Added `src/cli/commands/outside-context.ts`.
- Updated the shared CLI resolver to map runner outside.md symlink escapes to an envelope.
- Added focused built-CLI tests for system-only output, present/absent/empty contracts, symlink escape rejection, and oversized truncation.

**Evidence**:
- `npm run build && npx vitest run test/cli/outside-context.test.ts` — 4 tests passed.

## T007 — Implement outside-retro

**Status**: complete.

**Scope**: add `outside-retro <slug> --body "..." [--target project|minih|coordination]` as a thin typed wrapper over outside-lane retro messages.

**Changes**:
- Added `src/cli/commands/outside-retro.ts`.
- Reused T003 outside message construction and append validation.
- Added focused built-CLI tests for default/custom targets and invalid targets.

**Evidence**:
- `npm run build && npx vitest run test/cli/outside-retro.test.ts test/cli/outside-send.test.ts` — 6 tests passed.

## T008 — Implement retros aggregator

**Status**: complete.

**Scope**: add `retros` to aggregate inside `report.json.retrospective` entries and outside-lane `type: retro` messages with agent, side, and target filters.

**Changes**:
- Added `src/cli/commands/retros.ts`.
- Aggregates completed/degraded inside run reports plus outside-lane `type: retro` messages.
- Added filters for `--agent`, `--side`, and `--target`.
- Added focused built-CLI tests for aggregation, filters, targetless inside exclusion when filtering, and corrupt outside-lane failure.

**Evidence**:
- `npm run build && npx vitest run test/cli/retros.test.ts test/cli/outside-retro.test.ts` — 5 tests passed.

## T009 — Register commands and cover discovery

**Status**: complete.

**Scope**: verify root help lists the six new Phase 5 commands and that command registration remains discoverable through the built CLI.

**Changes**:
- Registered all six Phase 5 commands in `src/cli/index.ts`.
- Added root `minih --help` discovery coverage for every new command.

**Evidence**:
- `npm run build && npx vitest run test/cli/commands.test.ts` — 13 tests passed.

## T010 — Add run help tip

**Status**: complete.

**Scope**: add static `minih run --help` guidance pointing coordinated outside callers at `minih outside-context <slug>`, with no runtime/action-time behavior change.

**Changes**:
- Added a static `run --help` tip for `minih outside-context <slug>`.
- Added focused built-CLI help coverage.

**Evidence**:
- `npm run build && npx vitest run test/cli/run-help.test.ts test/cli/commands.test.ts` — 14 tests passed.

## Minih code review

**Status**: F001 fixed.

**Finding**: The minih `code-review` agent reported one HIGH correctness issue: data-only outside-state mutations persisted `outside.json` without appending `state/history.ndjson`.

**Resolution**:
- `writeOutsideState()` now appends history before every persisted outside-state mutation, even when `from === to`.
- `test/cli/state.test.ts` now covers `--data-json`, `--key data.*`, and same-status transition failure behavior.

**Evidence**:
- First review report: `agents/code-review/runs/2026-04-26T19-49-24-013Z-c82e/output/report.json`.
- `npm run build && npx vitest run test/cli/state.test.ts` — 7 tests passed.
- Rerun review report: `agents/code-review/runs/2026-04-26T20-08-11-085Z-0d76/output/report.json` — approved; no remaining material correctness, domain, reinvention, or test-coverage issues.
