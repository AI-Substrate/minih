# Fix FX007: `wait_for_any` returns pre-existing unread inbox messages

**Created**: 2026-05-02
**Status**: Proposed
**Plan**: [Companion Experience](../companion-experience-plan.md)
**Source**: Workshop 002 § 3.3 (MW6) + live demo evidence (`agents/demo-companion/runs/2026-05-01T17-43-12-943Z-0eee/`) + companion's own farewell magicWand (run `2026-05-01T17-43-12-943Z-0eee` retro)
**Domain(s)**: `runner` (primary — `src/runner/event-wait.ts:waitForAny`); `runner` types (`WaitForAnyResult.wait.matched` enum widening)

---

## Problem

When a coordinated agent calls `wait_for_any({events: [{kind: 'inbox.message', filter: ...}]})` and the peer lane already contains unread messages matching the filter, the wait returns nothing. Pre-existing entries are not delivered; only events that ARRIVE during the wait window are emitted.

The full demo verification run (`2026-05-01T17-43-12-943Z-0eee`) hit this twice:

1. TASK1 (`Round 1: rounded borders`, id `01KQH80V46R1EQWEEB9ZR1Z0SQ`) was sent at `T07:46:00Z`. The companion was idle-budget'd between polls (last `wait_for_any` returned `timedOut: true` ~30s earlier). TASK1 sat unread.
2. A diagnostic "test" message at `T07:48:05Z` woke the next `wait_for_any`. The wake event included only "test" — TASK1 stayed orphaned.
3. The companion only picked TASK1 up at the pre-farewell drain check (calling `inbox_list({unread: true})` directly), 9 minutes after delivery.

The companion's own farewell magicWand independently flagged the same bug:
> *"Add a wait_for_any diagnostic mode or returned high-water mark that shows when matching inbox messages are skipped or already pending, so companions can detect delivery/order drift before the final unresolved-request check."*

**Why it happens** (`src/runner/event-wait.ts:78` + `:181-211`):

```ts
// Wait-entry snapshot — every existing inbox id is recorded as "already seen"
const inboxIdSnapshot = snapshotInboxIds(opts);

// ... later, in the inbox.message watcher's read loop:
for (const m of messages) {
  if (snapshots.inboxIdSnapshot.has(m.id)) continue;  // ← suppresses pre-existing
  // ...
}
```

The snapshot is intentional — it prevents replaying the same message every time the file's mtime ticks. But the snapshot logic has no concept of "pre-existing AND unread"; it treats "present at wait-entry" as "should be ignored", regardless of whether the agent has acked it.

This is asymmetric with `pollInboxLane` (the CLI/MCP `inbox_list --wait`), which DOES return pre-existing matches immediately and only waits if the lane is empty after filters apply. That asymmetry is the root cause: agents using `wait_for_any` get different semantics than agents using `inbox_list({waitMs: ...})` for the same logical "wait for the next inbox message" operation.

## Proposed Fix

Add a **pre-existing pre-render pass** before arming the watchers. When `wait_for_any` is called:

1. Compute the inbox-id snapshot (as today).
2. **NEW**: Read the peer inbox lane and emit, immediately, any unread messages matching the filter — `unread` here means "id not present in the same side's outgoing lane as a `type='ack'` with `ackOf` referencing it". Same definition `pollInboxLane`'s `unread` filter uses (`runner/inbox-poll.ts:144-148`).
3. If pre-existing matches were emitted, settle the wait with `matched: 'pre-existing'` (see § Contract changes below) — no watchers armed, no timer.
4. If no pre-existing matches, proceed with the existing watcher path; settle with `matched: 'live'` on first new event.
5. State events (`state.peer.changed` / `state.self.changed`) are **not** in scope — those don't have an "unread" concept. The pre-render pass only applies to `inbox.message` entries.

### Contract changes (`WaitForAnyResult.wait.matched`)

Today: `matched: boolean` (`true` if any event fired, `false` on clean timeout).

Post-fix: `matched: 'pre-existing' | 'live' | 'mixed' | 'timeout'`.

- **`pre-existing`** — at least one event in the result was a pre-render of an unread message that existed at wait-entry; no watcher fires occurred.
- **`live`** — all events arrived during the wait window via watchers (today's behaviour).
- **`mixed`** — both (theoretically possible if pre-render emits AND a watcher fires before settlement; in practice exclusive because pre-render settles synchronously before watchers arm — but reserved for future-proofing).
- **`timeout`** — clean timeout, no events.

**Backward compatibility**: existing callers checking `matched === true` see `'pre-existing' | 'live' | 'mixed'` as truthy strings. Callers checking `matched === false` see `'timeout'` as truthy too — that's a **breaking change** for tests that assert `matched === false` on timeout. We need to migrate those tests in this same fix.

A separate `timedOut: boolean` field already exists on `wait` and stays the canonical "did we time out" signal. Tests should be migrated from `matched === false` to `timedOut === true`.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `runner` | Primary | `event-wait.ts:waitForAny` adds pre-render pass for `inbox.message` entries; `WaitForAnyResult.wait.matched` widens to enum; tests migrated to assert `timedOut` instead of `matched === false` |
| `runner` types (`types.ts`) | Primary | `WaitForAnyResult.wait.matched` type widens from `boolean` to `'pre-existing' \| 'live' \| 'mixed' \| 'timeout'` |
| `mcp` | Tangential | Pure passthrough (the MCP wait tool returns whatever the runner returns). Tool-result schema doesn't constrain `matched` so no MCP-side change needed. Verify in `src/mcp/tools/wait.ts`. |
| `cli` | Tangential | One known consumer (`src/cli/commands/outside.ts:678`) reads `wait.matched`; verify the read still works under the new shape. |

**Risk**: Type-level breaking change (`boolean → enum`). The migration is mechanical (8 test assertions per the grep) and the fix doc lists every site. No external consumers (this isn't a public npm API — internal to minih).

**Cross-workshop coupling**: Workshop 003 § 5 introduces `outside send-and-wait` whose result envelope mirrors this `matched` enum. Both fixes use the SAME enum; landing this one first locks the canonical shape.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX007-1 | Widen `WaitForAnyResult.wait.matched` from `boolean` to `'pre-existing' \| 'live' \| 'mixed' \| 'timeout'` in the runner type definition. Add JSDoc explaining each value. | runner | `src/runner/types.ts` (line ~561) | Type compiles; existing producers report TS errors at the literal `true`/`false` sites that must be touched | This intentionally creates compile errors that guide FX007-2 |
| [ ] | FX007-2 | Update `waitForAny` to emit the new enum at all three settlement paths (`completeWith(matched=true)` becomes `completeWith('live')`; `completeWith(matched=false)` becomes `completeWith('timeout')`). Refactor `completeWith` to accept the union directly rather than translating. Existing logic UNCHANGED otherwise — this task is purely the type widening. | runner | `src/runner/event-wait.ts` (lines 109-124) | All event-wait tests still pass after migrating their `matched` assertions in FX007-3 | Pure type refactor; no behavioural change yet |
| [ ] | FX007-3 | Migrate test assertions: `matched === true` → `matched === 'live'`; `matched === false` → `matched === 'timeout'`. Sites (per pre-flight grep): `test/runner/wait-for-any-fs.test.ts:94,120`; `test/runner/event-wait.test.ts:177,268`. Also check `test/runner/inbox-poll.test.ts` (likely OK — `pollInboxLane`'s matched field is separate, but verify) and `test/cli/outside-inbox-wait.test.ts` (verify it's testing `pollInboxLane` not `waitForAny`). | runner | `test/runner/wait-for-any-fs.test.ts`, `test/runner/event-wait.test.ts`, plus verification of inbox-poll + outside-inbox-wait tests | All affected tests reference the new enum values; full test suite still passes | Mechanical migration; do this BEFORE FX007-4 so the new behaviour-test in FX007-4 has the right assertion shape |
| [ ] | FX007-4 | Implement the pre-render pass in `waitForAny`: BEFORE calling `registerWatch` for any `inbox.message` entries, read the peer lane and emit unread + filter-matching messages. Use the existing `unread` semantics from `pollInboxLane` (id not present in self-lane as a `type='ack'`'s `ackOf`). If at least one pre-existing matches: emit immediately, settle with `matched: 'pre-existing'`, do not arm watchers. State entries (`state.peer.changed` / `state.self.changed`) skip the pre-render pass entirely. | runner | `src/runner/event-wait.ts` (insert between line 80 (snapshot) and line 82 (Promise body)) | A new test: send an inbox message, wait, call `waitForAny` AFTER → returns the message immediately with `matched: 'pre-existing'` and `elapsedMs < 50` | Reuse `readLaneSafe` already in event-wait.ts; reuse the unread-set computation from inbox-poll.ts:144-148 (factor into shared helper or inline-with-comment) |
| [ ] | FX007-5 | Add three regression tests to `test/runner/event-wait.test.ts`: (a) pre-existing unread message matching filter is delivered immediately with `matched: 'pre-existing'` and no watcher activity; (b) pre-existing message that's already acked (its `ackOf` recorded in self lane) is NOT delivered; (c) when only state entries are watched (no `inbox.message`), no pre-render runs even if the inbox has unread messages. | runner | `test/runner/event-wait.test.ts` | All three tests pass; existing tests still pass | Use the existing fixture setup pattern in this file |
| [ ] | FX007-6 | Reverify the original failure-reproducing scenario: send a `task` message to a coordinated agent that's NOT currently in `wait_for_any`; have the agent then enter `wait_for_any` AFTER the message lands. The wait must return immediately with the message. Capture as a one-line note in the execution log; no automated test needed (covered by FX007-5 (a)). | runner | (verification only) | Behaviour matches expected: pre-existing message is delivered immediately | Closes the loop with the original demo evidence |
| [ ] | FX007-7 | Verify the MCP-side wait tool (`src/mcp/tools/wait.ts`) returns the new `matched` value through to its consumers without filtering or translation. The MCP tool result schema is loose (per the gpt-5.4+ schema constraint memory — no enum); just confirm no transform throws away the new string. | mcp | `src/mcp/tools/wait.ts`, `test/runner/event-wait.test.ts` (or new MCP-level test if tools/wait.ts has gaps) | MCP tool test (or fresh run via `agents/coordination-smoke-test`) returns a `matched: 'pre-existing'` string visible to the calling agent | Per memory: avoid `enum`/`oneOf` in MCP `inputSchema`; tool-result schema isn't validated post-CAPI so `matched` as a free string is fine |
| [ ] | FX007-8 | Update workshop 002 § 3.3 to reflect "DONE" status with a backreference to this fix dossier. Add a row in workshop 002's discoveries table noting the migration touched 4+ test sites — small but worth flagging for any future widening of the enum. | docs | `docs/plans/016-a2a-companion-protocol/workshops/002-lane-derived-farewell-helpers.md` | Workshop §3.3 marked DONE; cross-link to `fixes/FX007-...md` | Docs-only; no code |

## Workshops Consumed

- **Workshop 002 § 3.3** — designed the pre-render fix and the `matched` enum widening
- **Workshop 003 § 5.4** — the `matched: 'pre-existing' | 'live' | 'mixed' | 'timeout'` enum is the same shape `outside send-and-wait` will adopt; landing this one first locks it

## Acceptance

- [ ] `WaitForAnyResult.wait.matched` is a union of four string literals; no `boolean` left.
- [ ] An agent calling `wait_for_any` with a pre-existing unread inbox message in the peer lane receives that message immediately (`elapsedMs < 50`, `matched: 'pre-existing'`).
- [ ] An already-acked pre-existing message is NOT delivered (verified by FX007-5(b)).
- [ ] State-only `wait_for_any` calls have unchanged semantics — no pre-render, watcher-only.
- [ ] All existing `event-wait` and `wait-for-any-fs` tests pass after FX007-3's migration.
- [ ] MCP `wait_for_any` tool result envelope passes `matched` through verbatim.
- [ ] `just fft` clean.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
