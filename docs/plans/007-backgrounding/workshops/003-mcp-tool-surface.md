# Workshop: MCP Tool Surface Design

**Type**: API Contract
**Plan**: 007-backgrounding
**Spec**: [coordination-spec.md](../coordination-spec.md)
**Created**: 2026-04-26
**Status**: Draft

**Related Documents**:
- [001-filesystem-layout.md](001-filesystem-layout.md) — defines the inbox/state files these tools manipulate
- [002-state-machine.md](002-state-machine.md) — defines the transition rules `state.transition` enforces
- [004-spawn-config-injection.md](004-spawn-config-injection.md) — how per-session context is baked into the MCP server before tools are called
- [external-research/agent-harness-survey.md](../external-research/agent-harness-survey.md) — Claude Code MCP-tool precedent

**Domain Context**:
- **Primary Domain**: `mcp` (NEW — owns tool definitions, input/output schemas, dispatch)
- **Related Domains**: `runner` (provides state.ts rules + folder.ts paths consumed by tool implementations)

---

## Purpose

Pin down the inside-agent tool surface — exact tool names, parameter shapes, return shapes, error model, idempotency, and pagination. This is the **inside contract**: agents will write prompts that depend on these tool calls, and changing the names later forces every agent to be edited. Get it right now.

## Key Questions Addressed

- Final tool names (e.g., `inbox.send` vs `notify.send`; `state.transition` vs `state.set` with implied transition)?
- Parameter shapes — what does the agent need to pass, what is hidden via spawn config?
- Error model — typed per tool vs generic envelope?
- Idempotency rules per tool?
- Pagination for `inbox.list`?
- Tool result `_meta` for richer typed errors?

## Resolved Open Questions From Spec

- **Acknowledgement semantics** → **RESOLVED**: `inbox.ack({ msgId })` *appends* an "ack" record to the writer's outgoing lane (not in-place mutation of the original message). Read-side reconstructs read/unread by walking the peer's lane and the writer's own ack lane. Preserves the append-only invariant.

---

## Tool Surface — Six Tools

| Tool | Purpose | Idempotent? |
|------|---------|-------------|
| `inbox.list` | List messages from peer's lane (with filters + pagination) | Yes (read-only) |
| `inbox.send` | Append a message to caller's outgoing lane | No (each call → new message) |
| `inbox.ack` | Acknowledge a peer's message (append "ack" record to caller's lane) | Yes (re-ack = no-op + idempotent record) |
| `state.get` | Read self / peer / both states | Yes (read-only) |
| `state.set` | Update non-phase fields of caller's state | Yes (same value = no-op) |
| `state.transition` | Move caller's `phase` per the rule machine | No (each successful call is a new event in history) |

**No nested namespaces beyond the dot.** No `inbox/notifications/send` or similar — flat-with-dot keeps the surface readable in completion menus and docs.

**Naming discipline**: nouns for namespaces (`inbox`, `state`), verbs for operations (`list`, `send`, `ack`, `get`, `set`, `transition`). Mirror standard MCP conventions and most CRUD APIs.

## Hidden Context (from spawn config)

Every tool implementation needs context that the AGENT NEVER PASSES:

| Hidden parameter | Source | Why hidden |
|------------------|--------|------------|
| `runId` | `MINIH_MCP_RUN_ID` env var on MCP child | Agent shouldn't need to know its own run ID |
| `runDir` | `MINIH_MCP_RUN_DIR` env var | Agent shouldn't write to arbitrary paths |
| `agentSlug` | `MINIH_MCP_AGENT_SLUG` env var | Agent shouldn't need to address itself |
| `agentsDir` | `MINIH_MCP_AGENTS_DIR` env var | Resolves to absolute paths under inbox/state |
| `inboxDir` | `MINIH_MCP_INBOX_DIR` env var (= `<agentsDir>/<slug>/inbox`) | Consolidated path |
| `stateDir` | `MINIH_MCP_STATE_DIR` env var (= `<agentsDir>/<slug>/state`) | Consolidated path |
| `side` | `MINIH_MCP_SIDE` env var (always `inside` for the inside-channel server) | Server knows it's inside; agent just calls tools |

The MCP server reads these once at startup and uses them on every tool dispatch. Tool input schemas (visible to the agent) contain ONLY the agent-supplied fields.

This is the load-bearing pattern that mirrors today's `MINIH_*` env-var hidden context — see workshop 004 for the spawn mechanism.

---

## Tool Reference

### `inbox.list`

Read messages from the peer's outgoing lane (i.e., messages addressed *to* this side).

**Input schema (agent-visible):**

```jsonc
{
  "type": "object",
  "properties": {
    "unread":   { "type": "boolean", "default": false, "description": "Return only messages this side has not yet acked" },
    "type":     { "type": "string",  "description": "Filter by message type (exact match); e.g., 'note', 'directive', 'ack'" },
    "limit":    { "type": "integer", "minimum": 1, "maximum": 1000, "default": 100 },
    "after":    { "type": "string", "description": "Cursor: return messages with id > this (lexicographic)" }
  },
  "additionalProperties": false
}
```

**Return shape:**

```jsonc
{
  "messages": [
    { "id": "01J3...", "sender": "outside", "type": "note", "subject": "phase 2 done", "body": "ready for review", "ts": "2026-04-26T10:14:33.221Z", "ackOf": null },
    { "id": "01J4...", "sender": "outside", "type": "directive", "subject": "focus", "body": "prioritize the auth module", "ts": "2026-04-26T10:18:02.881Z", "ackOf": null }
  ],
  "nextCursor": "01J4...",
  "hasMore": false
}
```

**Implementation sketch:**

1. Open `<inboxDir>/outside/messages.ndjson` (peer's lane; `outside` because we're the inside MCP server).
2. Stream-parse line by line, applying filters (`type`, `unread`).
3. For `unread`: also parse `<inboxDir>/inside/messages.ndjson` (own lane), collect `ackOf` references; filter out any peer message whose id appears as `ackOf` in own lane.
4. After cursor `after` (lex compare; ULIDs are lex-sortable).
5. Limit to `limit`; set `nextCursor` to last returned id; set `hasMore` if more lines exist after.

**Errors:**
- `E_VALIDATION` — input failed schema check (e.g., `limit > 1000`).
- `E_IO` — couldn't read inbox file. Treated as empty inbox (returns `messages: []`) UNLESS the directory itself can't be created — then it's a real error.

---

### `inbox.send`

Append a message to caller's outgoing lane.

**Input schema (agent-visible):**

```jsonc
{
  "type": "object",
  "required": ["type", "subject", "body"],
  "properties": {
    "type":    { "type": "string", "minLength": 1, "maxLength": 50 },
    "subject": { "type": "string", "minLength": 1, "maxLength": 200 },
    "body":    { "type": "string", "minLength": 0, "maxLength": 10000 },
    "ackOf":   { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$", "description": "Optional: id of a peer message this is in reply to" },
    "meta":    { "type": "object", "description": "Open envelope; persisted as-is on the message" }
  },
  "additionalProperties": false
}
```

**Return shape:**

```jsonc
{
  "messageId": "01J5...",
  "ts": "2026-04-26T10:21:11.005Z"
}
```

**Implementation sketch:**

1. Validate input.
2. Generate ULID for `id`.
3. Build full message envelope per `inbox-message.json` schema (workshop 001).
4. Append to `<inboxDir>/inside/messages.ndjson` (own lane; we're inside).
5. Return `{ messageId, ts }`.

**Errors:**
- `E_VALIDATION` — input failed schema check (oversized body, missing field, etc.).
- `E_IO` — couldn't write the file (permissions, disk full).

**Idempotency**: NOT idempotent. Each call → new id. If the agent retries on perceived failure, the inbox gets two messages. Agents must not retry without an idempotency strategy in their prompt.

---

### `inbox.ack`

Acknowledge a peer's message. Implementation = append an ack record to caller's outgoing lane.

**Input schema (agent-visible):**

```jsonc
{
  "type": "object",
  "required": ["msgId"],
  "properties": {
    "msgId": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$", "description": "Id of a peer message to acknowledge" }
  },
  "additionalProperties": false
}
```

**Return shape:**

```jsonc
{
  "ackId": "01J6...",
  "ts": "2026-04-26T10:22:00.000Z",
  "wasAlreadyAcked": false
}
```

**Implementation sketch:**

1. Validate input.
2. (Optional efficiency) Check if `msgId` already appears as `ackOf` in caller's own lane → if yes, return `{ wasAlreadyAcked: true }` with the existing ack's id. Otherwise:
3. Build an ack message envelope: `{ id: <new ULID>, sender: 'inside', type: 'ack', subject: 'ack', body: '', ackOf: <msgId>, ts: <now> }`.
4. Append to `<inboxDir>/inside/messages.ndjson`.
5. Return new ack id + ts + `wasAlreadyAcked: false`.

**Errors:**
- `E_VALIDATION` — msgId not ULID format.
- `E_INBOX_MSG_NOT_FOUND` — msgId doesn't appear in peer's lane (within last N lines, configurable; default scan whole file).
- `E_IO` — write failure.

**Idempotency**: idempotent. Re-acking returns `wasAlreadyAcked: true` and no new record.

**Why append-then-reconstruct (not in-place mutation)**: append-only NDJSON is safe under concurrent appenders; in-place mutation requires file locks. The trade-off is `inbox.list({unread})` must do a small extra parse pass over the own-lane to compute unread status — acceptable for typical inbox sizes.

---

### `state.get`

Read self state, peer state, or both.

**Input schema (agent-visible):**

```jsonc
{
  "type": "object",
  "properties": {
    "side": { "type": "string", "enum": ["self", "peer", "both"], "default": "both" },
    "key":  { "type": "string", "description": "Optional: dot-path into the side's state object (e.g., 'phase', 'data.filesEdited'). If omitted, returns the whole side object." }
  },
  "additionalProperties": false
}
```

**Return shape:**

When `side: "both"` and no `key`:

```jsonc
{
  "self": { "phase": "reviewing", "data": { "issuesFound": 2 }, "updatedAt": "...", "updatedBy": "inside" },
  "peer": { "phase": "in-progress", "data": {}, "updatedAt": "...", "updatedBy": "outside" }
}
```

When `side: "self"` and `key: "phase"`:

```jsonc
{ "value": "reviewing" }
```

When the side file doesn't exist (lazy default):

```jsonc
{ "self": { "phase": "idle", "data": {}, "updatedAt": "<now>", "updatedBy": "inside" }, ... }
```

**Implementation sketch:**

1. Validate input.
2. Map `self` → `inside` (we're the inside server); `peer` → `outside`.
3. Load each requested side via `loadStateLazy(side, slug, agentsDir)`.
4. If `key` provided, walk dot-path; if missing, return `{ value: undefined }` (or 404-style error — TBD; lean toward `undefined`).
5. Return shape per side.

**Errors:**
- `E_VALIDATION` — malformed input.
- `E_IO` — corrupted state file (parse error). Includes the parse error verbatim so the caller can diagnose.

---

### `state.set`

Update non-phase fields of caller's state. Phase changes go through `state.transition`.

**Input schema (agent-visible):**

```jsonc
{
  "type": "object",
  "required": ["key", "value"],
  "properties": {
    "key":   { "type": "string", "pattern": "^data(\\.[a-zA-Z_][a-zA-Z0-9_]*)*$", "description": "Dot-path into the 'data' object; cannot target 'phase' or other top-level fields" },
    "value": { "description": "Any JSON-serializable value" }
  },
  "additionalProperties": false
}
```

**Return shape:**

```jsonc
{
  "ok": true,
  "before": { ... },  // value at key before write (or undefined)
  "after":  { ... }   // value at key after write
}
```

**Implementation sketch:**

1. Validate input. Reject any key not starting with `data.`.
2. Load current state lazily.
3. Walk dot-path; mutate/insert; rebuild new state object.
4. If `before === after` (deep equal), return `{ ok: true, before, after }` and skip write (no history record).
5. Otherwise: write atomically (workshop 001); update `updatedAt` and `updatedBy`.
6. Return `{ ok, before, after }`.

**Errors:**
- `E_VALIDATION` — key doesn't start with `data.`, key has invalid chars, value not serializable.
- `E_IO` — write failure.

**Idempotency**: idempotent. Same value → no-op + no history record (because `data` writes don't transition).

**Why restrict to `data.*`**: prevents agents from sneaking phase changes through `state.set` (bypassing `state.transition` and the rule check). The rule machine is the only path to phase changes.

---

### `state.transition`

Move caller's `phase` per the rule machine. The user's invariant lives here.

**Input schema (agent-visible):**

```jsonc
{
  "type": "object",
  "required": ["to"],
  "properties": {
    "to":     { "type": "string", "minLength": 1, "description": "Target phase (must be in caller side's phase enum)" },
    "reason": { "type": "string", "description": "Optional human-readable explanation; persisted in history" }
  },
  "additionalProperties": false
}
```

**Return shape:**

On success:

```jsonc
{
  "ok": true,
  "from": "reviewing",
  "to": "complete",
  "ts": "2026-04-26T10:21:11.000Z"
}
```

On rejection (returned as MCP tool error, not a normal result — see Error Model below):

```jsonc
// MCP tool error envelope (not the success shape above)
{
  "isError": true,
  "content": [{ "type": "text", "text": "<human-readable reason>" }],
  "_meta": {
    "code": "GATED" | "INVALID",
    "side": "inside",
    "from": "reviewing",
    "to": "complete",
    "requiredPeerPhase": ["done"],   // only for GATED
    "actualPeerPhase":   "in-progress"  // only for GATED
  }
}
```

**Implementation sketch:**

1. Validate input.
2. Load current state lazily; load peer state lazily.
3. Resolve transition rules (default or per-agent override).
4. Call `isAllowedTransition(side, currentPhase, to, peerState, rules)`.
5. If `!ok`: return MCP tool error with `_meta` carrying the structured details.
6. If `ok`: write new state atomically; append `state-history-entry.json` to `state/history.ndjson`.
7. Return success shape.

**Errors (returned as MCP tool errors):**
- `E_VALIDATION` — malformed input or `to` not in caller's phase enum.
- `INVALID` — no rule allows this transition.
- `GATED` — rule exists but peer not in required phase.
- `E_IO` — write or history-append failure.

**Idempotency**: NOT idempotent. Calling `transition({to: <currentPhase>})` is rejected as INVALID (no rule) unless the agent ships an explicit "stay-in-place" rule.

---

## Error Model

### MCP error envelope

When a tool can't complete, return a tool error per the MCP spec:

```jsonc
{
  "isError": true,
  "content": [{ "type": "text", "text": "<one-line human-readable summary>" }],
  "_meta": {
    "code": "<typed code>",
    ...details
  }
}
```

The `_meta._code` field is the *machine-readable* discriminator. Agents can branch on it:

- `E_VALIDATION` — input failed schema validation.
- `E_IO` — filesystem error.
- `E_INBOX_MSG_NOT_FOUND` — `inbox.ack` referenced a non-existent peer message.
- `INVALID` — `state.transition` requested transition has no rule.
- `GATED` — `state.transition` rule exists but peer-state gate not met.

### Why `_meta` for typed details

The MCP spec says `_meta` is for client-only metadata not shown to the model. Some clients pass it through to the model (which is what we want for typed branching); others strip it. We design for both:

- `content[0].text` is always the human-readable line — the model sees this even if `_meta` is stripped.
- `_meta` contains the structured details for clients that surface it.

(If the SDK we're using strips `_meta` from the model's view, we'll fall back to embedding the structured payload as a JSON code-block inside `content[0].text`. Decision deferred to workshop 004 / implementation.)

---

## Tool Manifest (for MCP `tools/list`)

When the SDK calls `tools/list` against our spawned MCP server, we return:

```jsonc
{
  "tools": [
    { "name": "inbox.list",       "description": "List messages from your peer's outbox (i.e., messages addressed to you).",
      "inputSchema": <inbox.list schema> },
    { "name": "inbox.send",       "description": "Send a message to your peer's inbox.",
      "inputSchema": <inbox.send schema> },
    { "name": "inbox.ack",        "description": "Acknowledge a peer message (so it stops appearing in `inbox.list({unread:true})`).",
      "inputSchema": <inbox.ack schema> },
    { "name": "state.get",        "description": "Read your state, your peer's state, or both. Optional dot-path key to read a single field.",
      "inputSchema": <state.get schema> },
    { "name": "state.set",        "description": "Update a field in your `data` object. Cannot change `phase` — use `state.transition` for that.",
      "inputSchema": <state.set schema> },
    { "name": "state.transition", "description": "Change your `phase` per the agreed state machine rules. Some transitions are gated on the peer's phase.",
      "inputSchema": <state.transition schema> }
  ]
}
```

Tool descriptions are written for the *model*, not for human readers. Concise, action-oriented, mention the gate where relevant.

---

## Quick Reference (for agent prompt examples)

```ts
// Inside agent — Claude Code / Copilot SDK style tool calls

await inbox.list({ unread: true })
// → { messages: [{...}], nextCursor: '...', hasMore: false }

await inbox.send({ type: 'ack', subject: 'review of phase 2 done', body: '3 issues filed', ackOf: '01J3...' })
// → { messageId: '01J5...', ts: '...' }

await inbox.ack({ msgId: '01J3...' })
// → { ackId: '01J6...', ts: '...', wasAlreadyAcked: false }

await state.get({ side: 'peer' })
// → { peer: { phase: 'in-progress', ... } }

await state.set({ key: 'data.issuesFound', value: 3 })
// → { ok: true, before: undefined, after: 3 }

await state.transition({ to: 'complete', reason: '3 issues filed' })
// SUCCESS: { ok: true, from: 'reviewing', to: 'complete', ts: '...' }
// REJECTED: throws/returns tool error with _meta.code = 'GATED' | 'INVALID'
```

---

## Tool-Use Patterns the Preamble Will Teach

(workshop 005 covers the prompting; this is the spirit of what agents should learn)

### Pattern 1: Check inbox at major checkpoints

```ts
// Before declaring any task complete, check the inbox
const { messages } = await inbox.list({ unread: true });
if (messages.length > 0) {
  // Address each unread message before proceeding
  for (const msg of messages) {
    // ... handle ...
    await inbox.ack({ msgId: msg.id });
  }
}
```

### Pattern 2: Wait for outside `done` before completing

```ts
// Try to finalize; handle the gate
try {
  await state.transition({ to: 'complete', reason: 'review done' });
} catch (err) {
  if (err._meta?.code === 'GATED') {
    // Outside isn't done yet. Tell them and exit.
    await inbox.send({
      type: 'status',
      subject: 'review done; awaiting your "done" signal',
      body: `Peer is in "${err._meta.actualPeerPhase}". Set state.outside.phase to "done" when ready and re-run me.`
    });
    return; // exit cleanly
  }
  throw err;
}
```

### Pattern 3: Send rich status with structured `data`

```ts
await state.set({ key: 'data.issuesFound', value: 3 });
await state.set({ key: 'data.filesReviewed', value: ['src/auth.ts', 'src/auth.test.ts'] });
await inbox.send({ type: 'status', subject: 'progress', body: '2/5 files reviewed' });
```

---

## Open Questions

### Q1: Should `inbox.send` support an idempotency key?

**OPEN**: agents that retry on perceived failure could pass `idempotencyKey: '<arbitrary>'` and minih dedupes by checking the last N messages.
- Pro: safer for unreliable agents.
- Con: complexity; encourages retry logic over idempotent design.
- **Leaning**: defer; observe whether real agents need it.

### Q2: Tool naming — `inbox.send` vs `notify.send`?

**OPEN**: "notify" implies push semantics; we don't push (yet). "inbox" is a noun (the storage); "send" is the verb that adds to it.
- **Leaning**: stick with `inbox.send` for v1 — clarity > brevity. Future eventing plan can add a separate `notify.*` namespace if push semantics emerge (though `inbox.send` could simply gain push by then).

### Q3: Should `state.set` accept multiple key-value pairs in one call?

**OPEN**: `state.set({ updates: [{ key, value }, ...] })` would be atomic across multiple field changes.
- Pro: atomic multi-field updates.
- Con: more complex schema; agents can call `state.set` twice if they want; not actually atomic across `state.transition` boundaries anyway.
- **Leaning**: single-update only in v1. Add `state.update({patch})` later if needed.

### Q4: Should `inbox.list` expose total message count (not just hasMore)?

**OPEN**: `{ totalCount: N }` requires scanning the whole file (or maintaining a side index).
- **Leaning**: omit in v1 (`hasMore` is enough for paginated UI; total count rarely matters for agent decisions). Add later if a use case surfaces.

### Q5: Should there be a `state.observe` (long-poll for state change)?

**OPEN**: enables an inside agent to wait for outside to transition without polling. But MCP tool calls are synchronous; long-poll inside one tool call ties up the session.
- **Leaning**: defer. The eventing plan (008+) is the right home for push semantics; until then, prompt-driven polling at instruction-defined checkpoints is sufficient.

### Q6: Tool name discoverability — should we ship a `meta.tools` introspection tool?

**OPEN**: `meta.tools.list` returns the manifest above. MCP already ships `tools/list` at the protocol level, but agents may not know to call it.
- **Leaning**: rely on MCP's built-in `tools/list`; preamble documents the six tool names.
