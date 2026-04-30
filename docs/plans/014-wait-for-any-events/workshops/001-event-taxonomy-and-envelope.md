# Workshop: `wait_for_any` — Unified Event-Wait Primitive

**Type**: API Contract
**Plan**: 014-wait-for-any-events
**Spec**: _(not yet — workshop runs first to lock the design)_
**Created**: 2026-04-30
**Status**: Draft

**Related Documents**:
- Plan 013 reply chains: `docs/plans/013-message-reply-chains/` — adjacent inbox capability
- Plan 012 peer activity: `docs/plans/012-peer-activity-telemetry/workshops/001-verdict-derivation-rules.md` — same "messenger not police" philosophy
- Plan 010 HF-001: extracted `runner/inbox-poll.ts` — the file-watch primitive we'll lift from

**Domain Context**:
- **Primary Domain**: `mcp` (new tool surface)
- **Related Domains**: `runner` (file-watch primitive, state file readers, inbox readers)
- **Out of scope domain**: `cli` (no outside-side equivalent in v1; outside operators use shells, not MCP)

---

## Purpose

Lock the design of a single MCP tool — `wait_for_any` — that lets coordinated inside agents long-poll for *any combination* of events (inbox messages, state changes, …) in one call, and replaces the current "spin-loop on `state_get`" workaround. This workshop is the authoritative design source for plan 014; the spec and plan derive from it.

## Key Questions Addressed

1. What is the tool's name and shape?
2. What event kinds ship in v1, and what's the extension hook for v2+ (filesystem, tool-completion, timers)?
3. What's the on-the-wire envelope for events, so future kinds slot in without breaking older consumers?
4. How are multi-event waits delivered — first-to-fire or all that fired?
5. How do we suppress self-writes from waking the agent that wrote them?
6. How does this coexist with the existing `inbox_list({ waitMs })` long-poll? Backward compat?
7. What's explicitly **out of v1** so the surface stays small?

---

## Overview

Today, an inside agent can long-poll for **inbox messages** via `inbox_list({ waitMs, waitForAny })`. To wait for **state changes** (e.g., outside operator publishing parameters via `state.data`) the agent has to busy-loop calling `state_get`. The smoke test agent surfaced this as a magicWand:

> *"Add a `waitForAny` + `waitMs` option to `state_get` analogous to `inbox_list` — when the inside agent needs to wait for outside state changes (e.g., outside publishing parameters), there's currently no way to long-poll for state updates without spinning in a loop."* — coordination-smoke-test run `2026-04-29T21-49-26-947Z-9653`

Rather than bolt waitMs onto every getter (state_get, future fs_read, tool-status, …), v1 introduces **one** unified primitive: `wait_for_any`. Agents register N watches in one call; the tool resolves with whatever events fired during the bounded wait window. Future event kinds (filesystem, tool-completion, etc) are added by extending the discriminated union — no new tools, no new wait mechanics.

### Design philosophy (carried from plans 012/013)

- **Messenger, not police.** Agents register watches; minih reports what fired. No matcher DSLs, no validation that the change "matters."
- **KISS.** No filter expressions beyond what each event kind already supports inline.
- **Reuse existing primitives.** `runner/inbox-poll.ts` (filter chain + settlement contract) and `runner/file-watcher.ts` (cross-platform watch wrapper) already do 90% of the work.
- **Backwards compatible.** `inbox_list({ waitMs })` keeps working; `wait_for_any` is purely additive.

---

## Tool Surface

### Name & shape

| Aspect | Decision | Rationale |
|---|---|---|
| Tool name | `wait_for_any` | snake_case verb matches the existing `inbox_list` / `state_get` family. Reads naturally: "wait for any of these to fire." |
| Parameter | `events` (array) | The values are event-kind objects, not strings. Calling the parameter `waitForAny` would clash with `inbox_list`'s string-array `waitForAny` and confuse the schema reader. |
| Parameter | `waitMs` (integer) | Same name + bounds as `inbox_list.waitMs` for consistency. |

### Call shape

```jsonc
{
  "events": [
    { "kind": "inbox.message", "filter": { "types": ["task", "question"] } },
    { "kind": "state.peer.changed" },
    { "kind": "state.self.changed" }
  ],
  "waitMs": 30000
}
```

`events` is **required** and must contain 1–8 entries (cap matches `inbox_list.waitForAny`). `waitMs` is **required** in v1 (unlike `inbox_list.waitMs` which is optional and defaults to immediate-read; here, an immediate-read wait_for_any is meaningless — caller would just call inbox_list / state_get directly).

### Return shape — discriminated union

```jsonc
{
  "events": [
    {
      "kind": "inbox.message",
      "ts": "2026-04-30T08:12:34.567Z",
      "data": {
        "message": {
          "id": "01H...",
          "sender": "outside",
          "type": "task",
          "subject": "...",
          "body": "...",
          "ts": "...",
          "ackOf": null
        }
      }
    },
    {
      "kind": "state.peer.changed",
      "ts": "2026-04-30T08:12:36.123Z",
      "data": {
        "newState": { "status": "in-progress", "data": {...}, "updatedAt": "...", "updatedBy": "outside" }
      }
    }
  ],
  "wait": {
    "requestedMs": 30000,
    "elapsedMs": 1700,
    "timedOut": false,
    "matched": true
  }
}
```

`events: []` (empty array) + `wait.timedOut: true` is the clean timeout shape — no error, no exception, just nothing fired.

### Why an envelope and not raw payloads

Each event arrives wrapped in `{ kind, ts, data }`. This keeps the union extensible and parseable:

- Today: agent dispatches on `kind === 'inbox.message'` vs `'state.peer.changed'`.
- Tomorrow: when `'fs.changed'` and `'tool.completed'` ship, **older agents that only expect today's kinds keep working** — they just dispatch on the kinds they know and treat unknowns as "ignore." No version negotiation needed.
- The `ts` field at the envelope level (separate from any `ts` inside `data`) is the moment minih *delivered* the event to the agent. This matters for ordering when multiple events fire in the same wait window.

---

## Event Kinds (v1)

### `inbox.message`

| Aspect | Spec |
|---|---|
| Trigger | New message appended to peer inbox lane (outside lane for inside agents). |
| Filter | `{ types?: string[] }` — optional list of message types to match (analogous to `inbox_list.waitForAny`). Omit/empty = all types. |
| Self-write filter | Inherently filtered: inside agents only watch the *outside* lane via this kind. |
| Data payload | `{ message: InboxMessage }` — the full message, same shape `inbox_list` returns. |

**Design note**: a single `wait_for_any` call may register `kind: 'inbox.message'` only — it then behaves equivalent to today's `inbox_list({ waitMs, waitForAny })`. We do NOT auto-rewrite `inbox_list`; we let agents migrate at their own pace. (If `inbox_list({ waitMs })` is called, it stays a thin wrapper; see "Backwards compat" below.)

### `state.peer.changed`

| Aspect | Spec |
|---|---|
| Trigger | The peer-side state file (outside.json for inside agents) is touched (mtime changes) AND the parsed JSON differs from the snapshot at wait-entry. |
| Filter | None in v1 (KISS). Agent inspects `data.newState` themselves. |
| Self-write filter | Inherently filtered: inside agents watch *outside.json*, never their own *inside.json*, so no self-write race. |
| Data payload | `{ newState: SideState }` — the parsed peer state at fire time. (`oldState` deferred — agents can keep their own snapshot if they want a diff.) |

**Why mtime + diff and not just mtime**: `writeFileAtomicAsync` (used by `runner/state.ts`) does a temp-write + rename, which can produce two mtime ticks for one logical write. Diffing the parsed JSON against the entry snapshot dedupes this without us having to reason about FS internals.

**Why not deeper change detection**: KISS. If the agent wants to act only on `data.targetBranch` changes, they read `newState` and check themselves. No path-equals matcher.

### `state.self.changed`

Symmetry with `state.peer.changed` — watches the agent's own state file. Rarely useful (the agent generally knows when it wrote its own state) but included for orthogonality and so the event taxonomy is symmetric. Future use case: another component (e.g. the inside MCP server itself) writes inside state and the agent wants to react. For v1, this kind is implemented but not actively recommended in the preamble.

### Out of v1 (extension points, not blockers)

| Kind (future) | Trigger | Why deferred |
|---|---|---|
| `fs.changed` | A path under a configured glob is created/modified/deleted. | User confirmed this comes "later" with agent-config schema additions. Reuse `runner/file-watcher.ts` plus a glob layer. The discriminated-union envelope absorbs it without breaking v1 callers. |
| `tool.completed` | A long-running tool call (bash, fetch, …) finishes. | Different lifecycle — coupled to the SDK adapter, not coordination files. Useful for "wait for two parallel tool calls to both finish" patterns. Defer until usage demands it. |
| `timer.tick` | Wake every N ms regardless of other events. | Replaces the `setInterval` pattern. Marginal value unless paired with `tool.completed`. |
| `run.resumed` | This run was just resumed via `[SYSTEM RESUME]`. | Already surfaced via the resume-prompt envelope itself. Wouldn't add value. |

The contract is: **every future kind ships behind the same `{ kind, ts, data }` envelope**. Agents written against v1 don't break when v2+ kinds appear; they just don't dispatch on the new kinds.

---

## Watch Lifecycle

### Sequence

```
agent → wait_for_any({ events: [...], waitMs: 30000 })
         │
         ▼
       MCP server registers N watches:
         - inbox.message   → file-watch on inbox/outside/messages.ndjson + filter chain
         - state.peer.changed → file-watch on state/outside.json + diff snapshot
         - state.self.changed → file-watch on state/inside.json + diff snapshot
         │
         ▼
       Race three settlement conditions:
         (a) Any watch fires → settle with collected events, current ts
         (b) waitMs elapses  → settle with empty events list, timedOut: true
         (c) Cancel signal   → cleanup all watches; throw MCP_INTERNAL_ERROR
         │
         ▼
       On settle: tear down ALL watches, return result
```

### Single-settle guarantee

Like `inbox-poll.ts` today, the wait resolves **once**. If multiple events fire within a tight window:

- Inbox: fall back to "drain all unread matching messages since wait-entry" (existing primitive)
- State: fall back to "current parsed state at wake time" — no replay of intermediate values
- Combined: collect all events fired between wait-entry and the first wake tick (typically the file-watcher debounce window, ~50ms); settle with them as a batch.

The `events` return list ordering is stable: events are sorted by `ts` (envelope-level delivery timestamp) ascending. Multiple events of the same kind appear in their natural order (inbox = file order, state = single newest snapshot).

### Cleanup invariants

- Every `fs.watch` handle registered by `wait_for_any` MUST be closed before the tool returns, regardless of settlement path.
- A failed event-source registration (e.g., file doesn't exist for `state.peer.changed` because outside hasn't written yet) is NOT an error — the watch fires when the file is *created* and gets a `newState`.
- Cancellation (process shutdown, parent SDK session ending) tears down watches cleanly. Existing `inbox-poll.ts` shutdown contract applies.

### Error shape

| Scenario | Behavior |
|---|---|
| `events` empty / missing | `MCP_INVALID_ARGUMENT` — must register at least one watch |
| `events` length > 8 | `MCP_INVALID_ARGUMENT` — cap matches `inbox_list.waitForAny` |
| Unknown `kind` | `MCP_INVALID_ARGUMENT` — explicit list-of-kinds at request validation |
| Same `kind` registered twice | `MCP_INVALID_ARGUMENT` — disallow duplicates (forces caller to think about merging filters) |
| `waitMs` missing | `MCP_INVALID_ARGUMENT` — required in v1 |
| `waitMs` < 0 or > MAX_INBOX_WAIT_MS (30s) | `MCP_INVALID_ARGUMENT` |
| Inbox lane corrupt | Re-use `MCP_INBOX_CORRUPT` (matches `inbox_list`) |
| State file corrupt | New: `MCP_STATE_CORRUPT` — match the inbox-corrupt pattern |

---

## Self-write filter

### Why it matters

If the inside agent's own write to `inside.json` woke up its own `state.self.changed` watch (or worse, a watch in another wait_for_any call running in parallel), agents would loop endlessly. Same for inbox: if the inside writing to `inside/messages.ndjson` woke an inbox watch, the inbox channel's "agent talks to itself" semantics would break.

### Solution — kind-by-kind

| Kind | Watch target | Why no self-loop |
|---|---|---|
| `inbox.message` | `inbox/outside/messages.ndjson` | Inside agent writes only `inbox/inside/messages.ndjson`. Filtered structurally by file path, not by sender field. |
| `state.peer.changed` | `state/outside.json` | Inside agent writes only `state/inside.json`. Same — structural by path. |
| `state.self.changed` | `state/inside.json` | **Risk**. Inside agent's own `state_set` / `state_transition` call would wake this watch. |

For `state.self.changed`, the implementation captures the path's last-seen mtime *and* the parsed-JSON snapshot at wait-entry. On wake, if the new state's `updatedBy === 'inside'` *and* the new state's `updatedAt` is within the wait window, treat it as a self-write and **suppress the wake** (continue waiting). This handles the "I wrote my own state and woke myself" case without requiring the agent to know about it.

There's one residual case: another inside-side actor (e.g., a coordination forwarder writing inside state on the agent's behalf) could legitimately fire this watch. v1 simply trusts the structural `updatedBy === 'inside'` check; future tooling that writes inside state must set `updatedBy` accurately.

---

## Backward Compatibility

### `inbox_list({ waitMs, waitForAny })` keeps working

| Aspect | Status |
|---|---|
| Tool name | Unchanged. |
| Schema | Unchanged. |
| Behaviour | Unchanged — long-polls inbox lane, returns matching messages. |
| Reads (`inbox_list({ unread: true })` no `waitMs`) | Unchanged — different semantics from any wait, kept as a separate fast path. |

`inbox_list` and `wait_for_any({ events: [{ kind: 'inbox.message' }] })` overlap in capability for the inbox-only case. We don't deprecate `inbox_list` — it's a clean fast-path for the most common case. Internally, both use the same `runner/inbox-poll.ts` primitive.

### Agent migration story

| Want to | Use |
|---|---|
| Read inbox now | `inbox_list` (fast, immediate) |
| Wait for new inbox messages only | `inbox_list({ waitMs, waitForAny })` (familiar, fewer call params) |
| Wait for ANY of inbox + state changes | `wait_for_any` (new) |
| Wait for state changes only | `wait_for_any({ events: [{ kind: 'state.peer.changed' }] })` (new — the magicWand use case) |

---

## Worked Examples

### Example 1: wait for outside parameters via state, then start work

```jsonc
// Agent boots, reads its state, sees no params yet
state_get({ side: 'peer' })
// → { state: { status: 'idle', data: {} } }   // empty data, no params

// Wait for outside to publish params
wait_for_any({
  events: [{ kind: 'state.peer.changed' }],
  waitMs: 30000
})
// → {
//     events: [{
//       kind: 'state.peer.changed',
//       ts: '2026-04-30T08:12:34Z',
//       data: { newState: { status: 'in-progress', data: { targetBranch: 'main' } } }
//     }],
//     wait: { requestedMs: 30000, elapsedMs: 4200, timedOut: false, matched: true }
//   }

// Agent reads data.targetBranch and starts work
```

### Example 2: race inbox vs state

```jsonc
// Agent submitted work; outside might either send an inbox message OR set status=approved
wait_for_any({
  events: [
    { kind: 'inbox.message', filter: { types: ['directive', 'control'] } },
    { kind: 'state.peer.changed' }
  ],
  waitMs: 60000
})
// → first to fire wins; if both fire within ~50ms, both delivered in the events list
```

### Example 3: timeout (clean no-error path)

```jsonc
wait_for_any({
  events: [{ kind: 'inbox.message' }],
  waitMs: 5000
})
// (no inbox messages arrive)
// → {
//     events: [],
//     wait: { requestedMs: 5000, elapsedMs: 5000, timedOut: true, matched: false }
//   }
// Agent sees events.length === 0 + wait.timedOut === true → branches to "fall through"
```

### Example 4: ignored unknown kind (forward compat)

A v2 agent calling against a v1 server:

```jsonc
wait_for_any({
  events: [
    { kind: 'inbox.message' },
    { kind: 'fs.changed', filter: { glob: 'docs/**' } }   // v2 kind
  ],
  waitMs: 30000
})
// → MCP_INVALID_ARGUMENT: "unknown kind 'fs.changed'"
```

Agents are responsible for capability detection. v1 servers reject unknown kinds. Future tools list the kinds they support (we'll add a `wait_for_any` tool description that enumerates supported kinds). This is fine because agents in this codebase are version-locked to the running minih binary.

---

## MCP Tool Schema (sketch)

This is illustrative — the authoritative schema lands in `src/mcp/types.ts` during implementation:

```typescript
{
  name: 'wait_for_any',
  description: 'Long-poll for any of N event kinds (inbox messages, state changes, ...) with a single call. Returns all events fired during the wait, or empty + timedOut.',
  inputSchema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['inbox.message', 'state.peer.changed', 'state.self.changed'],
            },
            filter: { type: 'object', additionalProperties: true },
          },
          required: ['kind'],
          additionalProperties: false,
        },
      },
      waitMs: {
        type: 'integer',
        minimum: 0,
        maximum: MAX_INBOX_WAIT_MS,  // 30_000
      },
    },
    required: ['events', 'waitMs'],
    additionalProperties: false,
  },
}
```

Output schema mirrors the discriminated-union envelope above; AJV validates each event entry against its kind-specific shape.

---

## TypeScript Types (sketch)

```typescript
// New public type — added to runner/types.ts (not mcp/types.ts) so it can be
// reused by future plan that adds the matching outside-side equivalent (if any).

export type EventKind =
  | 'inbox.message'
  | 'state.peer.changed'
  | 'state.self.changed';
  // | 'fs.changed'        // v2
  // | 'tool.completed'    // v2

export type WatchEntry =
  | { kind: 'inbox.message'; filter?: { types?: string[] } }
  | { kind: 'state.peer.changed' }
  | { kind: 'state.self.changed' };

export type EventEnvelope =
  | { kind: 'inbox.message'; ts: string; data: { message: InboxMessage } }
  | { kind: 'state.peer.changed'; ts: string; data: { newState: SideState } }
  | { kind: 'state.self.changed'; ts: string; data: { newState: SideState } };

export interface WaitForAnyResult {
  events: EventEnvelope[];
  wait: {
    requestedMs: number;
    elapsedMs: number;
    timedOut: boolean;
    matched: boolean;
  };
}
```

The discriminated union via the literal `kind` field gives agents (and TypeScript code in tests) full type narrowing for free.

---

## Decision Log

### Q1 — RESOLVED: Tool name `wait_for_any` (not `events_wait`, not `wait`)

`wait_for_any` reads as a clear verb phrase and mirrors the user's mental model ("wait until any of these things happens"). `wait` is too generic. `events_wait` doesn't read naturally — sounds like a noun-phrase getter.

### Q2 — RESOLVED: Single tool, not per-source extension

Considered: extend `state_get` with `waitMs`/`waitForChange`, leaving `inbox_list` as is. Rejected because it doesn't compose — agents that want "inbox OR state" still spin-loop. The unified primitive composes once, scales to future kinds.

### Q3 — RESOLVED: Discriminated-union envelope with `kind` literal

Considered: omit `kind`, return raw payloads with sibling fields like `message?` / `newState?`. Rejected because TypeScript narrowing breaks down and forward compat is harder.

### Q4 — RESOLVED: Multi-event delivery, not first-to-fire

If watch A and watch B both fire within the file-watcher debounce window, return both. Returning only "first" is a lie when concurrent events are temporally indistinguishable, and it forces the agent to immediately re-call `wait_for_any` to drain the rest. Multi-delivery matches the `inbox_list` precedent (which already returns multiple matching messages from a single drain).

### Q5 — RESOLVED: Kept `inbox_list({ waitMs })` semantics

Different read semantics (one-shot drain of inbox lane vs multi-source wait). Don't deprecate. Internally both use the same `pollInboxLane` primitive.

### Q6 — RESOLVED: `state.self.changed` included for symmetry but not recommended

Implementing it costs almost nothing (the file-watch primitive is already there). Not recommending it in the preamble keeps agent guidance simple. Useful escape hatch for niche uses (e.g., side-channel writers).

### Q7 — RESOLVED: `events` cap = 8

Matches `inbox_list.waitForAny` cap. Plenty for v1 (3 kinds today, room for fs/tool/timer/etc later without breaking the cap). Easier to relax than to tighten.

### Q8 — RESOLVED: No matcher DSL (KISS)

User confirmed: "no matchers just KISS all the way with minih." Agents can read `data` and verify in their own logic. If a pattern emerges where 80% of agents need the same filter, we add it then.

### Q9 — DEFERRED: Resource caps (concurrent watches per session, per-process file-handle budget)

Workshop-out-of-scope per user. Defer to plan-3 if a quick guard is needed; otherwise revisit when load demands it.

### Q10 — DEFERRED: Outside-side `wait_for_any` equivalent

The CLI doesn't have an inside-MCP equivalent. Outside operators are humans + shells. If we ever want a `minih outside wait` command, design it then. Out of scope for plan 014.

---

## Open Questions

### O1 — OPEN: Cancellation contract on session-idle termination

If the SDK session goes idle while `wait_for_any` is mid-flight, does the wait need to surface a partial result or just be torn down silently? **Probably silent teardown** matches inbox-poll's behavior, but worth confirming during implementation. Not blocking — pick the simpler path.

### O2 — OPEN: Should `state.peer.changed` data include `oldState`?

Pro: agent can compute the diff client-side without keeping its own snapshot.
Con: more bytes per event; agents that don't need it pay the cost.

**Lean**: defer. `data.newState` only in v1. Agents that need a diff keep their own snapshot. Re-evaluate if usage shows the friction.

---

## Implementation Reuse Map

| Need | Existing primitive |
|---|---|
| File-watch with debounce | `runner/file-watcher.ts` |
| Inbox tail + filter chain + settlement | `runner/inbox-poll.ts` (`pollInboxLane`) |
| State JSON read + parse | `runner/state.ts` (existing internal helpers) |
| MCP error code mapping | `mcp/types.ts` (`McpToolError`) |
| Atomic file write detection (mtime + diff) | new — small helper, ~20 LOC |
| Settlement race (N watches + waitMs timeout) | new — small helper using `Promise.race` + cleanup callback array |

Estimated implementation surface: ~250 LOC new code + 1 new tool registration in `mcp/server.ts` + ~150 LOC new tests.

---

## Quick Reference (cheat sheet for plan-3)

```typescript
// Inside agent: wait for outside to publish params via state
wait_for_any({
  events: [{ kind: 'state.peer.changed' }],
  waitMs: 30000
})

// Inside agent: race inbox question vs state-flip approval
wait_for_any({
  events: [
    { kind: 'inbox.message', filter: { types: ['directive'] } },
    { kind: 'state.peer.changed' }
  ],
  waitMs: 60000
})

// Inside agent: forward-compatible call (v2 kinds rejected as MCP_INVALID_ARGUMENT in v1)
wait_for_any({
  events: [{ kind: 'inbox.message' }],
  waitMs: 30000
})
```

**Return shape** (discriminated by `kind`):

```typescript
{
  events: Array<
    | { kind: 'inbox.message'; ts: string; data: { message: InboxMessage } }
    | { kind: 'state.peer.changed'; ts: string; data: { newState: SideState } }
    | { kind: 'state.self.changed'; ts: string; data: { newState: SideState } }
  >,
  wait: {
    requestedMs: number;
    elapsedMs: number;
    timedOut: boolean;
    matched: boolean;
  }
}
```

**Error codes**: `MCP_INVALID_ARGUMENT`, `MCP_INBOX_CORRUPT`, `MCP_STATE_CORRUPT` (new), `MCP_INTERNAL_ERROR`.

---

**Status**: Draft, ready for review. Once approved → `/plan-1b-v2-specify` to derive the spec and ACs from this design.
