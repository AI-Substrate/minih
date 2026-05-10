# Fix FX001: Coordination Tool-Surface Bugs Surfaced by Companion Smoke

**Created**: 2026-04-28
**Status**: Implemented (2026-04-28)
**Plan**: [009-human-agent-view](../human-agent-view-plan.md) (Phase 1 follow-up)
**Source**: `code-review` agent run on subtask FX001 (`agents/code-review/runs/2026-04-28T12-47-21-690Z-6bfa/output/report.json`) — 2 HIGH findings (F001 state schema, F002 ackOf), 1 MED finding (F003 test coverage gap), magic-wand asking for an end-to-end coordination contract test
**Domain(s)**: `mcp` (modify), `runner` (consume — InboxMessage already supports `ackOf`)

---

## Problem

The `code-review-companion` exemplar agent (subtask FX001 of plan 009 phase 1) was built end-to-end and the smoke run *appeared* to succeed (exit 0, validated farewell envelope). The dogfood code review against it surfaced two **silent** failures of load-bearing coordination contracts:

1. **State publication is broken**. `src/mcp/tools/state.ts:172-175` resolves `<agentDir>/inside-state.schema.json` (root). The companion's custom enum (`reading | reviewing | reporting | blocked | stopping`) lives at `agents/code-review-companion/state/inside-state.schema.json`, so the MCP tool falls back to the default schema and silently rejects every transition. Confirmed live: the smoke run's `state/inside.json` and `state/history.ndjson` were **never created**. Phase 2's view will render an empty state pane for every coordinated agent that follows this layout convention.

2. **`ackOf` reply correlation is unenforceable**. `src/mcp/types.ts` `inbox_send` inputSchema has `subject`/`body`/`type`/`meta` but no `ackOf` parameter. Workshop 007's "every reply MUST set `ackOf`" rule is therefore prompt-decoration only — it cannot reach disk through the MCP tool. `src/runner/human-view-model.ts:228-247` uses `ackOf` as the sole correlation signal for the Phase 2 workbench's reply-linkage rendering, so no inside reply can ever appear linked to its outside trigger. The companion's `inbox_ack` calls did persist `ackOf` (because that tool writes through a different path) — that's why the breakage stayed invisible during smoke.

The magic-wand from the code review identifies the root cause precisely:

> *"Add one end-to-end coordination contract test that boots a coordinated agent fixture and asserts both state publication and ackOf-linked reply messages through the real MCP tool surface. That single test would have caught both blockers before Phase 2 tried to consume this companion."*

## Proposed Fix

Two minimal MCP changes plus the missing regression test the magic-wand demands:

1. **`src/mcp/tools/state.ts`**: prefer `<agentDir>/state/inside-state.schema.json`; fall back to the legacy `<agentDir>/inside-state.schema.json`; then fall back to the default schema. Documents the resolution order in the function header.
2. **`src/mcp/types.ts` + `src/mcp/tools/inbox.ts`**: add optional `ackOf?: string` (1-128 chars) to `inbox_send` inputSchema and `parseInboxSendInput`; propagate to the persisted `InboxMessage` (the runner-side type already supports it).
3. **New test**: `test/mcp/coordination-contract.test.ts` — boots a fake-agent fixture, invokes `state_transition` against an agent-local `state/inside-state.schema.json` and asserts the file appears, AND invokes `inbox_send` with `ackOf` and asserts the message persists with `ackOf` set. This is the exact magic-wand the code review asked for; it would have caught both bugs.
4. **Companion follow-through** (no code, just config): no change needed — the companion's existing `state/inside-state.schema.json` location becomes valid; the prompt's `ackOf` rule becomes enforceable. Document in execution log.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `mcp` | modify | `inbox_send` adds optional `ackOf` parameter; `state` tool prefers `state/`-located inside-state schema with backward-compat fallback. |
| `runner` | consume — no change | `InboxMessage.ackOf` already exists and is parsed/written by `inbox-forwarder.ts`. |
| `agents/code-review-companion` | benefits, no edits | Its existing schema location starts being honored; its `ackOf` rule becomes enforceable. Smoke is re-run as evidence. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX001-1 | Add **failing** test `test/mcp/coordination-contract.test.ts` — the magic-wand end-to-end coordination contract. Boots a `tmp` agent fixture (`mkdtempSync`) wired through a real `McpServerContext` (fields per `src/mcp/server.ts`: `agentSlug`, `agentDir`, `agentsDir`, `runId`, `runDir`, `inboxDir` = `<runDir>/inbox`, `stateDir` = `<runDir>/state`). Invokes the **real MCP tool surface** (no mocking) with three cases: (a) **state publication** — write `<agentDir>/state/inside-state.schema.json` with custom enum `[idle, reading]`; call `state_transition({ from: 'idle', to: 'reading' })`; assert `<runDir>/state/inside.json` exists with `status: 'reading'` AND `<runDir>/state/history.ndjson` has the transition; (b) **legacy-root back-compat** — same as (a) but with the schema at `<agentDir>/inside-state.schema.json` (no `state/` folder); assert it still works (closes the back-compat regression hole the COMP MED flagged); (c) **`ackOf`-linked replies** — call `inbox_send({ subject, body, type: 'finding', ackOf: '<msg-id>' })`; assert the persisted message in `<runDir>/inbox/inside/messages.ndjson` has `ackOf` equal to the input id. This single test covers F003 (test coverage gap) from the code review by establishing real coordinate-loop coverage that the existing inbox/state tests lacked. | mcp (test) | `/Users/jordanknight/substrate/minih/test/mcp/coordination-contract.test.ts` | `npx vitest run test/mcp/coordination-contract.test.ts` runs and **fails** for cases (a) and (c) — TDD red bar. Case (b) passes immediately (legacy fallback already works) and prevents future regression. | Magic-wand from code-review verbatim: "boots a coordinated agent fixture and asserts both state publication and ackOf-linked reply messages through the real MCP tool surface". Closes F003 by adding the missing layer of real-tool-surface coverage. |
| [x] | FX001-2 | Update `src/mcp/tools/state.ts` `insideStateSchemaPath()` (lines 172-175) to resolve in order: (1) `<agentDir>/state/inside-state.schema.json` (preferred — new convention), (2) `<agentDir>/inside-state.schema.json` (legacy fallback — preserves `coordination-smoke-test`, `coordination-loop-validator`, and any other existing coordinated agent), (3) `DEFAULT_INSIDE_STATE_SCHEMA` (built-in default — preserves all agents that ship no inside-state schema at all). Update the function comment to document the resolution order and the back-compat intent. | mcp | `/Users/jordanknight/substrate/minih/src/mcp/tools/state.ts` | FX001-1 cases (a) and (b) both turn green; existing `test/mcp/state.test.ts` continues to pass. | Picks the convention used by `code-review-companion` AND keeps every existing coordinated agent working. |
| [x] | FX001-3 | Add optional `ackOf` to `src/mcp/types.ts` `inbox_send` inputSchema (`type: 'string', minLength: 1, maxLength: 128, description: 'Optional inbox message id this reply acknowledges (drives Phase 2 workbench correlation).'`). Update the inline input parsing inside `src/mcp/tools/inbox.ts` `inboxSend()` (currently around lines 225-245 — there is no separate `parseInboxSendInput` function; the parsing happens inline). Validation rules at the MCP boundary: (a) shape: must be a non-empty string, max 128 chars (matches schema); (b) **existence is NOT enforced** at write-time (optimistic accept) — a stale `ackOf` referencing a non-existent message becomes the agent's bug to fix, not a blocker; documented with an inline comment so future readers know the choice is intentional; (c) **same-lane acks (inside-acks-inside) are accepted** — Workshop 002 §inbox notes outside↔inside is the canonical pattern, but inside↔inside replies are useful for thread continuation and the human view renders them fine. Propagate `ackOf` to the constructed `InboxMessage` in `inboxSend()`. | mcp | `/Users/jordanknight/substrate/minih/src/mcp/types.ts`, `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts` | FX001-1 case (c) turns green; `test/mcp/types.test.ts` adds a new `inbox_send` schema assertion (FX001-4); existing inbox tests continue to pass. | `InboxMessage.ackOf` already exists in `src/runner/types.ts:192`; runner forwarder already round-trips it (`src/runner/inbox-forwarder.ts:285-290`); only the MCP entry surface needed widening. |
| [x] | FX001-4 | **Add** (not update — there is currently no inbox_send assertion in this test file) an `inbox_send` schema test to `test/mcp/types.test.ts` that asserts the new optional `ackOf` property is present in `inputSchema.properties` with the expected shape, AND that `inputSchema.required` does NOT include `ackOf`. Update Workshop 007 § Inbox Vocabulary "Reply rule" snippet — explicitly confirm `ackOf` is now a real `inbox_send` parameter (no caveat needed). Update FX001 (subtask) ST003 task notes to remove any prompt-vs-tool drift caveat that may have crept in during the smoke. | mcp (test) + docs | `/Users/jordanknight/substrate/minih/test/mcp/types.test.ts`, `/Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/workshops/007-coordinated-code-review-companion.md` | New `inbox_send` test passes; workshop snippet says e.g. "every inside reply MUST set `ackOf` (now a first-class `inbox_send` parameter, not a documentation-only convention)". | Tightens the prompt-vs-tool drift the code-review confusing artifact called out. |
| [x] | FX001-5 | **Manual verification only — NOT a CI/automated regression.** Re-smoke the companion: `cd /Users/jordanknight/substrate/minih && node dist/cli/index.js run code-review-companion`, send an outside `task` from a second terminal, observe (a) `state/inside.json` is now written with `status: 'reading'`/`reviewing`/etc. (proving FX001-2), (b) the inside `finding` reply has `ackOf` matching the outside task id (proving FX001-3 + agent compliance). Capture evidence in this fix's `.log.md`. Note: this requires a live SDK call (gpt-5.4) — does not run in CI; treat result as manual evidence, not a regression gate. | verification (manual) | `agents/code-review-companion/runs/<runId>/{state/inside.json, inbox/inside/messages.ndjson}` | State files present; finding messages link via `ackOf`. | Closes the loop — proves the companion design works once the tool surface matches it. Automated regression coverage lives in FX001-1. |
| [x] | FX001-6 | `just fft` — confirm gate stays green. | repo | repo root | exit 0; tests >= 471 (added FX001-1's 3 sub-cases). | Ownership policy: own every finding `fft` surfaces. |
| [x] | FX001-7 | **Tighten `agents/coordination-smoke-test/prompt.md` to verify-not-just-call.** Rewrite the "Required coordination exercise" so each step makes the agent **read back the artifact** the tool was supposed to produce and record file-level evidence in the report's `toolChecks[].evidence`. Specifically: (a) `state_set`/`state_transition` → after the call, **read** `$MINIH_RUN_DIR/state/inside.json` AND `$MINIH_RUN_DIR/state/history.ndjson`; require both contain the just-written value; failure to find them = `status: 'fail'`. (b) `inbox_send` → after the call, **read** `$MINIH_RUN_DIR/inbox/inside/messages.ndjson` and confirm the new message line is present with the expected `subject`, `body`, `type`, AND (when set) `ackOf`. (c) `inbox_ack` → confirm an inside `ack` message with `ackOf` equal to the acked id appears in the same file. (d) `inbox_list` → confirm the count/contents match what the file shows. (e) **Inject a known outside message**: workshop the prompt so the agent uses `outside.md` to set up an outside inbox seed (or relies on the test harness to seed one — document the dependency). Add a `retrospective.confusing` note if any tool returned OK but the artifact was missing/wrong. | agents | `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/prompt.md` | Prompt explicitly requires read-back-and-verify per tool; running the agent with the FX001 fix in place produces `verdict: 'all-pass'` AND `toolChecks[].evidence` quotes the actual file contents. **Without** the FX001 fixes (counterfactual / pre-fix state), the agent would produce `verdict: 'fail'` because state files don't exist and `ackOf` is dropped — confirming the smoke now lights up like a Christmas tree when contracts break. | This is the structural fix to "smoke that returns success because the tool returned OK". The agent must observe artifacts, not call counts. |
| [x] | FX001-8 | Tighten `agents/coordination-smoke-test/output-schema.json`: make `toolChecks[].evidence` REQUIRED (currently optional) and bump `minLength: 20` so an agent can't pass empty evidence. Add a top-level `artifacts` section (object) with required `stateFile`, `historyFile`, `inboxInsideFile` boolean-existence flags so the report itself attests that the observable artifacts existed at session end. | agents | `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/output-schema.json` | Schema validates against a passing run; existing run history (if any) under `agents/coordination-smoke-test/runs/` may need a one-time hand-edit OR can be ignored (only future runs are validated). | Schema-level enforcement of the verify-don't-call rule; matches the "lights up like a Christmas tree" intent. |
| [x] | FX001-9 | **Manual smoke** of the tightened `coordination-smoke-test` agent: `cd /Users/jordanknight/substrate/minih && node dist/cli/index.js run coordination-smoke-test --human` (or non-human, doesn't matter). Confirm: (a) verdict is `all-pass`; (b) every `toolChecks[].evidence` quotes a real artifact path/snippet; (c) the new `artifacts.{stateFile,historyFile,inboxInsideFile}` flags are all `true`; (d) `state/inside.json` and `state/history.ndjson` are present on disk after the run. Capture in this fix's `.log.md`. | verification (manual) | `agents/coordination-smoke-test/runs/<runId>/` | All 4 conditions satisfied. | Closes the loop on (B) — the agent-level dogfood now matches the code-level (FX001-1) test in honesty. |

## Workshops Consumed

- [Workshop 007 — coordinated code-review companion](../workshops/007-coordinated-code-review-companion.md) — established the `ackOf` reply rule and inside-state vocabulary that this fix makes enforceable.
- Subtask FX001 dossier (the build) — surfaced these gaps via dogfood smoke.

## Acceptance

- [x] FX001-1 test boots a coordinated agent fixture and asserts state publication (preferred + legacy locations) + `ackOf`-linked reply through the **real MCP tool surface** (no mocking).
- [x] `state_transition` with an agent-local `state/inside-state.schema.json` writes `state/inside.json` and appends `state/history.ndjson`.
- [x] **Back-compat**: `state_transition` with a legacy `<agentDir>/inside-state.schema.json` (no `state/` folder) still works — preserves `coordination-smoke-test`, `coordination-loop-validator`, and any future coordinated agent that uses the legacy layout.
- [x] `inbox_send({ subject, body, type, ackOf })` persists `ackOf` in the resulting `InboxMessage`.
- [x] Companion re-smoke (manual): state files appear; `finding`/`summary` messages carry `ackOf` matching the outside task id.
- [x] No regressions: existing `test/mcp/state.test.ts` and `test/mcp/inbox.test.ts` (etc.) still pass.
- [x] F003 (code-review test-coverage gap) addressed by FX001-1 establishing real-tool-surface coverage that the existing per-tool unit tests lacked.
- [x] Workshop 007 § Inbox Vocabulary "Reply rule" updated to confirm `ackOf` is tool-supported.
- [x] `just fft` exit 0.
- [x] **`coordination-smoke-test` agent now verifies (not just calls):** every `toolChecks[].evidence` references a real artifact path/snippet; new `artifacts.{stateFile,historyFile,inboxInsideFile}` flags all `true`; agent fails loudly when a tool returns OK but the artifact is missing.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-04-28)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth | Hidden Assumptions, Technical Constraints, Concept Documentation | 1 HIGH fixed (parseInboxSendInput doesn't exist), 1 MED fixed (no existing inbox_send test) | ✅ |
| Cross-Reference | Integration & Ripple, Domain Boundaries, User Experience | 1 HIGH fixed (F003 explicit), 1 MED fixed (workshop 007 wording) | ✅ |
| Completeness | Edge Cases & Failures, Performance & Scale, Deployment & Ops, Security & Privacy | 3 MED fixed (legacy-root test, ackOf rules, fixture context shape), 1 LOW fixed (manual-only labeling) | ✅ |
| Forward-Compatibility | Forward-Compatibility, System Behavior | 1 LOW fixed (named coordination-loop-validator in back-compat scope), 5/5 consumers PASS | ✅ |

**Lens coverage**: 11/12 (above the 8-floor). Forward-Compatibility engaged (5 consumers, all PASS).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `plan-6` implementor | 6 concrete tasks, absolute paths, success criteria, test-before-code | None | ✅ | FX001-1 → -2/-3/-4 → -5/-6 ordering with TDD red bar gate. |
| `code-review-companion` re-smoke | state files appear; reply messages carry `ackOf` | None | ✅ | FX001-5 explicitly verifies both. |
| Phase 2 of plan 009 (Ink view) | `human-view-model.ts` receives real `ackOf`-linked messages for workbench reply-linkage | None | ✅ | FX001-3 widens `inbox_send` and propagates to `InboxMessage`; reducer already consumes `ackOf` (`src/runner/human-view-model.ts:228-247`). |
| Existing coordinated agents (`coordination-smoke-test`, `coordination-loop-validator`) | Back-compat: legacy root schema location and no `ackOf` requirement | None | ✅ | FX001-2 documents 3-level fallback; FX001-1 case (b) tests legacy-root path; FX001-3 makes `ackOf` optional. |
| Future coordinated agents | Clear convention: prefer `state/`-located schema; `ackOf` optional | None | ✅ | FX001-2 + FX001-4 update Workshop 007 wording so the convention is documented in one place. |

**Outcome alignment**: "Human Agent View provides a readable terminal operator console for minih agent runs. It lets an outside actor attach to an active or completed run and understand the inside agent's transcript, tool activity, message/activity timeline, state, output status, and available controls without juggling tail, status, inbox, and state commands separately." — the fix as shipped advances it.

**Standalone?**: No — five named downstream consumers.

**Fixes applied (HIGH)**:
- ST-HIGH: `parseInboxSendInput` does not exist as a named function — FX001-3 task body now correctly says "inline input parsing inside `inboxSend()` lines 225-245, no separate parser function".
- CR-HIGH: F003 (test coverage gap) was implicitly addressed by FX001-1 but not stated. FX001-1 task body and acceptance now explicitly call out that the new e2e test closes F003.

**Fixes applied (cheap MEDIUMs/LOW)**:
- ST-MED: `test/mcp/types.test.ts` has no existing `inbox_send` assertion — FX001-4 now says "Add" not "Update".
- CR-MED: FX001-4 now requires Workshop 007 wording to confirm `ackOf` is tool-supported (closes prompt-vs-tool drift).
- COMP-MED-1: Legacy-root fallback now has explicit test coverage in FX001-1 case (b).
- COMP-MED-2: `ackOf` validation rules spelled out (shape only at MCP boundary, optimistic accept on existence, same-lane allowed).
- COMP-MED-3: `McpServerContext` field set explicitly listed in FX001-1 (`agentSlug`, `agentDir`, `agentsDir`, `runId`, `runDir`, `inboxDir`, `stateDir`).
- COMP-LOW: FX001-5 explicitly labelled "Manual verification only — NOT a CI/automated regression".
- FC-LOW: Acceptance row added naming `coordination-loop-validator` in back-compat scope.

**Open**: none.

**Overall**: ✅ VALIDATED WITH FIXES — ready for `/plan-6` implementation.
