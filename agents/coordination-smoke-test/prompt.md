---
description: "Dogfood the outside/inside coordination loop with inbox, state, and retrospective evidence"
tags: [smoke, coordination, mcp]
coordination: enabled
permissions: restricted
---

# Coordination Smoke Test

## Objective

Verify that a coordinated minih agent can see outside peer context, use all inside MCP coordination tools, publish state, and produce a validating report. **Verify by reading the artifacts back from disk after each tool call** — a tool that returns OK but failed to write its artifact is a HARD FAIL, not a pass.

## Required coordination exercise — VERIFY DON'T JUST CALL

For every tool call below, after calling the tool you MUST read back the artifact the tool was supposed to produce and quote a snippet into `toolChecks[].evidence`. If the artifact is missing, mismatched, or empty, record `status: 'fail'` and add a `retrospective.confusing` note. The smoke must light up like a Christmas tree when contracts break.

Helpful environment vars (always set when this agent runs):
- `$MINIH_RUN_DIR` — your run folder
- `$MINIH_INBOX_DIR` = `$MINIH_RUN_DIR/inbox`
- `$MINIH_STATE_DIR` = `$MINIH_RUN_DIR/state`

### 1. `inbox_list` (outside lane)

- Call `inbox_list` with `unread: true` to inspect outside peer messages.
- After the call: `cat $MINIH_INBOX_DIR/outside/messages.ndjson` (if it exists). Compare the message count and message ids returned by the tool against the file. They MUST match.
- `evidence`: quote the file path AND a snippet of the first message line (or "outside lane file does not exist — empty inbox" if applicable).

### 2. `inbox_send` (with `ackOf` if there was an outside message)

- Call `inbox_send` to reply with progress evidence. If step 1 surfaced an outside message id, **set `ackOf` to that id** (this is now a first-class parameter on the MCP tool surface as of FX001).
- After the call: `cat $MINIH_INBOX_DIR/inside/messages.ndjson | tail -1` (read the line you just wrote).
- Verify the line contains your `subject`, `body`, `type`, AND (when set) `ackOf`. If `ackOf` was passed but is missing from the persisted line, that is a HARD FAIL.
- `evidence`: quote the persisted JSON line.

### 3. `inbox_ack` (only if step 1 surfaced an outside message)

- Call `inbox_ack` with the outside message id.
- After the call: re-read `$MINIH_INBOX_DIR/inside/messages.ndjson | tail -1` and confirm an `ack` message with `ackOf` equal to the acked id is now present.
- `evidence`: quote the persisted ack line.

### 4. `state_get` with `side: "both"`

- Call `state_get` with `side: 'both'` to inspect inside and outside state.
- After the call: list `$MINIH_STATE_DIR` and confirm what files exist (`inside.json`, `outside.json`).
- `evidence`: quote the directory listing AND the parsed state objects (or note "synthetic defaults — no state files yet" if both are absent).

### 5. `state_set` to publish an inside status (e.g. `reviewing`)

- Call `state_set` with `status: 'reviewing'`.
- After the call: `cat $MINIH_STATE_DIR/inside.json`. The file MUST exist and `status` MUST equal `reviewing`. If the file is missing, that is a HARD FAIL — the inside-state schema may be misconfigured (FX001-2 fixed the lookup; if you hit this, file a follow-up).
- `evidence`: quote the persisted `inside.json` content.

### 6. `state_transition` to a final status (e.g. `complete`)

- Call `state_transition` with `to: 'complete'`.
- After the call: `cat $MINIH_STATE_DIR/inside.json` AND `cat $MINIH_STATE_DIR/history.ndjson | tail -1`. The state MUST equal `complete` and the history line MUST record the transition `from: 'reviewing'` `to: 'complete'`.
- `evidence`: quote both the new `inside.json` and the new history line.

### 7. Final summary `inbox_send`

- Send a final `inbox_send` of type `summary` summarizing what you verified, with `ackOf` set to the original outside message id if there was one.
- After the call: read back `$MINIH_INBOX_DIR/inside/messages.ndjson | tail -1` and quote it.

### 8. Reply chain verification (plan 013)

This step exercises the **reply chain** capability shipped in plan 013: any inbox message can carry `ackOf` regardless of its `type`, and the outside CLI accepts `--ack-of` for any `--type` (not just `ack`). It is what makes multi-turn back-and-forth chains work.

After sending your step 2 reply (which set `ackOf` on a NON-ack `inbox_send`), wait for the outside operator to send a follow-up reply that targets your step 2 message:

- Call `inbox_list` with `waitMs: 30000` and `waitForAny: ['note','task','question','directive']` to wait up to 30 seconds for a non-ack outside follow-up.
- When a message arrives, verify two properties on the received message:
  1. `type` is NOT `'ack'` (this is a real reply, not an acknowledgement)
  2. `ackOf` is set AND equals the id of YOUR step 2 reply (proving the outside-side `--ack-of` flag worked end-to-end)
- After verification, send a **chain reply** via `inbox_send` with:
  - `type: 'note'` (or 'progress'; do NOT use 'ack')
  - `ackOf` set to the id of the message you just received in this step (NOT your earlier step 2 id)
- Read back `$MINIH_INBOX_DIR/inside/messages.ndjson | tail -1` and confirm the chain-link message persisted with the correct `ackOf`.
- `evidence`: quote (a) the received outside follow-up's full JSON line, and (b) your chain-link reply's full JSON line. The receive-line's `ackOf` MUST equal your step 2 id, and the chain-link's `ackOf` MUST equal the receive-line's `id`.

If no outside follow-up arrives within the wait window, mark this step `status: 'skip'` with reason "outside operator did not send a follow-up reply within 30s" — the operator may simply have decided not to test reply chains. Do NOT mark `'fail'` for skip-by-omission.

### 9. `wait_for_any` mixed-kind verification (plan 014)

This step exercises the **unified event-wait** primitive shipped in plan 014: a single MCP call that wakes on any combination of inbox messages and state changes, replacing the spin-loop-on-`state_get` pattern.

- Call `wait_for_any` with TWO watch entries — `{ kind: 'inbox.message' }` AND `{ kind: 'state.peer.changed' }` — and `waitMs: 30000`. The outside operator's runbook (see `outside.md`) tells them to fire a `state.peer.changed` wake by writing to outside state shortly after you complete step 8.
- When the call resolves, verify the returned envelope shape:
  1. Top-level fields: `events` (array) and `wait` (object with `requestedMs`, `elapsedMs`, `timedOut`, `matched`).
  2. If `events.length > 0`: each entry is `{ kind, ts, data }`; `kind` is one of `inbox.message` or `state.peer.changed`; `ts` is an ISO-8601 string; `data` shape matches the kind (`{ message: {...} }` for inbox.message, `{ newState: {...} }` for state.peer.changed).
  3. If `events.length === 0` and `wait.timedOut === true`: that's the clean-timeout shape — the operator chose not to fire a wake. Record this as `pass` with evidence noting the no-fire path was exercised.
- Set `tool: 'wait_for_any'` in your `toolChecks[]` entry — that exact verb is in the schema enum. Do NOT use `event_wait` or any variation.
- `evidence` MUST quote, at minimum:
  1. The literal JSON keys present at the top level (e.g., `"events":[...], "wait":{...}`).
  2. The `wait.timedOut` and `wait.matched` boolean values.
  3. If `events.length > 0`: the `kind` literal of the first event AND the JSON keys present inside its `data` payload (proves discriminated-union shape).
  4. If `events.length === 0`: the `wait.elapsedMs` value (proves the wait actually ran the full duration).

  Hand-wavy evidence ("got an envelope back, looks fine") is a contract violation — quote actual JSON.

If the call THROWS or returns a malformed envelope (missing `events`/`wait` keys, non-array `events`, etc.), that is a HARD FAIL — record `status: 'fail'` and quote the actual response.

If no outside message exists at step 1, still exercise the state and inbox-send tools and clearly mark the inbox-related steps as `status: 'skip'` with an explanation.

## Report

Write a JSON report to `$MINIH_OUTPUT_PATH` with:

- `summary` — what you verified, in plain prose.
- `toolChecks[]` — one entry per tool exercised, with `tool`, `status`, AND `evidence` quoting the artifact contents you read back.
- `artifacts` — top-level object asserting which observable artifacts existed at session end:
  - `stateFile: boolean` — true if `$MINIH_STATE_DIR/inside.json` exists.
  - `historyFile: boolean` — true if `$MINIH_STATE_DIR/history.ndjson` exists.
  - `inboxInsideFile: boolean` — true if `$MINIH_INBOX_DIR/inside/messages.ndjson` exists.
- `verdict` — `all-pass` only if EVERY tool check is `pass` AND every artifact flag is `true`. Otherwise `partial` or `fail`.
- `retrospective` — include `magicWandTarget: "coordination"` when your feedback targets the outside/inside loop.

