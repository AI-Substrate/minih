# Workshop: Lane-derived farewell helpers (MW4 / MW6 / MW7 cluster)

**Type**: Integration Pattern + API Contract + Data Model
**Plan**: 016-a2a-companion-protocol
**Spec**: (no formal spec — informs three deferred magicWands; sources cited inline)
**Created**: 2026-05-02
**Status**: Draft

**Related Documents**:
- `../companion-experience-plan.md` § Deferred follow-ups (MW4, MW6, MW7)
- `../research-dossier.md` (A2A `Task.artifacts` section — directional inspiration for the `report_draft` shape)
- `../../../how/companion-mode.md` (current farewell protocol)
- `agents/code-review-companion/output-schema.json` (the canonical farewell envelope target)
- `src/runner/inbox-poll.ts` (`readLaneFile` — already does the bulk of the lane-reading work this workshop wants to lift up)

**Domain Context**:
- **Primary domain**: `mcp` (a new tool surface) + `runner` (lane derivations + counters + run-manifest extension)
- **Related domains**: `cli` (operator-side `report` subcommand for non-coordinated workflows); agent prompts (the soft-fail handshake teaches agents *how* to use the new tools)

---

## Purpose

Three magicWands point at the same gap: **the inbox/state lanes hold all the data a run needs to describe itself, but the higher-level surfaces don't lift it.** Companions reconstruct counts, finding lists, and `ackOf` chains by hand at shutdown. Pre-existing unread messages get silently dropped between `wait_for_any` calls. `run.json.counters.messages` reports `0` despite messages on disk.

This workshop designs three companion lane-derivation helpers (one MCP tool, one runner counter rename, one new event-wait surface) so agents and operators both stop reconstructing from scratch.

## Key Questions Addressed

- What's the right shape for the auto-derived "session ledger" (MW7)? Skeleton-with-edits vs full-rewrite-on-every-call?
- Where does the helper live — MCP tool (agent-callable), runner public function (CLI- and MCP-callable), or pure CLI command (operator-only)?
- How do MW4 (counter rename) and MW6 (`wait_for_any` returning pre-existing) interact with MW7? Are they three things or one?
- How much of the farewell envelope is genuinely impossible to derive (and thus must stay agent-authored)?
- What does the `report_draft` JSON look like?

---

## 1. Why these three magicWands belong together

| MW | Symptom | Root cause | Where it lives in the stack |
|---|---|---|---|
| MW4 | `run.json.counters.messages: 0` despite N inbox messages on disk | `counters.messages` counts SDK conversation messages, not inbox messages. Coordinated runs have ~zero SDK messages because the inbox loop replaces them. | `runner/runner.ts:613-633` — `stats.messages` increments on `event.type === 'message'` (SDK) only |
| MW6 | `wait_for_any` skips pre-existing unread inbox messages — only delivers events arriving DURING the wait window | `event-wait.ts` registers a watcher and returns events that *land* after subscription; pre-existing entries in the lane file are not pre-rendered into the result | `runner/event-wait.ts:184` and the matching mcp-side dispatch |
| MW7 | Companion authors a farewell by hand: counts messages, maps `ackOf` chains, copies findings into `output/report.json` from the inbox they already sent them to | No "ledger view" tool. The lane has all the data; nothing aggregates it. | New surface needed |

**They share a single underlying pattern**: the inbox/state lanes are append-only on-disk source of truth, but everything *above* them (counters, MCP tools, farewell rendering) is shallow or missing. Solving them one at a time would mean three different "read the inbox lane and aggregate" implementations.

**One implementation, three surfaces**:

```
            (lane files: inbox/inside, inbox/outside, state/history)
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │ runner/lane-aggregator.ts  │  ← NEW: pure aggregator
                    │   counts(), threadOf(),    │     reads lane files,
                    │   findingsList(),          │     returns derived
                    │   pendingUnread()          │     skeleton — no I/O
                    └─────────────┬──────────────┘     beyond fs.readFile
                                  │
              ┌───────────────────┼─────────────────────────┐
              ▼                   ▼                         ▼
       MW4 (runner)         MW7 (mcp)                MW6 (mcp/runner)
   counters extension   report_draft tool       wait_for_any 'pending'
   adds inboxMessages   wraps counts +          surface — call aggregator
   per lane             threadOf() output       to pre-render unread
```

This workshop designs that aggregator + the three thin surfaces over it.

---

## 2. The aggregator — `runner/lane-aggregator.ts` (NEW)

Pure functions, zero I/O beyond `fs.readFile` on the run's existing lane files. Stateless. Idempotent. Same input → same output.

### 2.1 Inputs
```ts
interface LaneAggregatorInput {
  runDir: string;           // <agentDir>/runs/<runId>/
  insidePath?: string;      // override; default: <runDir>/inbox/inside/messages.ndjson
  outsidePath?: string;     // override; default: <runDir>/inbox/outside/messages.ndjson
  historyPath?: string;     // override; default: <runDir>/state/history.ndjson
}
```

### 2.2 Output shape
```ts
interface LaneSnapshot {
  /** Wall-clock the snapshot was taken — useful for downstream consumers */
  takenAt: string;
  /** Per-lane raw arrays (already parsed; same shape as InboxMessage). */
  inside: InboxMessage[];
  outside: InboxMessage[];
  /** Counts by sender×type. Sparse: only keys with count > 0. */
  counts: {
    inside: Record<string, number>;   // e.g. {ack: 7, finding: 3, progress: 4}
    outside: Record<string, number>;  // e.g. {briefing: 1, task: 4}
    /** Total inbox message volume — replaces / supplements run.json counters.messages */
    inboxMessagesTotal: number;
  };
  /** Threads grouped by ackOf root. Each thread is a chain. */
  threads: Thread[];
  /** Outside messages with no inside reply (use `ackOf` only — type-agnostic). */
  unanswered: InboxMessage[];
  /** Inside messages that arrived but the operator never acked. */
  unread: InboxMessage[];
}

interface Thread {
  /** Root message id — usually an outside task or briefing. */
  rootId: string;
  /** The root message itself, for convenience. */
  root: InboxMessage;
  /** All replies in the chain, in send order. Includes acks. */
  replies: InboxMessage[];
  /** Replies whose .type indicates substantive content (not just ack). */
  substantiveReplies: InboxMessage[];
  /** True if the most recent message in the chain is an inside reply. */
  closedByInside: boolean;
}
```

### 2.3 Behavioural contract
- **Walk both lanes**, parse each line with the existing `parseInboxMessage` helper. Skip malformed lines silently (log via `runner-warnings.ts` if it exists; otherwise ignore — the aggregator is best-effort, not a validator).
- **Count by sender × type** producing the sparse `counts` map.
- **Build threads** by tracing `ackOf` chains. Root = the first message in a chain whose `ackOf` is unset OR points outside the run (orphaned ack — note in a `diagnostics` field).
- **`unanswered`** = outside messages not referenced by any inside `ackOf` (including transitive).
- **`unread`** = inside messages whose `id` doesn't appear in any outside ack record. (Mirrors the existing `unread` flag in `pollInboxLane`.)

### 2.4 Why pure (no I/O beyond reads)
- Trivially testable with fixture lane files.
- Safe to call from the MCP tool path (no tool can write the run's lane files anyway).
- Cheap to call repeatedly — the inbox NDJSONs at typical companion scale are <1KB. The wait_for_any pre-render path can call it on every wake without measurable cost.

---

## 3. Three thin surfaces over the aggregator

### 3.1 MW7: `report_draft` MCP tool (NEW)

**Goal**: when an agent reaches its farewell handler, calling `report_draft({})` returns a JSON skeleton matching the shape of its `output-schema.json`'s most-derivable fields. The agent fills in `summary` and `retrospective` (the genuinely-not-derivable parts) and emits the merged document.

**Tool contract (`src/mcp/types.ts` addition):**
```ts
{
  name: 'report_draft',
  description: 'Derive a farewell report skeleton from the run\'s inbox + state lanes. Returns counts, findings list, ackOf chains. Agent extends with summary + retrospective.',
  inputSchema: {
    type: 'object',
    properties: {
      includeFindings: {
        type: 'boolean',
        description: 'When true (default), inline finding-typed messages from the inside lane into a `findings` array.',
        default: true,
      },
      conversationFromTasks: {
        type: 'boolean',
        description: 'When true (default), build a conversation array — one entry per outside task — with topic from subject, highlights from inside reply subjects/bodies.',
        default: true,
      },
    },
    additionalProperties: false,
  },
}
```

**Output shape:**
```jsonc
{
  "session": {
    "startedAt": "<from run.json>",
    "endedAt": "<takenAt of the lane snapshot>",
    "messageCounts": {
      "outside": { "briefing": 1, "task": 4, "directive": 1, "control": 1 },
      "inside":  { "ack": 7, "progress": 4, "finding": 3, "summary": 3, "farewell": 1 },
      "outsideTotal": 7,
      "insideTotal": 18
    },
    "threads": [
      {
        "rootId": "01KQH...",
        "rootSubject": "review-request: plan-016 main commit 7b9da8a",
        "rootType": "task",
        "replyCount": 4,
        "lastReplyType": "summary",
        "ackOfChain": ["01KQH...", "01KQH...", "01KQH..."]
      }
    ]
  },
  "findings": [
    // included when includeFindings=true; one entry per finding-typed inside message:
    {
      "id": "F001",                            // synthesised: F001..FNNN in send order
      "messageId": "01KQH...",
      "subject": "...",
      "body": "...",
      "ts": "...",
      "ackOf": "01KQH..."                       // pass-through from message
    }
  ],
  "conversation": [
    // included when conversationFromTasks=true; one entry per outside task:
    {
      "round": 1,
      "rootId": "01KQH...",
      "topic": "<root.subject>",
      "highlights": [
        // inside replies' subjects/short body excerpts that ack this thread
      ]
    }
  ]
}
```

**What the agent still authors by hand:**
- `summary` — prose synthesis, cannot be auto-derived
- `retrospective.magicWand` / `magicWandTarget` / `notes` — judgement
- `session.exitReason` — agent-known (`stop_requested` vs `idle_budget` vs `error`)
- Any custom fields its `output-schema.json` adds

The point isn't to remove agent authorship — it's to remove the *mechanical* parts (counts, message id mapping, finding payload copy-paste) that the lane already encodes.

**Agent prompt nudge** (preamble or per-agent):
> Before authoring your farewell envelope, call `report_draft({})` and merge its output. Author only `summary`, `retrospective`, and `session.exitReason` yourself — the lane already has the rest.

### 3.2 MW4: extend `run.json.counters` with inbox-aware fields

**Problem**: `counters.messages` is overloaded. It started life as "SDK conversation messages" (relevant for one-shot agents) but operators read it as "inbox messages" because that's what coordinated runs do.

**Fix**: keep `counters.messages` for backward-compat (rename it in a *separate* breaking change later if needed) but add three new fields:

```ts
interface LiveRunManifest {
  // ... existing fields ...
  counters: {
    events: number;          // unchanged
    toolCalls: number;       // unchanged
    messages: number;        // unchanged — SDK conversation messages
    errors: number;          // unchanged
    /** NEW: inside-lane inbox messages (sender:'inside'). */
    inboxInside: number;
    /** NEW: outside-lane inbox messages (sender:'outside'). */
    inboxOutside: number;
    /** NEW: state-history transitions (both sides). */
    stateTransitions: number;
  };
}
```

**Implementation sketch**: hook the inbox-forwarder's "I just appended a message" path and the state-history append path to throttled `updateManifest` patches. Same pattern as the existing event counter (`runner/runner.ts:660-672`). The `lane-aggregator` doesn't strictly need this for derivation (it can count from the file directly) — these are for cheap operator-side queries against the manifest without parsing NDJSONs.

### 3.3 MW6: `wait_for_any` returns pre-existing unread on first match

**Problem**: when `wait_for_any` is called and the inbox already has unread messages matching the filter, the tool waits for *new* events and returns nothing. The pre-existing unread is silent until something else wakes the wait.

**Fix shape A (preferred — backward-compatible):** when the wait first arms, do a synchronous check via the aggregator's `unread` field for messages matching the requested filters. If any match, return them immediately without waiting:

```ts
// pseudo
async function waitForAny(events, waitMs) {
  const snapshot = aggregateLanes(runDir);
  const preExisting = snapshot.unread.filter(m => matchesAnyFilter(m, events));
  if (preExisting.length > 0) {
    return { events: preExisting.map(toEnvelope), wait: { timedOut: false, matched: 'pre-existing', ... } };
  }
  // ... existing wait logic ...
}
```

**Fix shape B (additive new field):** add `pendingUnread` to the `wait_for_any` result so callers can see what was already there even when a fresh event arrives. Less safe for existing callers; only do this if shape A breaks something.

**Open question**: do we need an opt-out for agents that *want* the current "events that arrive AFTER the call" semantics? I don't think so — pre-existing unread matching the filter is, by every reasonable interpretation, an event the agent should care about. But flag it during implementation review.

---

## 4. Migration plan (per-magicwand fix dossiers when scoped)

The three surfaces can ship in either order, but they share the aggregator. Recommended sequence:

1. **Aggregator first** (no surface change, pure addition; full unit tests with fixture NDJSONs).
2. **MW4 counters extension** (smallest user-visible change; lets us sanity-check throttled writes from inbox-forwarder).
3. **MW7 `report_draft` tool** (the headline win; depends on aggregator).
4. **MW6 `wait_for_any` pre-existing pre-render** (most subtle; do last to benefit from the aggregator being battle-tested).

---

## 5. Worked example — code-review-companion farewell, BEFORE vs AFTER

### BEFORE (today, 2026-05-02)
The companion's prompt tells it to write `output/report.json` matching `output-schema.json`. At farewell, the agent runs `inbox_list({})` to get the lane, then in its head:
- Counts messages by type → `messageCounts.tasksReceived`, `findingsSent`, `questionsAsked`
- Walks `ackOf` chains to figure out which findings answer which review-request
- Re-types the finding payloads from inbox bodies into the report's `findings[].file/category/issue/recommendation` fields (which is itself another representation problem — see MW7's "the report doesn't auto-derive *content* from inbox" subtext)
- Writes a summary
- Authors a magicWand

**Code-review-companion's own difficulty row from run `2026-05-01T16-32-21-242Z-507d`:**
> [annoying] coordination: The final report has to mirror findings already sent through the inbox, but there is no automatic export from the inbox lane into the report JSON. (workaround: Manually copied the three finding payloads and task counts into output/report.json before validation.)

### AFTER (with MW7)
The companion's prompt teaches:

```text
On farewell:
1. Call `report_draft({})` — this returns a skeleton with counts, threads,
   and findings derived from your inbox lane.
2. Merge it with your own:
   - `summary` (prose)
   - `retrospective` (magicWand + difficulties)
   - `session.exitReason`
3. Validate against your output-schema.json.
4. Write the merged document to $MINIH_OUTPUT_PATH.
```

The mechanical "count tasks", "map findings to review-request ids", "copy-paste payloads" steps disappear. The agent's authorship reduces to the parts that genuinely require judgement.

**Caveats / what stays manual:**
- Agents with custom output-schema fields beyond the standard shape still hand-author those fields. `report_draft` only fills the canonical `session/findings/conversation` shape. Document this clearly.
- If the agent wants to *redact* something from the lane (e.g. a sensitive finding it sent earlier), it has to filter `report_draft`'s output before merging. The tool doesn't enforce inclusion.

---

## 6. Quick reference

```bash
# (Hypothetical post-implementation)

# From inside the agent (MCP):
report_draft({})
# Returns the skeleton — agent adds summary + retro + writes.

# From outside (CLI mirror; same aggregator):
npx minih outside report-draft <slug> --run "$RUN" 2>/dev/null | jq

# Counters (MW4) visible in run.json:
jq '.counters' agents/<slug>/runs/<run>/run.json
# {
#   "events": 4637,
#   "toolCalls": 59,
#   "messages": 0,                ← SDK; legacy
#   "errors": 0,
#   "inboxInside": 19,            ← NEW
#   "inboxOutside": 7,            ← NEW
#   "stateTransitions": 13        ← NEW
# }

# wait_for_any (MW6) returns pre-existing unread:
wait_for_any({events: [{kind:'inbox.message'}], waitMs: 30000})
# → events: [...] with matched: 'pre-existing' OR 'live' OR 'mixed'
```

---

## 7. Open questions

### Q1: Should the aggregator live in `runner/` or `mcp/`?

**RESOLVED**: `runner/` (per `runner → adapter, adapter ↛ runner` domain rules; mcp imports from runner is fine).

### Q2: Should `report_draft` synthesise finding ids `F001..FNNN`, or pass through whatever the agent put in finding bodies?

**RESOLVED**: synthesise sequence ids `F001..FNNN` based on send order. The agent's bodies are free text; the schema needs a stable id and the lane doesn't carry one. The tool's contract is "skeleton" — agents who want different ids overwrite them in the merge step.

### Q3: Does MW6's pre-existing-unread fix change `wait_for_any`'s `wait.matched` value?

**RESOLVED**: yes, add a third value: `pre-existing` (was just `true | timedOut`; now `pre-existing | live | mixed | timeout` — exact enum to-be-named). Backward-incompatible only for callers that switch on the literal value; existing callers checking `matched === true` still work because `pre-existing | live | mixed` are all truthy.

### Q4: Should `inboxMessagesTotal` distinguish acked vs unread?

**OPEN**: probably yes, as `inboxOutsideAcked` and `inboxOutsideUnread`. But adds 2 more counter fields and the cost may not justify it — `report_draft.unanswered.length` is the same answer derived live. Decide during MW4 implementation.

### Q5: How does this interact with MW8 (state-surface `reason` lifting)?

**RESOLVED**: orthogonal. MW8 lives in cluster 3 (workshop 004 — TBD). The aggregator could also surface latest `reason` from `state/history.ndjson` for free, but that's MW8's job and keeping concerns separated is cleaner.

### Q6: Who validates that `report_draft`'s output is *sufficient* for the agent's `output-schema.json`?

**OPEN — important**: agents have varying output-schemas. `code-review-companion` requires `findings[].severity` and `findings[].file` which are NOT in any inbox message body (the agent has to author them). `demo-companion` requires `conversation` with subjective `highlights`. The aggregator can't know the schema. Options:

- **A**: tool returns the canonical skeleton; agent merges and is responsible for filling in schema-required fields the lane doesn't carry. (Simplest. Document clearly.)
- **B**: tool reads the agent's `output-schema.json` and fills as much as it can, leaving `null` placeholders for the rest. (Smarter, but tightly couples the tool to schema layout.)
- **C**: tool emits two outputs — `derived` (canonical lane-aggregate shape) and `schemaSlots` (the agent's schema with derived values where they fit). Agent reconciles. (Most complete, most complex.)

**Recommend A for v1.** Revisit if agents start hand-coding the same schema-translation step.

---

## 8. Why this design (the principles)

1. **Lanes are source of truth** — the inbox/state NDJSONs aren't a replica, they're the ledger. Every higher-level surface should derive from them, not duplicate them. (Per minih's "harness is the product" anchor: keep the foundational store thin and authoritative.)
2. **Pure aggregator → many thin surfaces** — three magicWands collapse to one implementation + three adapters. Standard layered design.
3. **Schema-agnostic in the tool, schema-aware in the agent** — `report_draft` shouldn't know what an `output-schema.json` looks like. The agent does.
4. **Backward-compatible by default** — extend `counters` rather than rename; add `pre-existing` to `wait_for_any` rather than swap default semantics. Forward-compat surface for future things (e.g. cluster 3's `reason` lifting).
5. **Don't pretend to fully automate** — `summary` and `retrospective` are the genuinely-judgement parts. Auto-deriving them would be the worst kind of cheating.

---

## 9. Out of scope for this workshop (other clusters)

- **Cluster 2 — operator round-trip (MW1, MW2, MW5)**: these are CLI/docs concerns. Workshop 003.
- **Cluster 3 — view surface stripping (MW3, MW8)**: `reason` lifting + polling badge. Workshop 004.

These could overlap downstream (e.g. MW8's `reason` could surface in `report_draft.session.lastReason`) but designing them together would over-couple. Each workshop owns its slice.

---

**Implementation note**: this workshop produces no code. It defines the contract for three future fix dossiers (FX005 aggregator, FX006 `report_draft`, FX007 wait_for_any pre-existing). MW4's counter extension can fold into FX005's tests since it shares the aggregator's lane-walking. Filing those fix dossiers is out of scope for this workshop — wait until a session has appetite to land them, then `/plan-5 --fix` per dossier.
