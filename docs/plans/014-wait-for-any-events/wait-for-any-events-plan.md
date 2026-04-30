# Wait For Any — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-30
**Spec**: [wait-for-any-events-spec.md](./wait-for-any-events-spec.md)
**Workshop**: [workshops/001-event-taxonomy-and-envelope.md](./workshops/001-event-taxonomy-and-envelope.md)
**Status**: DRAFT

## Summary

Add a single new MCP tool, `wait_for_any`, that lets coordinated inside agents long-poll for any combination of events (inbox messages + state changes today; filesystem and tool-completion later) in one call. Reuses ~90% of existing primitives: `runner/inbox-poll.ts` for the inbox kind, `runner/file-watcher.ts` for the state kinds, and the same `settled`/`cleanup` pattern from `pollInboxLane` for the multi-watch settlement race. Discriminated-union event envelope (`{ kind, ts, data }`) absorbs future event kinds without breaking v1 callers. KISS throughout — no matcher DSLs, no enforcement, structural self-write filtering only.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| mcp | existing | **modify** | New `wait_for_any` tool: schema in `mcp/types.ts`, handler in `mcp/tools/wait.ts`, registration in `mcp/server.ts`, error mapping. New error code `MCP_STATE_CORRUPT`. |
| runner | existing | **modify** | New shared event-wait primitive: `runner/event-wait.ts` (settlement race over N watches, self-write filter, batched event delivery). Reuses `pollInboxLane` and `watchFileChanges`. |
| cli | existing | **consume** | No CLI surface changes. Dogfood-only edits to the `coordination-smoke-test` agent prompt + outside.md (not domain code). |

No new domain. No new contract category. No domain registry change. No domain map change.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `/Users/jordanknight/substrate/minih/src/runner/event-wait.ts` | runner | internal | NEW. The settlement-race primitive: takes N watch entries, returns the first batch of fired events or a clean timeout. No I/O of its own beyond the watches it composes. |
| `/Users/jordanknight/substrate/minih/src/runner/index.ts` | runner | contract | Re-export `waitForAny`, event-envelope types, `EventKind` union. |
| `/Users/jordanknight/substrate/minih/src/runner/types.ts` | runner | contract | Add public types: `EventKind`, `WatchEntry`, `EventEnvelope`, `WaitForAnyResult`. |
| `/Users/jordanknight/substrate/minih/src/mcp/types.ts` | mcp | contract | Add `wait_for_any` to `MCP_TOOL_NAMES`, register `ToolContract`, add `MCP_STATE_CORRUPT` to `McpErrorCode`. |
| `/Users/jordanknight/substrate/minih/src/mcp/tools/wait.ts` | mcp | internal | NEW. The MCP-side handler: parses input, delegates to `runner.waitForAny`, maps errors. |
| `/Users/jordanknight/substrate/minih/src/mcp/server.ts` | mcp | internal | Wire `wait_for_any` into the dispatch table. |
| `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` | runner | internal | Teach `wait_for_any` in `COORDINATION_TOOLS_SECTION`. |
| `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md` | runner (dogfood) | internal | Mirror operator-side teaching block. |
| `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md` | runner (template) | internal | Mirror (must stay byte-identical to `_shared/preamble.md`). |
| `/Users/jordanknight/substrate/minih/AGENTS_README.md` | docs | internal | Add `### Wait for any` subsection in coordination area with worked example. |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/prompt.md` | dogfood | internal | New step 9 exercising `wait_for_any` end-to-end. |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/outside.md` | dogfood | internal | Document the operator-side write that triggers the smoke test's wait. |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/output-schema.json` | dogfood | internal | Bump `toolChecks.minItems` 7 → 8. Add `wait_for_any` to enum if needed. |
| `/Users/jordanknight/substrate/minih/test/runner/event-wait.test.ts` | runner (test) | internal | NEW. Settlement race + self-write filter + cleanup invariants + clean timeout, all over `FakeNativeWatcher`. |
| `/Users/jordanknight/substrate/minih/test/mcp/tools-wait.test.ts` | mcp (test) | internal | NEW. Schema validation (caps, required fields, unknown/duplicate kind, bounds) + error mapping. |
| `/Users/jordanknight/substrate/minih/test/mcp/server.test.ts` | mcp (test) | internal | EXTEND. Add `wait_for_any` to the manifest assertion + one round-trip test. |
| `/Users/jordanknight/substrate/minih/test/mcp/types.test.ts` | mcp (test) | internal | EXTEND. Assert `wait_for_any` contract shape (events array, waitMs, return envelope). |
| `/Users/jordanknight/substrate/minih/test/runner/wait-for-any-fs.test.ts` | runner (test) | internal | NEW. One real-`fs.watch` integration test exercising mixed-kind wait against a tmpdir run folder. |
| `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | runner | internal | History row + Concepts entry for "Event waiting" if appropriate. |
| `/Users/jordanknight/substrate/minih/docs/domains/mcp/domain.md` | mcp | internal | History row referencing plan 014. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | High | `pollInboxLane` already implements the exact `settled`/`cleanup` pattern we need (`inbox-poll.ts:183-243`). | Lift the pattern verbatim into `event-wait.ts`'s settlement race; don't reinvent. |
| 02 | High | `watchFileChanges` (`runner/file-watcher.ts:49`) is the cross-platform watch wrapper used by the inbox forwarder. State files (`state/inside.json`, `state/outside.json`) live in the same agents dir tree, so reuse without modification. | Use `watchFileChanges` for both `state.peer.changed` and `state.self.changed`. |
| 03 | High | `MAX_INBOX_WAIT_MS = 30000` is already exported from `mcp/types.ts:4`. Reuse the same cap for `wait_for_any.waitMs` — keeps a single source of truth. | Reference, do not duplicate the constant. |
| 04 | Medium | `runner/state.ts` exports `readStateLazy`, `writeState`, `appendHistory`, plus `StateCorruptError` (line 42). When parsing peer state for the wait-entry snapshot or wake-time read, reuse `readStateLazy` and let `StateCorruptError` propagate. Map to `MCP_STATE_CORRUPT` at the tool boundary. | Plan task wires the error mapping; no new state-read primitive needed. |
| 05 | Medium | `writeState` uses `writeFileAtomicAsync` (temp-write + rename) which can produce two mtime ticks per logical write. | Workshop-mandated mtime-plus-parsed-JSON-diff dedup; one settlement still suffices because settle-once + cleanup on first match. |
| 06 | Medium | The MCP tool registration pattern: `mcp/types.ts` lists tools in `MCP_TOOL_NAMES` and `TOOL_CONTRACTS`; `mcp/server.ts:listMinihMcpTools` reads from that array; dispatch lives in `mcp/server.ts` (or per-tool files in `mcp/tools/`). | Add `wait_for_any` to `MCP_TOOL_NAMES`, append to `TOOL_CONTRACTS`, dispatch via new `mcp/tools/wait.ts`. |
| 07 | Medium | Self-write filter for `state.self.changed` relies on `updatedBy === 'inside'` + `updatedAt` recency. `runner/state.ts:writeState` always sets `updatedBy` based on the `Side` argument; verified in code. | Filter logic is straightforward; document the invariant in `runner/state.ts` source comment so future writers don't break it. |
| 08 | Medium | Settlement-race regression risk: tearing down N watches when one fires is the trickiest part. | Single cleanup-callback array; invariant test asserts no leaked watches across all 4 settlement paths (event-fire / timeout / error / argument-validation-error). |
| 09 | Low | `pollInboxLane` already accepts `waitForAny`-as-types-array; the `wait_for_any` inbox kind passes its `filter.types` through unchanged. | Direct delegation, no new filter logic on the runner side. |
| 10 | Low | The `FakeNativeWatcher` test seam used in `test/runner/inbox-forwarder.test.ts` is the right vehicle for unit tests. One real-`fs.watch` integration test in `test/integration/` covers the cross-platform smoke. | Reuse fake watcher; add one integration test for end-to-end confidence. |

## Harness Strategy

Existing minih harness (`just fft` quality gate). No harness work required. Per-phase validation = `just fft` plus the new test files in this plan. Smoke-test agent's new step 9 (T011) provides live regression evidence.

## Implementation

**Objective**: Ship `wait_for_any` as a new MCP tool with three v1 event kinds (`inbox.message`, `state.peer.changed`, `state.self.changed`), wired into the existing inbox-poll/file-watcher primitives, with a discriminated-union envelope that absorbs future event kinds.

**Testing Approach**: Lightweight (per spec).
- Unit tests over `FakeNativeWatcher` for fast deterministic settlement-race + self-write-filter coverage
- Schema-validation tests at the MCP boundary
- One real-`fs.watch` integration test for cross-platform smoke
- Smoke-test agent's new step 9 = live regression evidence
- `just fft` is the gate

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Add public types: `EventKind` union, `WatchEntry` discriminated union, `EventEnvelope` discriminated union, `WaitForAnyResult` interface (with `events: EventEnvelope[]` + `wait: { requestedMs, elapsedMs, timedOut, matched }`). | runner | `/Users/jordanknight/substrate/minih/src/runner/types.ts` | Types compile under strict mode; types-test asserts narrowing on `EventEnvelope.kind`. | Per workshop "TypeScript Types (sketch)". |
| [ ] | T002 | Implement `runner/event-wait.ts:waitForAny(opts) -> Promise<WaitForAnyResult>`. Settlement race over N watches + waitMs timeout, single-settle, cleanup-callback array, batched event delivery. Three internal watch sources: `inbox.message` (delegates to `pollInboxLane`), `state.peer.changed` (file-watch + diff snapshot), `state.self.changed` (file-watch + diff snapshot + self-write filter via `updatedBy === 'inside'` recency check). | runner | `/Users/jordanknight/substrate/minih/src/runner/event-wait.ts` | Function signature matches workshop; `pollInboxLane`/`watchFileChanges`/`readStateLazy` reused; no new file-watch primitive. | Per finding 01, 02, 04, 07. |
| [ ] | T003 | Re-export `waitForAny`, `EventKind`, `WatchEntry`, `EventEnvelope`, `WaitForAnyResult` from `runner/index.ts`. | runner | `/Users/jordanknight/substrate/minih/src/runner/index.ts` | All five symbols importable as `from '../runner/index.js'`. | |
| [ ] | T004 | Write unit tests over `FakeNativeWatcher` covering: (a) inbox-only wait fires on append, (b) state-only wait fires on outside.json write, (c) mixed-kind wait fires on whichever first, (d) multi-event delivery — multiple writes within debounce window deliver as one batch sorted by `ts`, (e) clean timeout returns `events: []` + `wait.timedOut: true`, (f) self-write suppression — inside agent's own `updatedBy: 'inside'` write does NOT wake `state.self.changed`, (g) cleanup invariant — every watch closed on every settlement path (fire, timeout, error). | runner (test) | `/Users/jordanknight/substrate/minih/test/runner/event-wait.test.ts` | All 7 unit cases green; covers ACs 1–6, 13, 14, 15. | Per finding 08, 10. |
| [ ] | T005 | Add `MCP_STATE_CORRUPT` to `McpErrorCode` union in `mcp/types.ts`. Add `wait_for_any` to `MCP_TOOL_NAMES`. Append the `wait_for_any` `ToolContract` to `TOOL_CONTRACTS`: input schema with `events` (array, 1–8, items = `{ kind, filter? }`), `waitMs` (integer, 0–MAX_INBOX_WAIT_MS), both required; description text matches workshop "MCP Tool Schema (sketch)". | mcp | `/Users/jordanknight/substrate/minih/src/mcp/types.ts` | `MCP_TOOL_NAMES.length` = current+1; types-test asserts contract shape. | Per finding 03, 06. |
| [ ] | T006 | Implement `mcp/tools/wait.ts:waitForAnyTool(context, input)`. Parses input (rejects: missing `events`/`waitMs`, length < 1 or > 8, unknown kind, duplicate kind, `waitMs` out of bounds), delegates to `runner.waitForAny`, maps `StateCorruptError` → `MCP_STATE_CORRUPT`, `InboxPollError` → existing mappings, others → `MCP_INTERNAL_ERROR`. Returns the result via `jsonResult`. | mcp | `/Users/jordanknight/substrate/minih/src/mcp/tools/wait.ts` | All validation paths return the documented error codes; success path returns the discriminated-union envelope. | Per finding 04. |
| [ ] | T007 | Wire `wait_for_any` into `mcp/server.ts` dispatch table. | mcp | `/Users/jordanknight/substrate/minih/src/mcp/server.ts` | `client.callTool('wait_for_any', {...})` resolves correctly. | |
| [ ] | T008 | Schema-validation tests in `test/mcp/tools-wait.test.ts`: missing `events`, missing `waitMs`, empty `events`, 9 entries, unknown kind, duplicate kind, `waitMs` < 0, `waitMs` > 30000 — each returns `MCP_INVALID_ARGUMENT`. Plus one happy-path test asserting envelope shape. | mcp (test) | `/Users/jordanknight/substrate/minih/test/mcp/tools-wait.test.ts` | 9 test cases green; covers ACs 7–11, 17. | |
| [ ] | T009 | Extend `test/mcp/server.test.ts`: add `wait_for_any` to the `MCP_TOOL_NAMES` manifest assertion + one stdio round-trip test (`callTool('wait_for_any', { events: [...], waitMs: 100 })` returns clean-timeout envelope). | mcp (test) | `/Users/jordanknight/substrate/minih/test/mcp/server.test.ts` | Existing 4 tests still pass; new round-trip test passes. | |
| [ ] | T010 | One integration test in `test/runner/wait-for-any-fs.test.ts` using real `fs.watch` against a tmpdir run folder. Mixed-kind wait; write to `state/outside.json` mid-wait; assert wake with a `state.peer.changed` event. | runner (test) | `/Users/jordanknight/substrate/minih/test/runner/wait-for-any-fs.test.ts` | Test passes locally on Darwin; covers AC-2 + AC-16 with real fs. | Per finding 10. |
| [ ] | T011 | Extend `coordination-smoke-test` agent: new step 9 in `prompt.md` calling `wait_for_any({ events: [{ kind: 'state.peer.changed' }, { kind: 'inbox.message' }], waitMs: 30000 })` and verifying envelope shape on disk. Update `outside.md` to drive the wake (write to outside state mid-run). Bump `output-schema.json toolChecks.minItems` 7 → 8. | dogfood | `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/{prompt.md,outside.md,output-schema.json}` | Smoke test agent runs end-to-end with all-pass verdict; new toolCheck includes the `wait_for_any` envelope evidence. | Live regression — covers AC-23. |
| [ ] | T012 | Update preamble × 3: add `wait_for_any` to `COORDINATION_TOOLS_SECTION` in `preamble-builder.ts`; add `### Coordination event waiting (plan 014)` subsection to `agents/_shared/preamble.md` and `src/templates/shared-preamble.md`. Both shared preambles must stay byte-identical (verified via `diff`). | runner | `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` AND `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md` AND `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md` | All three files updated; `diff agents/_shared/preamble.md src/templates/shared-preamble.md` is empty. | Covers AC-21. |
| [ ] | T013 | Update `AGENTS_README.md`: add `### Wait for any` subsection in the coordination area with worked example showing mixed-kind wait. | docs | `/Users/jordanknight/substrate/minih/AGENTS_README.md` | Subsection present; markdown lint clean. | Covers AC-22. |
| [ ] | T014 | Append history rows to `docs/domains/{runner,mcp}/domain.md` referencing plan 014. Runner row describes new `event-wait.ts` primitive + types; mcp row describes new tool + new error code. Optionally add a Concepts entry for "Event waiting" in `runner/domain.md` if the team feels it warrants surfacing. | runner / mcp | `/Users/jordanknight/substrate/minih/docs/domains/{runner,mcp}/domain.md` | Both domain.md files have a 014 row. | Covers AC-25. |
| [ ] | T015 | Run `just fft`. Fix any lint/format/typecheck/test/audit findings as ours, no deferrals. | all | repo root | `just fft` passes end-to-end. | Covers AC-24. Project rule: own every finding. |

### Acceptance Criteria

Direct mapping from spec § Acceptance Criteria:

- [ ] AC-1 (inbox-only wait fires on append) — T002, T004
- [ ] AC-2 (state.peer.changed wakes on outside write) — T002, T004, T010
- [ ] AC-3 (mixed-kind first-fire) — T002, T004
- [ ] AC-4 (multi-event delivery, sorted by ts) — T002, T004
- [ ] AC-5 (discriminated-union envelope) — T001, T002
- [ ] AC-6 (clean timeout, no throw) — T002, T004, T009
- [ ] AC-7 (events.length cap 1–8) — T006, T008
- [ ] AC-8 (required fields) — T006, T008
- [ ] AC-9 (unknown kind) — T006, T008
- [ ] AC-10 (duplicate kind) — T006, T008
- [ ] AC-11 (waitMs bounds) — T006, T008
- [ ] AC-12 (inbox filter passthrough) — T002, T004
- [ ] AC-13 (self-write suppression on state.self.changed) — T002, T004
- [ ] AC-14 (cross-lane structural isolation) — T002, T004
- [ ] AC-15 (cleanup invariants) — T002, T004
- [ ] AC-16 (pre-existing files) — T002, T010
- [ ] AC-17 (forward-compat envelope) — T001, T005, T008
- [ ] AC-18 (MCP_STATE_CORRUPT) — T005, T006
- [ ] AC-19 (no regression on inbox_list) — T015 (via `just fft`)
- [ ] AC-20 (no regression on inbox_ack/state_*) — T015
- [ ] AC-21 (preamble × 3) — T012
- [ ] AC-22 (AGENTS_README) — T013
- [ ] AC-23 (smoke-test step) — T011
- [ ] AC-24 (just fft passes) — T015
- [ ] AC-25 (domain history) — T014

### Implementation Order Notes

Suggested order: T001 → T002 → T004 (TDD-flavoured: write tests right after the impl) → T003 → T005 → T006 → T008 → T007 → T009 → T010 → T011 → T012 → T013 → T014 → T015. T011 (smoke test) comes after T013 (AGENTS_README) so the smoke-test prompt can reference the docs. T015 is always last. Companion review pings at every commit boundary per Power On Mode.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Settlement-race cleanup leaks a watch handle when one watch errors out before cleanup runs | Medium | Medium | T004 cleanup-invariant test covers all 4 settlement paths; companion review verifies finally-block placement |
| `writeFileAtomicAsync` double-mtime causes duplicate event delivery | Medium | Low | mtime + parsed-JSON-diff dedup in `event-wait.ts`; T004 multi-event-delivery test indirectly covers this (single logical write delivers as one batch) |
| Self-write filter false-positive (suppresses a legitimate wake) when an unknown inside-side actor writes inside.json without `updatedBy: 'inside'` | Low | Medium | T002 documents the invariant in `runner/state.ts`; T004 explicitly tests both branches |
| Cross-platform `fs.watch` flake on linux/windows CI | Low | Low | Unit tests use `FakeNativeWatcher`; only T010 uses real fs.watch with generous timeout |
| Snapshot tests in `test/mcp/types.test.ts` break from MCP_TOOL_NAMES growing by one | Medium | Low | Expected; T009 updates assertion explicitly. Project rule: own the finding. |
| `inbox_list` "no regression" gets accidentally violated when the parser is reused under a new shape | Low | High | T015 runs the entire test suite — `inbox_list` tests stay green or the plan stops |
| Drift between preamble-builder.ts and the two shared-preamble.md mirrors | Medium | Low | T012 explicitly diffs the mirrors; § 6a companion drift-sweep clause catches doc drift |

---

**Validation Record**

### plan-4-v2-complete-the-plan — 2026-04-30

| Validator | Status | HIGH | MED | LOW |
|---|---|---|---|---|
| Structure | PASS | 0 | 0 | 0 |
| Testing Alignment | FIXED | 0 (was 1) | 0 | 0 |
| Domain Completeness | PASS | 0 | 0 | 0 |
| Doctrine | PASS | 0 | 0 | 0 |
| ADR | N/A | — | — | — |

**HIGH (fixed)**: T010 placed the integration test under `test/integration/` — a directory that doesn't exist in the repo. Existing convention is `test/{runner,cli,mcp}/`. Fix: relocated to `test/runner/wait-for-any-fs.test.ts` (kept the file name self-describing so the cross-platform / real-fs intent stays visible).

**Verdict**: READY (after fix).

---

## Validation Record (2026-04-30) — validate-v2 (narrow inline)

| Agent | Lenses Covered | Issues | Verdict |
|---|---|---|---|
| Source Truth (inline) | Accuracy, Concept Documentation | 0 | ✅ |
| Cross-Reference (inline) | Cross-Reference, Hidden Assumptions | 1 LOW (cosmetic) | ✅ |
| Forward-Compatibility (inline) | Forward-Compatibility, System Behavior, Integration & Ripple, Edge Cases | 0 | ✅ |

**Lens coverage**: 8/12 — above the 8-floor for narrow scope on CS-2 Simple plan.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| `/plan-6` implementor | Unambiguous file paths + done-when criteria | encapsulation lockout | ✅ | All 15 tasks list absolute paths; T002/T005/T006 cite specific exports + workshop sections |
| Workshop 001 design | API shape preserved (events array + waitMs + envelope discriminator) | contract drift | ✅ | T001 types match workshop verbatim; T005 schema cap (1–8) matches; T006 error mapping matches |
| Plan 013 reply chains | inbox_send / inbox_list / inbox_ack semantics preserved | contract drift | ✅ | No inbox-handler edits; T015 + AC-19 lock no-regression |
| Plan 012 peer-activity | peer-activity helpers untouched | lifecycle ownership | ✅ | `runner/peer-activity.ts` not in domain manifest |
| Future v2 (`fs.changed`, `tool.completed`) | Discriminated-union envelope absorbs new kinds without v1-caller breakage | shape mismatch | ✅ | T001 `EventEnvelope` is a union over `kind`; envelope `data` is not `additionalProperties: false`-locked at the top schema (allows kind-specific shapes) |
| Companion review (Power On Mode) | Reviewable in commit-sized chunks | test boundary | ✅ | T001–T015 each map cleanly to one logical commit; § 6a anti-capture clause already in place |

**Outcome alignment**: The plan, as shipped, advances the Outcome — T002 implements the settlement-race primitive that lets inside agents wait for outside state changes without spinning on `state_get`; T011 dogfoods it via the coordination-smoke-test agent for live regression evidence; T012/T013 teach agents the new tool exists in the preamble and AGENTS_README.

**Standalone?**: No — `/plan-6` implementor is a named downstream consumer with concrete shape requirements; Workshop 001 is a named upstream contract.

### Issues
| Sev | Lens | Issue | Action |
|---|---|---|---|
| LOW | Cross-Reference | Implementation Order says "T011 comes after T013 so the smoke-test prompt can reference the docs" — smoke prompts don't actually reference AGENTS_README. Order remains valid; rationale is loose. | Cosmetic; tighten at implementation if it stands out. |

**Overall**: ✅ VALIDATED — no fixes needed beyond plan-4 correction (test path) already applied. Ready for `/plan-6-v2-implement-phase`.

---

**Next steps**:
- Optional: `/plan-4-complete-the-plan` for validation (recommended given new primitive + new error code)
- Implement: `/plan-6-v2-implement-phase --plan "/Users/jordanknight/substrate/minih/docs/plans/014-wait-for-any-events/wait-for-any-events-plan.md"`
