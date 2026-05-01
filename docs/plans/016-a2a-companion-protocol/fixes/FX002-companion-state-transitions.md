# Fix FX002: Companion state transitions visible on every handler (+ wait_for_any routing investigation)

**Created**: 2026-05-01
**Status**: Proposed (gated by FX002-1 investigation)
**Plan**: [Companion Experience](../companion-experience-plan.md)
**Source**: Live demo F2 — companion never showed `reading → reporting → idle` on the briefing; workbench timeline empty; `selfReportedState` was `null` at briefing-time
**Domain(s)**: TBD by FX002-1 — most likely `mcp` (`wait_for_any` event routing) AND/OR agent prompt vocabulary

---

## Problem

In the live demo:
- Briefing was sent: id `01KQGHW7GGNAM0F0PDQA9AG4H9` (captured from `outside inbox send` envelope at 2026-05-01T01:19:00Z).
- Companion's status snapshot at the moment showed `currentlyRunningTool: 'minih-coordination-wait_for_any'` and `selfReportedState: null`.
- Workbench timeline showed no state activity for the companion at all during the first three minutes.
- Operator never saw a greeting reply (didn't get long enough to verify because we hit the `--wait` doc gap (FX003) and pulled the plug early).

**Evidence location**: the most recent `agents/demo-companion/runs/*/` directory at the time FX002-1 runs. The originally-cited run id `2026-05-01T11-18-23-346Z-04bc` may have been pruned or never persisted — FX002-1 must locate the actual latest run dir on disk before reading.

**Two competing root-cause hypotheses**:

1. **Prompt-only**: companion processed the briefing fine, but its `state_transition` calls happened so fast they fell within a single "thinking" turn invisible to the workbench. The state moves were correct but unrenderable. Fix = make state transitions explicit pre-`inbox_send` AND throttle them so the workbench captures each.
2. **Runtime bug**: `wait_for_any({events:[{kind:'inbox.message',...}, {kind:'state.peer.changed'}]})` doesn't actually wake on inbox messages, only on state changes. The briefing landed but the long-poll didn't return. Fix = MCP-level — verify and fix `wait_for_any` event routing.

**FX002-1 must distinguish between these before we know what to fix.**

## Proposed Fix

**Investigation outcome (FX002-1, complete 2026-05-01)**: Path C — schema/vocabulary mismatch. Neither Path A (prompt missing transitions) nor Path B (`wait_for_any` routing) was correct. See `FX002-companion-state-transitions.log.md` for full evidence.

The companion DID call `state_transition` correctly. AJV rejected every non-idle status because the default inside-state schema enum (`idle | in-progress | paused | reviewing | complete | error`) doesn't include the prompt's vocabulary (`reading | reporting | blocked | stopping`). Calls to `idle→idle` returned `transitioned: false` no-ops. `wait_for_any`, `inbox_send`, `inbox_ack` all work correctly.

**Path C — schema / vocabulary harmonisation + systemic guard**:

1. Ship `agents/demo-companion/state/inside-state.schema.json` with the prompt's vocabulary as enum (chosen over rewriting the prompt — the verbs read better for a conversational companion).
2. Add a `doctor` warning that flags `prompt.md` ↔ resolved-inside-state-schema enum drift across ALL agents. This is the systemic fix — without it, every future custom-vocabulary agent silently fails the same way.
3. Add agent-side soft-fail behaviour: when `state_transition` returns a schema-rejection error, the agent should send a `progress` inbox message naming the failure so the operator sees it rather than silent.

**Out of scope** for this fix:
- `wait_for_any` mcp work (Path B) — not the bug.
- The `idle→idle` no-op behaviour. That's correct (no transition happened, nothing to log).
- The `run.json` counter `messages: 0` discrepancy noted in the log — file separately if it matters.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| Agent (per-agent fix) | Primary | New `agents/demo-companion/state/inside-state.schema.json` with prompt's vocabulary |
| `cli` | Primary (systemic fix) | `doctor` adds `prompt-state-vocabulary-drift` check |
| Agent prompts (general) | Tangential | `_shared/preamble.md` advises soft-fail on schema rejection |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX002-1 | **Investigate** (BLOCKING — must run before any demo re-run). Locate the latest demo-companion run dir; read its NDJSONs. Apply the decision table. Document verdict in `.log.md`. | investigation | run dir (read-only) | Verdict written to `.log.md` | **DONE 2026-05-01.** Verdict: Path C — schema vocabulary mismatch. See log. |
| [x] | FX002-2 | **(Path C — per-agent)** Create `agents/demo-companion/state/inside-state.schema.json` with `status` enum: `["idle","reading","reporting","blocked","stopping"]`. Match the rest of the structure to `src/schemas/inside-state.json`. | agent | `agents/demo-companion/state/inside-state.schema.json` (NEW) | File exists; the same demo run sequence persists state transitions to `history.ndjson` | **DONE 2026-05-01.** Mirrored `code-review-companion/state/inside-state.schema.json` style (`additionalProperties: true`, `updatedBy: enum ['inside']`); FX002-5 will verify persistence. |
| [x] | FX002-3 | **(Path C — systemic)** Add `doctor` check `prompt-state-vocabulary-drift` for every coordination-enabled agent: parse `prompt.md` for `state_transition` / `state_set` calls (text patterns like `status='X'`, `to: 'X'`, table rows under "State Vocabulary"); resolve the inside-state schema (per `state.ts:insideStateSchemaPath` 3-level fallback); diff and warn on mismatches. | cli | `src/cli/commands/doctor.ts` and helpers | Running `doctor` against `demo-companion` BEFORE FX002-2 reports the drift; AFTER FX002-2 the warning clears | **DONE 2026-05-01.** Pattern 1 requires `state_transition`/`state_set` on the same line (avoids verdict false-positives like `status:'fail'` in tool-result JSON). Pattern 2 scopes table parsing to "State Vocabulary/Machine/Values/Enum" sections only. 13 tests at `test/cli/doctor-state-vocabulary.test.ts`. Smoke-tested against all 4 real coordinated agents — all pass. |
| [ ] | FX002-4 | **(Path C — agent guidance)** Extend the shared preamble to advise: when `state_transition`/`state_set` returns an error, send one `progress` inbox message naming the failure so the operator can see it. Apply to BOTH `agents/_shared/preamble.md` AND `src/templates/shared-preamble.md` (must match per repo convention). | agent | `agents/_shared/preamble.md`, `src/templates/shared-preamble.md` | Both files updated identically; copy-schemas script clean | Per memory: shared-preamble drift is a known foot-gun |
| [ ] | FX002-5 | **(Path C — verification)** Re-run the demo briefing round with FX002-2 applied. Confirm: `state/history.ndjson` populates with transitions through `idle → reading → reporting → idle`; the `--human` workbench shows them. Capture a brief screenshot or excerpt for the dossier. | verification | (live run) | Workbench timeline shows the four transitions in sequence | This is the human acceptance evidence; depends on FX002-2 |

## Workshops Consumed

- `workshops/001-companion-demo.md` — describes the expected state-transition shape for briefing/task handlers

## Acceptance

- [x] FX002-1 investigation log clearly identifies the actual root cause (was: Path A vs B; turned out: **Path C** — schema/vocabulary mismatch).
- [ ] After FX002-2, sending a briefing to `demo-companion` produces visible state transitions in the workbench timeline AND a threaded `progress` reply.
- [ ] `doctor` warns when `prompt.md` mentions a state value not in the resolved inside-state schema enum (verified against demo-companion both before and after FX002-2).
- [ ] Shared preamble (both `_shared/preamble.md` AND `src/templates/shared-preamble.md`) instructs agents to surface schema-rejection errors via `progress` inbox messages.
- [ ] `just fft` clean.

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-05-01 | FX002-1 | gotcha | Default inside-state schema enum (`idle\|in-progress\|paused\|reviewing\|complete\|error`) silently rejects custom vocabularies; AJV error returns to the agent but the agent has no instruction to surface it, so the operator never sees the failure. Result: chatty companion appears dead. | Custom schema for demo-companion + systemic doctor warning + soft-fail preamble (FX002-2/-3/-4). |
| 2026-05-01 | FX002-1 | unexpected-behavior | `state_transition` to the same status (idle→idle) returns success but `transitioned: false` and writes nothing to `state/history.ndjson`. That's correct, but combined with the schema rejection, it meant only same-status no-ops "succeeded" — none of the actual transitions persisted. | Documented in log; no code change. |
| 2026-05-01 | FX002-1 | insight | `wait_for_any` event routing works correctly for both `inbox.message` and the timeout fallback. Path B in the original FX002 was based on a wrong hypothesis. | Path B tasks deleted from FX002. |
| 2026-05-01 | FX002-1 | debt | `run.json` `counters.messages: 0` despite 3 inside + 1 outside messages on disk. | File a separate small fix or note as a follow-up; not blocking. |
