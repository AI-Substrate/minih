# Empirical Test: Mid-Turn `session.send` Injection in @github/copilot-sdk

**Test date**: 2026-04-26
**SDK version**: whatever's at `/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/` (matches minih's peer-dep `>=0.1.32`)
**Test script**: `scratch/midturn-test/test.mjs`
**Outcome**: ✅ Mid-turn injection works cleanly via a documented queue model.

---

## TL;DR

| Behavior | Answer |
|----------|--------|
| `session.send()` while a prior `sendAndWait()` is in flight | **Queues**. Doesn't throw, doesn't abort current turn, doesn't merge into current turn. |
| Each queued message | Gets its OWN turn with its OWN assistant response — distinct `assistant.turn_start`/`turn_end` events. |
| Each `send()` call | Returns a unique `messageId` (server-assigned UUID). |
| Queue observability | The SDK emits `pending_messages.modified` events whenever the queue grows or shrinks. Can be subscribed via `session.on()`. |
| `sendAndWait()` semantics with a queue behind it | **Footgun**. `sendAndWait` waits for `session.idle`, which fires only after the queue fully drains. The returned `AssistantMessageEvent` is the LAST assistant message before idle — i.e., the response to the LAST queued message, not the one you just sent. |
| Mid-turn cancellation | Not via `send`. Existing `session.abort()` is the cancel path. |
| Merging | Two back-to-back `send()`s do NOT merge into one turn; they produce two distinct turns. |

**Net implication for plan 007**: we can deliver outside notes into a running inside session with **2–5 second latency** (next turn boundary), not just at minih-resume invocations. Workshop 007's queue-and-deliver design upgrades from "delivered when the user types `minih resume`" to "delivered as soon as the current turn ends" — much tighter feedback loop.

---

## Methodology

Three scenarios run against a real GH_TOKEN-authed CopilotClient + freshly-created session. Each scenario exercises `session.send` and observes the resulting event stream.

### Scenario A — sequential baseline

Two `sendAndWait` calls, awaited sequentially. Confirms the basic flow.

```js
await session.sendAndWait({ prompt: 'Say hello briefly.' });
await session.sendAndWait({ prompt: 'Say goodbye briefly.' });
```

**Result**: ✅ Worked exactly as expected. Two `assistant.turn_start`/`turn_end` cycles, each ending with `session.idle`. Total: 57 events.

### Scenario B — mid-turn inject

`sendAndWait` for a slow operation (5 sequential bash sleeps); 3 seconds later, `session.send` injects an additional prompt while the slow operation is still running.

```js
const slowPromise = session.sendAndWait({ prompt: SLOW_PROMPT }, 60000);
await sleep(3000);
const injectId = await session.send({ prompt: 'IMPORTANT: also include the word PINEAPPLE somewhere in your final summary.' });
const slowResult = await slowPromise;
```

**Result**: ✅ Mid-turn `session.send` returned a `messageId` cleanly. The slow loop completed normally (5 ticks, all bash tool calls executed). Then a SECOND turn started — the agent received the inject prompt and responded:

> "The 5 sequential ticks were already completed in the previous turn. There's nothing left to summarize, but sure — PINEAPPLE. 🍍"

The `slowPromise` resolved with THAT second turn's message (not the slow loop's own response). 505 events total.

**Key observations from event stream**:
- After `session.send`: `pending_messages.modified` fires (queue grew).
- The slow loop's `assistant.turn_end` fires.
- Immediately after: a NEW `user.message` (the inject) → `assistant.turn_start` → ... → `assistant.message` → `assistant.turn_end`.
- THEN `session.idle`.
- `sendAndWait`'s internal idle-wait resolves at this point — returning the LAST `assistant.message` event seen (the inject's response, NOT the slow loop's).

### Scenario C — rapid-fire two sends, no await

Both `session.send` calls fired without awaiting either; then collected both messageIds.

```js
const id1Promise = session.send({ prompt: 'Step A: respond with the word ALPHA' });
const id2Promise = session.send({ prompt: 'Step B: respond with the word BETA' });
const [id1, id2] = await Promise.all([id1Promise, id2Promise]);
```

**Result**: ✅ Both sends returned distinct messageIds (`id1 = "4f3bf468-..."`, `id2 = "11b2eac2-..."`, `sameId === false`). Three `pending_messages.modified` events in rapid succession.

Then the session processed them as **two separate turns**:
- Turn 1: `user.message` → `assistant.turn_start` → `assistant.message: "ALPHA"` → `assistant.turn_end`
- (queue drains by one): `pending_messages.modified` event
- Turn 2: `user.message` → `assistant.turn_start` → `assistant.message: "BETA"` → `assistant.turn_end`

NO merging of A and B into one prompt. NO race condition observed. Each message was processed in submission order.

---

## What This Means for Plan 007

### Workshop 007's "queue-and-deliver" mechanism — UPGRADED

Original design (workshop 007 v1):
> The pre-turn delivery hook fires in `minih resume <slug>` — outside notes get inlined into the next user-triggered turn.

**Upgraded design** (after empirical findings):
> If the inside session is currently alive (has a live `CopilotClient` + un-disconnected `session`), `minih outside-send` can ALSO directly inject the new note via `session.send(inlinedNote)`. The inject queues at the SDK level and is processed in a new turn ~2-5 seconds after the current turn completes. **No coder-typed `minih resume` needed in the alive-session case.**

This dramatically changes the v1 UX:
- **v1 (alive session)**: outside-send → message reaches the agent within ~5s, automatically.
- **v1 (dead session, between runs)**: outside-send queues; on next `minih resume`, pre-turn hook delivers.
- **v2 (daemon)**: same alive-session path; daemon owns the lifecycle and may file-watch on top.

### Architectural delta from the original design

A new `RunningSessionRegistry` is needed: track *currently-alive* sessions per agent slug, so `minih outside-send` knows whether to (a) inject directly into a live session, or (b) only enqueue for next resume.

Sketch:

```ts
// Per-process registry of alive client+session (in the long-running process that holds them)
interface RunningSessionEntry {
  slug: string;
  runId: string;
  client: ICopilotClient;
  session: ICopilotSession;
  startedAt: string;
}

// In v1: a single `minih run <slug>` owns one entry; on disconnect, entry is removed.
// In v2: the daemon owns N entries (one per backgrounded agent).
```

For v1, the registry is in-process and ephemeral. Once `minih run` exits, it's gone. Outside-send then falls back to enqueue-only.

A NEW process (the second `minih outside-send` invocation in another terminal) doesn't have access to the in-process registry of the first `minih run`. Two options:

1. **`outside-send` always enqueues; resume processes the queue.** Simpler. Lower-fidelity v1: no near-real-time delivery within a single `minih run`.
2. **`outside-send` checks for an alive process via pidfile / IPC socket; if alive, delivers via socket; if not, enqueues.** Higher fidelity but requires daemon-like plumbing in v1.

Recommendation for v1: option 1. Real-time delivery is a v2/daemon feature. v1 stays "enqueue + deliver on next resume." But document that the SDK supports the alive-session path so v2 can implement it without architectural changes.

### `sendAndWait` footgun — must document for v2

If v2's daemon uses `sendAndWait` AND ALSO does `session.send` from the file-watcher callback, the daemon's await will block until the queue drains. For long-running scenarios this could mean `sendAndWait` never returns (every time it would resolve, a new file change adds to the queue).

**v2 should NOT use `sendAndWait`**. It should use `session.send` (no await) + subscribe to `assistant.turn_end` + `session.idle` events to manage its own state. Let the SDK's event stream drive the logic.

### `pending_messages.modified` is a UX surface

minih can observe queue depth in real time. CLI command idea:
```
$ minih outside-pending code-reviewer
{ "queueDepth": 2, "messages": [...], "estimatedDeliveryAt": "next turn end" }
```
Surfaces "your note is queued; agent will see it in ~3s" feedback.

### Cancellation / abort

If the user wants to cancel a pending message after sending, `session.abort()` is the SDK's only documented path. It aborts the currently-processing message; queued ones presumably continue (UNTESTED). Worth a follow-up scenario D test if v2 needs cancel semantics.

---

## Other SDK-Internal Findings (incidental)

The event stream contains rich types we hadn't catalogued:

| Event type | When fired |
|------------|-----------|
| `pending_messages.modified` | Queue grew or shrank. Payload likely contains queue snapshot. |
| `session.tools_updated` | Tool registry changed (e.g., MCP server connected). Useful for observing MCP server lifecycle. |
| `user.message` | A user-supplied message was accepted and is about to be processed (turn boundary). |
| `assistant.turn_start` | Assistant turn begins. |
| `assistant.streaming_delta` | Token-level streaming. |
| `assistant.message_delta` | Message-shaped delta. |
| `assistant.reasoning_delta` | Reasoning-token delta. |
| `assistant.message` | Final assistant message for this turn. |
| `assistant.reasoning` | Final reasoning summary. |
| `assistant.usage` | Token usage stats per turn. |
| `assistant.turn_end` | Assistant turn complete. |
| `session.idle` | All pending messages drained; session is idle. |
| `session.usage_info` | Cumulative usage info. |

minih's `adapter/events.ts` may not surface all of these. Worth an audit pass when implementing the workshop-007 design.

---

## Reproducing

```bash
cd /Users/jordanknight/substrate/minih/scratch/midturn-test
export GH_TOKEN=$(gh auth token)
node test.mjs A   # baseline (~10s)
node test.mjs B   # mid-turn inject (~25s, costs ~$0.02)
node test.mjs C   # rapid-fire (~30s, costs ~$0.02)
```

Each scenario emits NDJSON-style stderr lines. The `[action]` lines show the test's intent; `[evt]` lines show observed SDK events.

## Limitations of this test

- Single SDK version tested; behavior may change in future versions. Re-run after any peer-dep bump.
- Single backend (production GitHub Copilot). Behavior under offline mode (`COPILOT_OFFLINE`) untested.
- Did not test: queue ordering under SIGINT, `session.abort` interaction with queued messages, behavior when queue exceeds N items, behavior when MCP servers are configured.
- Used `gpt-5.5 --no-reasoning` (default for unspecified — well, actually default model from minih). Other models may behave differently around reasoning tokens.

These limitations are non-blocking for the v1 spec. The basic queue-and-deliver model is now confirmed.

---

## Updates to other docs needed

- [ ] `workshops/007-user-journey-coder-and-reviewer.md` — update the mid-turn-injection section from "open question" to "confirmed; here's how"; add the alive-session direct-inject path; document the `sendAndWait` footgun.
- [ ] `workshops/004-spawn-config-injection.md` — note that v2 daemon should subscribe to `pending_messages.modified` for queue observability.
- [ ] `research-dossier.md` — Research Opportunity 6 → mark COMPLETED.
- [ ] `coordination-spec.md` — add new AC for queue-observability via `pending_messages.modified`.
- [ ] `adapter/events.ts` — audit which of the 13 observed event types we currently surface vs collapse to `AgentRawEvent`.
