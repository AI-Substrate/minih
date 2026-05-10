# Wait For Any — Unified Event-Wait Primitive

**Mode**: Simple

📚 This specification is derived from the authoritative design in [`workshops/001-event-taxonomy-and-envelope.md`](./workshops/001-event-taxonomy-and-envelope.md). The workshop nails the API shape, event taxonomy, envelope schema, watch lifecycle, self-write filtering, and forward-compat strategy. This spec restates the user-facing WHAT/WHY and converts the workshop's decisions into testable acceptance criteria.

ℹ️ No `research-dossier.md` was produced for this plan — the smoke-test agent's magicWand surfaced the gap, the workshop locked the design, and the existing `runner/inbox-poll.ts` and `runner/file-watcher.ts` codepaths give us a high-confidence reuse map without separate exploration.

## Summary

Add a single MCP tool — `wait_for_any` — that lets coordinated inside agents long-poll for *any combination* of events (inbox messages and state changes today; filesystem and tool-completion events later) in one call. Replaces the current "spin-loop on `state_get`" workaround surfaced by the coordination-smoke-test agent. Delivers a discriminated-union event envelope so future event kinds plug in without breaking v1 callers. KISS throughout: no matcher DSLs, no enforcement — minih reports what fired, agents decide what it means.

## Goals

- An inside agent can wait for outside state changes without spinning in a `state_get` loop.
- An inside agent can wait for **either** a specific inbox-message type **or** a peer-state change in a single call, getting whichever fires first (or both, if they fire concurrently).
- Future event kinds (`fs.changed`, `tool.completed`, …) plug into the same tool surface via the discriminated-union envelope without breaking agents written against v1.
- The agent's own writes (e.g., its own `state_set` / `state_transition`) do NOT wake the agent's own `state.self.changed` watches — no self-loops.
- The existing `inbox_list({ waitMs, waitForAny })` path keeps working unchanged. `wait_for_any` is purely additive.
- A clean, no-error timeout shape (`events: []` + `wait.timedOut: true`) lets agents branch on "nothing fired" without exception handling.
- The smoke-test agent is extended to exercise `wait_for_any` end-to-end so the capability becomes part of the regression dogfood.

## Non-Goals

- **No filesystem or tool-completion event kinds in v1.** The envelope is designed to absorb them later; shipping them now would inflate scope. User confirmed: filesystem support comes "later" with agent-config schema additions.
- **No matcher DSL** beyond the inline filters each event kind already supports (`inbox.message.types` is the only filter in v1). KISS, per user.
- **No outside-side equivalent.** Outside operators are humans + shells; no `minih outside wait` command in v1.
- **No deprecation of `inbox_list`.** It stays as the fast-path read-or-wait for the inbox-only case.
- **No matcher** for `state.peer.changed` — agents inspect `data.newState` themselves. No path-equals, no value-equals.
- **No `oldState` in the state-changed envelope** in v1. Agents that need a diff keep their own snapshot. (Workshop O2 deferred.)
- **No backward-incompatible changes** to any existing tool or schema.
- **No new docs/how/ guide** in v1 — the preamble + AGENTS_README + smoke test cover it. Add a how-doc only if usage demands it.
- **No outside-side `state.outside.changed` watch from CLI.** The CLI already has `outside state get` for synchronous reads; the wait primitive is inside-MCP only in v1.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| mcp | existing | **modify** | New `wait_for_any` tool: schema, handler, dispatch, error mapping. |
| runner | existing | **modify** | New shared event-source primitives (state-watch with self-write filter; settlement race over N watches). Extracts/extends `inbox-poll.ts` and `file-watcher.ts` reuse. |
| cli | existing | **consume** | No CLI surface changes. Dogfood-only edits to `coordination-smoke-test` agent (not domain code). |

No new domain. No domain registry change. No domain map change (the runner→mcp dependency edge already exists).

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=0, D=0, N=1, F=0, T=1 → P=3 → CS-2
- **Confidence**: 0.90
- **Assumptions**:
  - Workshop's API shape and decision log hold (8 RESOLVED, 2 OPEN). No surprises during implementation.
  - `runner/file-watcher.ts` cross-platform watch wrapper handles `state/*.json` writes correctly (it already does for `inbox/*/messages.ndjson`).
  - `state_set` / `state_transition` callers always populate `updatedBy` correctly — relied upon by the self-write filter for `state.self.changed`.
  - `MAX_INBOX_WAIT_MS = 30000` is the right cap to reuse for `wait_for_any.waitMs`.
- **Dependencies**: none beyond runner/mcp internals already in tree.
- **Risks**:
  - **Settlement race correctness** under concurrent fire (multiple watches firing within the file-watcher debounce window). Mitigated by reusing `inbox-poll.ts`'s single-settle pattern + collecting events into a batch before resolving.
  - **`writeFileAtomicAsync` double-tick** — the temp-write + rename used by `runner/state.ts` may produce two mtime ticks per logical write. Mitigated by the workshop's "mtime + parsed-JSON-diff against entry snapshot" approach.
  - **Self-write filter false negatives** — if another inside-side actor writes `inside.json`, it will be (correctly) suppressed only if `updatedBy === 'inside'` is set. Failure to set it would fire spurious wakes. Mitigated by audit during T-tests; documented in domain.md.
- **Phases**: single implementation phase (Simple Mode). Roughly: schema → state-watch primitive → settlement race helper → MCP tool registration → tests → preamble + AGENTS_README + smoke-test step → domain history.

## Acceptance Criteria

1. `wait_for_any({ events: [{ kind: 'inbox.message' }], waitMs: <ms> })` resolves with all matching inbox messages that arrive during the wait, in arrival order.
2. `wait_for_any({ events: [{ kind: 'state.peer.changed' }], waitMs: <ms> })` resolves when the peer state file is written and the parsed JSON differs from the wait-entry snapshot.
3. Mixed-kind wait — `wait_for_any({ events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }], waitMs: <ms> })` resolves with whichever of the two fires first (or both, if both fire within the file-watcher debounce window).
4. **Multi-event delivery**: when multiple events fire within the debounce window, the result `events` array contains all of them, sorted ascending by envelope `ts`.
5. **Discriminated union**: each event in the result is shaped `{ kind, ts, data }` with the `kind` literal driving TypeScript narrowing on `data`.
6. **Clean timeout**: when no event fires, the call resolves (does NOT throw) with `events: []` and `wait: { requestedMs, elapsedMs, timedOut: true, matched: false }`.
7. **`events.length` cap**: `wait_for_any({ events: [...8 entries], … })` succeeds; 9 entries returns `MCP_INVALID_ARGUMENT`.
8. **Required fields**: missing `events` or missing `waitMs` returns `MCP_INVALID_ARGUMENT`.
9. **Unknown kind**: `{ kind: 'fs.changed' }` (a v2 kind not yet implemented) returns `MCP_INVALID_ARGUMENT` with a message naming the supported kinds.
10. **Duplicate kind**: `[{ kind: 'inbox.message' }, { kind: 'inbox.message' }]` returns `MCP_INVALID_ARGUMENT`.
11. **`waitMs` bounds**: `waitMs < 0` or `waitMs > MAX_INBOX_WAIT_MS` returns `MCP_INVALID_ARGUMENT`.
12. **Inbox filter passthrough**: `{ kind: 'inbox.message', filter: { types: ['task','question'] } }` matches only those types; non-matching messages do not wake the wait.
13. **Self-write suppression on `state.self.changed`**: when the inside agent's own `state_set` or `state_transition` causes the inside state file to be written, an active `state.self.changed` watch does NOT wake — the wait continues until either an external write to `inside.json` (from another inside-side actor) or `waitMs` elapses.
14. **Cross-lane structural isolation**: an inside agent's own `inbox_send` (which appends to `inbox/inside/messages.ndjson`) does NOT wake an `inbox.message` watch (which structurally watches the *outside* lane file).
15. **Cleanup invariants**: every file-watch handle registered by `wait_for_any` is closed before the tool returns, regardless of settlement path (event-fire, timeout, error, or cancellation).
16. **Pre-existing inbox/state files load and watch correctly** — calling `wait_for_any` against a run with existing inbox/state JSONL/JSON files snapshots them and only wakes on subsequent writes.
17. **Forward-compat envelope**: a v1 server returns events with `kind`, `ts`, `data` fields exactly. An agent dispatching only on known `kind` literals continues working when v2 ships new kinds (verified by reading the schema; `additionalProperties: false` is NOT set on the `data` payload to allow internal extensions).
18. **`MCP_STATE_CORRUPT` error**: when a watched state file exists but its JSON is corrupt, the wait surfaces `MCP_STATE_CORRUPT` analogous to `MCP_INBOX_CORRUPT`.
19. **No regression on `inbox_list`**: existing `inbox_list({ waitMs, waitForAny })` tests still pass; the tool's behaviour is byte-identical to today's.
20. **No regression on `inbox_ack`, `state_get`, `state_set`, `state_transition`** — all existing tests green.
21. The shared preamble (preamble-builder.ts + agents/_shared/preamble.md + src/templates/shared-preamble.md) teaches `wait_for_any` with a one-paragraph callout and a 2-example snippet.
22. `AGENTS_README.md` documents `wait_for_any` in one short subsection under coordination, with a worked example showing a mixed-kind wait.
23. The `coordination-smoke-test` agent is extended with a new `wait_for_any` step that exercises a mixed-kind wait, asserts the discriminated-union envelope shape, and includes the result in `toolChecks[]`.
24. `just fft` passes (lint, format, build, typecheck, tests, audit).
25. Domain history rows added to `docs/domains/{mcp,runner}/domain.md` referencing plan 014.

## Risks & Assumptions

- **Settlement-race regressions**: The single-settle contract today is one watch, one timeout. `wait_for_any` is N watches + one timeout. The hand-rolled race must clean up siblings on first wake. **Mitigation**: explicit cleanup-callback array; invariant test asserting all watches are torn down (AC-15).
- **`writeFileAtomicAsync` double-fire**: temp-write + rename produces two mtime ticks; without diff dedup, a single state write fires the watch twice. **Mitigation**: workshop's mtime+parsed-JSON-diff approach; T-test asserts single delivery per logical write.
- **Self-write filter relies on `updatedBy`**: any inside-side writer that forgets to set `updatedBy: 'inside'` causes spurious self-wakes. **Mitigation**: a runner-level invariant test scans existing call sites of `state_set` / `state_transition` and asserts `updatedBy` is always populated; documented in `runner/state.ts` source comment.
- **Unknown-kind rejection breaks forward compatibility for newer agents**: a v2 agent calling a v1 server would get `MCP_INVALID_ARGUMENT`. **Accepted**: agents in this codebase are version-locked to the running minih binary; capability detection is the agent's responsibility. Same trade-off the rest of the MCP surface makes.
- **Test flakiness from real file-watch timing**: cross-platform `fs.watch` semantics differ. **Mitigation**: tests use the existing `FakeNativeWatcher` pattern from `inbox-forwarder.test.ts` rather than real fs.watch; one integration test exercises real fs.watch end-to-end as a smoke check.
- **`MAX_INBOX_WAIT_MS` cap shared with `inbox_list`**: a renamed constant later would touch both call sites. **Accepted**: low-cost rename if needed, single source of truth.
- **Assumption**: workshop O1 (cancellation contract on session-idle) — implementation defaults to silent teardown (matches inbox-poll). If an explicit signal turns out to be needed, easy follow-up.
- **Assumption**: workshop O2 (`oldState` in `state.peer.changed.data`) deferred — defer until a real use case demands it.

## Open Questions

None blocking — workshop resolved 8 of 10 design questions; the 2 OPEN items (O1 cancellation, O2 `oldState`) have leaning answers in the workshop and are non-blocking for v1.

## Clarifications

### Session 2026-04-30

- **Q (testing)**: Lightweight default for CS-2, or TDD specifically for the settlement race?
  **A**: Lightweight (unit + 1 integration). Reuse `FakeNativeWatcher` from `inbox-forwarder.test.ts` for fast deterministic unit tests; one integration test exercises real `fs.watch` end-to-end as a smoke check. Settlement-race correctness covered by AC-3 + AC-4 + AC-15 unit tests, no full RED-GREEN-REFACTOR loop required.
- **Q (scope)**: Keep `state.self.changed` in v1 for symmetry, or drop to v2-if-demand?
  **A**: Keep both. Symmetry pays for itself in the discriminated union (one less special case to document) and the ~30 LOC self-write filter is a one-shot implementation cost.
- **Mode**: Pre-set to Simple in spec header; no Q1 needed.
- **Mock Usage**: Project default — avoid mocks (use `FakeNativeWatcher` + tmpdir fixtures, no SDK or fs mocks).
- **Documentation Strategy**: Hybrid — preamble × 3 + AGENTS_README + smoke-test step (already enumerated in Goals/ACs 21–23).
- **Domain Review**: Confirmed — `mcp` (modify: new tool surface) + `runner` (modify: new event-source primitives + state-watch helper) + `cli` (consume only via dogfood smoke-test agent edits). No new domain. No domain-map change.
- **Harness Readiness**: Existing minih harness (`just fft`) sufficient.
- **Open question O1 (cancellation contract)**: Defer to implementation; default = silent teardown matching `inbox-poll.ts`. Easy to flip later.
- **Open question O2 (`oldState` in `state.peer.changed.data`)**: Deferred. Agents that want a diff keep their own snapshot.
- **`MCP_STATE_CORRUPT` error code**: Keep as new code (matches `MCP_INBOX_CORRUPT` precedent — gives operators a clear distinguishable failure).

## Testing Strategy

**Approach**: Lightweight (per Simple Mode + CS-2 + clarification).

**Rationale**: The settlement-race logic is the trickiest part but is ultimately a small, contained `Promise.race` + cleanup-callback pattern. AC-3 (mixed-kind first-fire), AC-4 (multi-event delivery), and AC-15 (cleanup invariants) cover it via focused unit tests. Going full TDD would slow the build without proportional defect reduction at this scope.

**Focus Areas**:
- Unit tests over `FakeNativeWatcher` (the existing `inbox-forwarder.test.ts` pattern):
  - Mixed-kind wait — first-fire returns immediately
  - Multi-event delivery — debounce window collects multiple events into a single batch
  - Self-write suppression — `state.self.changed` does NOT wake on `updatedBy === 'inside'` writes
  - Clean timeout — `events: []` + `wait.timedOut: true`
  - Cleanup invariant — every registered watch is closed on every settlement path
- Validation tests over the MCP schema:
  - Cap (events.length 9 → error)
  - Required fields (missing `events` / `waitMs` → error)
  - Unknown kind / duplicate kind → error
  - `waitMs` bounds → error
- One integration test using real `fs.watch`:
  - Mixed-kind wait against a tmpdir run folder; outside writes a state file mid-wait; assert the wait wakes with a `state.peer.changed` event.
- No-regression sweep:
  - `inbox_list` tests still pass (AC-19)
  - `inbox_ack`, `state_get`, `state_set`, `state_transition` tests still pass (AC-20)
  - `coordination-smoke-test` runs green with the new step 9 (AC-23)

**Excluded**:
- No e2e companion-orchestrated test (the smoke test agent's new step is sufficient regression coverage).
- No performance tests (no perf-relevant code path).
- No mocks — `FakeNativeWatcher` is a deterministic test seam, not a mock of an external system.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none — workshop 001 is the authoritative design source)_ | — | The event taxonomy, envelope schema, lifecycle, self-write filter, and backward-compat strategy were all locked in `workshops/001-event-taxonomy-and-envelope.md`. No additional workshops needed before architecture. | — |

---

**Next step**: `/plan-2-v2-clarify` for ≤8 high-impact questions (or skip and go straight to `/plan-3-v2-architect` if confident — workshop covers most of the ambiguity).
