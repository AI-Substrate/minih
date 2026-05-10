# Research Dossier — Message Reply Chains

**Generated**: 2026-04-29
**Research query**: "Upgrade messaging so agents can reply to a particular message; the other agent can reply to *that* message; simple chaining with message ids — no threads."
**Mode**: Pre-Plan (creates new plan folder 013)
**Branch**: `007-backgrounding`
**FlowSpace**: not used (focused, narrow scope — direct codebase reads were sufficient)

---

## Executive Summary

### The Surprise (read this first)

**Reply chaining is already 90% built.** The `InboxMessage` type, JSON schema, MCP `inbox_send` tool input, JSONL on-disk format, inbox-forwarder render path, human-view model, and `outside-send --ack-of` flag *all* already carry an optional `ackOf: <ulid>` field that points at another message id.

What's blocking general "reply to *that* message" usage is **two narrow gates plus documentation**:

1. **Outside CLI gate** (`src/cli/commands/outside.ts:201-216`) — refuses `--ack-of` unless `--type ack` and *requires* it when `--type ack`. So the field exists but is administratively locked to acks only on the outside side.
2. **MCP side has no gate** — inside agents *can* already pass `ackOf` with any `type` today (see `src/mcp/tools/inbox.ts:91-107`). The schema permits it and the tool stores it. But agents are never told this in the preamble.
3. **Forwarder labels it "Acknowledges:"** when rendering for the agent (`inbox-forwarder.ts:160`), which is correct for acks but misleading for general replies.
4. **Preamble + AGENTS_README never mention replies** — agents have no way to discover the capability.

### The recommended shape (one paragraph)

Promote `ackOf` from "ack-only correlation" to "general parent pointer." Remove the outside-CLI type gate so any message can carry `--ack-of`. Update the inbox-forwarder to render `In reply to:` for non-ack messages and keep `Acknowledges:` for `type=ack`. Teach agents in the shared preamble that *any* `inbox_send` may include `ackOf` to reply to a specific message. **Zero schema changes, zero on-disk format changes, fully backward compatible.** The chain emerges naturally because each reply's `id` is itself a valid `ackOf` target for the next reply.

### Quick stats

- **Files needing change**: ~5 source + 2 docs + tests
- **Schema changes**: none
- **On-disk format changes**: none
- **Breaking changes**: none (the gate being removed only widens what was previously rejected)
- **New plan ordinal**: 013

---

## How It Currently Works

### The data model — `InboxMessage`

`src/runner/types.ts:189-202`:

```ts
export interface InboxMessage {
  id: string;          // Crockford-base32 ULID, 26 chars
  sender: Side;        // 'outside' | 'inside'
  type: string;        // free-form: 'note', 'ack', 'task', 'question', ...
  subject: string;
  body: string;
  ts: string;          // ISO-8601
  ackOf?: string;      // ULID of a message this message acknowledges
  meta?: Record<string, unknown>;
}
```

### The schema — `src/schemas/inbox-message.json`

`ackOf` is already validated as a 26-char ULID:

```json
"ackOf": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" }
```

`additionalProperties: false` — so any new field name (e.g. `inReplyTo`) would be a *schema-breaking* addition.

### MCP `inbox_send` tool — already accepts `ackOf`

`src/mcp/types.ts:233-239`:

```js
ackOf: {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  description: 'Optional inbox message id this reply acknowledges (drives Phase 2 workbench correlation).',
}
```

The handler (`src/mcp/tools/inbox.ts:91-107`) parses `ackOf` for *any* type — there is no gate. The comment is explicit:

> `ackOf` is accepted optimistically: we validate shape (non-empty string ≤128 chars) but do NOT verify the referenced message exists. A stale ackOf becomes the agent's bug to fix at the human-view rendering layer, not a write-time blocker. Same-lane (inside-acks-inside) is intentionally allowed for thread continuation.

So the inside-side already supports the user's mental model. **The agent just doesn't know.**

### MCP `inbox_ack` — convenience wrapper

`src/mcp/tools/inbox.ts:113-147`. Synthesizes an `{ type: 'ack', subject: 'Ack: <id>', body: '...', ackOf: <id> }` message for a given peer message id. Idempotent (returns the existing ack if one already exists). Continues to work unchanged under the proposal.

### Outside CLI — the gate

`src/cli/commands/outside.ts:201-216`:

```ts
if (type === 'ack' && !opts.ackOf) {
  exitWithEnvelope(invalidArgs(..., '--ack-of is required when --type is ack'));
}
if (type !== 'ack' && opts.ackOf) {
  exitWithEnvelope(invalidArgs(..., '--ack-of is only supported for --type ack'));
}
```

**This is the single most important block to the user's request.** The first half stays valid (`--type ack` makes no sense without a target). The second half is what locks the field to ack-only on the outside lane and must be removed.

### Inbox-forwarder rendering (what the agent sees)

`src/runner/inbox-forwarder.ts:151-163`:

```ts
export function renderInboxMessageForAgent(message: InboxMessage): string {
  const lines = [
    '## Outside inbox message', '',
    `ID: ${message.id}`,
    `Type: ${message.type}`,
    `Subject: ${message.subject}`,
    `Timestamp: ${message.ts}`,
  ];
  if (message.ackOf) lines.push(`Acknowledges: ${message.ackOf}`);
  lines.push('', message.body);
  return lines.join('\n');
}
```

The agent already sees the parent id when one exists — it's just labelled "Acknowledges:" which biases interpretation toward "this is an ack" rather than "this is a reply to id X."

### `unread` filter — only consumes acks

`src/runner/inbox-poll.ts:144-148`:

```ts
const acknowledged = new Set(
  peerMessages.filter((m) => m.type === 'ack' && m.ackOf).map((m) => m.ackOf as string),
);
```

A non-ack reply does NOT mark its parent as "read." This is probably correct: a reply is not an ack. We should keep this behaviour. Replies remain in `unread` until explicitly `inbox_ack`'d.

### Human view

`src/runner/human-view-model.ts:288-304` already groups by `ackOf` and exposes an `ackState` field per message. So the human-readable timeline naturally renders chains today; we just need to make sure the labels (currently "Ack of X" patterns) cope with non-ack replies. Worth a quick look in the human-view rendering code during implementation.

### Outside CLI consumer (`outside inbox list --unread` etc.)

`src/cli/commands/outside.ts:644-650` mirrors the inbox-poll filter — same logic, only `type=ack` clears unread. Stays unchanged.

---

## Why Not Add `inReplyTo` Alongside `ackOf`?

Tempting because the name `ackOf` is semantically narrow. Arguments **against**:

1. **Two ways to do the same thing.** Agents would have to choose; humans would have to read both. Confusion cost > naming aesthetic.
2. **Schema break.** `additionalProperties: false` means adding `inReplyTo` is a JSON-schema migration. Not free.
3. **Forwarder, human-view, peer-activity all duplicate logic.** Every one of them currently follows `ackOf`. A second pointer means parallel branches everywhere.
4. **`inbox_ack` would still write `ackOf`** — so even after a rename the old field name survives in the bookkeeping. Net: two field names doing the same job.

**Recommendation**: keep `ackOf`. Treat it as the canonical "parent message id" pointer. Rename only its *prose description* in the MCP schema and preamble to read "the message this is in reply to (use `inbox_ack` for type=ack acknowledgements)."

The cleaner long-term name *would* be `inReplyTo` or `parentId`. If we ever do that rename it should be a separate, isolated migration plan with shim acceptance during the transition. Not in scope for this plan.

---

## Findings

### IA-01 (HIGH): `ackOf` infrastructure is complete end-to-end
The pointer is plumbed through schema, types, MCP tool input, runner inbox readers, inbox-forwarder, human-view, peer-activity. No new plumbing needed.

**Evidence**:
- `src/schemas/inbox-message.json:13`
- `src/runner/types.ts:200`
- `src/mcp/types.ts:233-239`
- `src/mcp/tools/inbox.ts:92,107,143,209`
- `src/runner/inbox-forwarder.ts:160`
- `src/runner/inbox-poll.ts:146`
- `src/runner/human-view-model.ts:288-304`
- `src/cli/commands/outside.ts:222,650`

### IA-02 (HIGH): outside CLI gate is the only blocker for general replies
`outside.ts:209-216` rejects `--ack-of` unless `--type ack`. Removing this rejection (keeping the "ack requires ack-of" check) unlocks the user-facing capability without any other code change.

### IA-03 (MEDIUM): MCP-side has no gate — inside agents can already chain
`inbox_send` already accepts `ackOf` with arbitrary `type`. Today an inside agent could `inbox_send({ type: 'note', ackOf: '<id>', ... })` and it would work. **The capability exists; the agents just aren't told.**

### IA-04 (MEDIUM): forwarder labels are ack-biased
"Acknowledges:" reads as "this is an acknowledgement of." For a reply chain we want "In reply to:" when `type !== 'ack'`. Trivial change in `renderInboxMessageForAgent`.

### IA-05 (MEDIUM): preamble omits replies entirely
`src/runner/preamble-builder.ts:13-14,26` describes `inbox_send` and `inbox_ack` but never says *replies are possible*. Agents need a one-line callout: "Set `ackOf` to a message id to make your message a reply to it. Replies can themselves be replied to — chains are how multi-turn back-and-forth threads form."

### IA-06 (LOW): MCP schema description over-promises a "phase 2 workbench"
`src/mcp/types.ts:238` reads "Optional inbox message id this reply acknowledges (drives Phase 2 workbench correlation)." Replace with: "Optional id of the message this is a reply to. Used to form reply chains; renders as 'In reply to:' in the next agent's prompt. For acknowledgement specifically, prefer `inbox_ack`."

### IA-07 (LOW): `unread` filter is intentionally ack-only — keep it
A reply is not an ack. The `unread` semantics should remain: a parent is "read" only when an `inbox_ack` is sent for it (or its `id` appears as the `ackOf` of an ack-typed message). This matches the workshop 001 verdict ladder which uses `lastAckOf` to compute peer health. Don't broaden this.

### IA-08 (LOW): same-lane chaining already works
The MCP comment confirms: "Same-lane (inside-acks-inside) is intentionally allowed for thread continuation." So an agent can reply to its own previous message. Useful for "I said X earlier, here is the follow-up." No work needed.

### IA-09 (LOW): no `replyTo`/`inReplyTo`/`parentId`/`threadId` exists anywhere
Confirmed via grep. No competing names to deprecate. No rename hazard.

### IA-10 (MEDIUM): doctor / peer-activity uses `lastAckOf` which is ack-typed
Plan 012's `derivePeerVerdict` uses `peerMessages.filter(m => m.type === 'ack' && m.ackOf).slice(-1)` to find the last acknowledgement. Replies-with-ackOf do NOT count as acks. **This is correct** — peer activity health should still be measured by acks, not by chitchat replies. Don't touch this.

### DC-01 (MEDIUM): tests that exercise the gate must be updated
`test/cli/outside-peer.test.ts`, `test/cli/outside-inbox-send.test.ts` (if exists) likely contain the assertion that `--ack-of` without `--type ack` is rejected. Need to update or remove those expectations. Replace with a positive test: `outside inbox send --type question --ack-of <id>` succeeds and the message appears with `ackOf` populated.

### PL-01 (HIGH — Prior Learning): plan 011/012 took the "messenger not police" line
**Source**: workshops/001-verdict-derivation-rules.md (plan 012), and user verbatim "we dont actually enforce the state machine, we're not the police, we just have to be SUPER SIMPLE AND VERY EASY TO USE."

**Relevance**: This plan should follow the same philosophy. Don't validate that `ackOf` points at a real message. Don't enforce reply-chain shape. Don't reject non-ULID strings beyond what the existing schema already does. Render what the agent sent; if they cite a stale id, that's their bug to surface in the next turn. Stay simple.

### PL-02 (MEDIUM — Prior Learning): F002 from plan 012 — `msgId` vs `messageId`
**Source**: plan 012 closeout (commit `d4697d5`).
**Lesson**: when changing inbox-related code, the MCP parameter name is `msgId` not `messageId`. There are several adjacent fields (`msgId`, `ackOf`, `id`) and it's easy to read the wrong one. Whoever implements this plan should grep for all three names and verify each call site uses the right one.

### IC-01 (LOW): public exports stay stable
`src/runner/index.ts` exposes `InboxMessage`, `renderInboxMessageForAgent`, etc. None need new exports. The capability ships through behaviour change, not new types.

---

## Architecture & Design

### Reply chain example (the user's mental model)

```
ULID-A  Outside → "Can you start the X review?"     type=task   ackOf=null
ULID-B  Inside  → "Started; ETA 5min."              type=note   ackOf=ULID-A
ULID-C  Outside → "Skip section 3."                 type=note   ackOf=ULID-B
ULID-D  Inside  → "Acknowledged; section 3 skipped" type=ack    ackOf=ULID-C
ULID-E  Inside  → "Done; here is the summary."      type=review ackOf=ULID-A
```

Five messages, four chain links, two distinct chains rooted at ULID-A. No threads, no metadata for thread state, no enforcement. The chain is just a single pointer per message and emerges from agents using it.

### What the agent sees in the prompt (after the proposal)

Old:
```
## Outside inbox message
ID: 01H...C
Type: note
Subject: Skip section 3
Timestamp: 2026-04-29T...
Acknowledges: 01H...B

[body]
```

New (when `type !== 'ack'`):
```
## Outside inbox message
ID: 01H...C
Type: note
Subject: Skip section 3
Timestamp: 2026-04-29T...
In reply to: 01H...B

[body]
```

`type === 'ack'` rendering is unchanged — keeps the explicit "Acknowledges:" label.

### Component map

| Component | File | Change |
|---|---|---|
| InboxMessage type | `src/runner/types.ts` | none (already has `ackOf?`) |
| JSON schema | `src/schemas/inbox-message.json` | none |
| MCP `inbox_send` schema | `src/mcp/types.ts:233-239` | description rewrite only |
| MCP `inbox_send` handler | `src/mcp/tools/inbox.ts:85-111` | none (already accepts ackOf for any type) |
| Outside CLI `outside inbox send` | `src/cli/commands/outside.ts:201-216` | **remove** the `type !== 'ack' && opts.ackOf` rejection; keep the `type === 'ack' && !ackOf` requirement |
| Inbox-forwarder render | `src/runner/inbox-forwarder.ts:151-163` | label switch: "In reply to:" when `type !== 'ack'` |
| Preamble | `src/runner/preamble-builder.ts` + `agents/_shared/preamble.md` + `src/templates/shared-preamble.md` | one-paragraph teach-the-agent block |
| AGENTS_README | `AGENTS_README.md` § Coordination | one-paragraph explain-the-feature block |
| Tests | `test/cli/outside-*.test.ts`, `test/runner/inbox-forwarder.test.ts`, `test/mcp/server.test.ts` | flip negative test → positive test for non-ack `ackOf`; add forwarder label test |

---

## Modification Considerations

### ✅ Safe to modify

- `src/cli/commands/outside.ts:209-216` — removing the rejection only widens the accepted input set; existing callers that don't pass `--ack-of` are unaffected.
- `src/runner/inbox-forwarder.ts` label switch — pure string change, no structural impact.
- Preamble / docs — no runtime risk.

### ⚠️ Modify with caution

- The MCP description text in `src/mcp/types.ts` is consumed by every coordinated agent's tool list. Don't change the *name* `ackOf`, only the description string. Keep the description ≤ ~250 chars (LLMs do read these).

### 🚫 Don't touch

- `inbox-poll.ts` `unread` filter — keep ack-only semantics.
- `peer-activity.ts` `lastAckOf` derivation — same reason.
- The schema file `src/schemas/inbox-message.json` — no breaking changes.
- `inbox_ack` tool — the convenience wrapper continues to work and continues to be the right tool for "I have processed this message."

### Extension points / non-goals

- **Threads**: explicitly out of scope per user. We are NOT introducing thread ids, root ids, or thread state.
- **Reply integrity**: NOT validating that `ackOf` points at a real message. (PL-01.)
- **UI in human-view**: nice to have but the model already exposes `ackOf` per-message; rendering improvements are a follow-up if at all.
- **Reply for state messages**: out of scope. Replies are an inbox concept only.

---

## Prior Learnings (relevant)

| ID | Type | Source | Insight | Action for this plan |
|---|---|---|---|---|
| PL-01 | decision | plan 012 workshop 001 | "messenger not police" — minih observes, never enforces | Don't validate `ackOf` referent; trust the agents |
| PL-02 | gotcha | plan 012 F002 closeout | `msgId` vs `messageId` confusion bit us; multiple adjacent id fields | Grep all three names during implementation |
| PL-03 | pattern | plans 010-012 | Power On Mode + companion review caught real bugs | Use it again; companion has the upgraded § 6a anti-capture clause |
| PL-04 | pattern | plan 011 closeout | Auto-harvest captures retros | No new infra needed; retros land automatically |

---

## Domain Context

### Domains touched

| Domain | Relationship | Files |
|---|---|---|
| **runner** | Direct — inbox-forwarder rendering | `src/runner/inbox-forwarder.ts`, `src/runner/preamble-builder.ts` |
| **mcp** | Direct — `inbox_send` description text | `src/mcp/types.ts` |
| **cli** | Direct — outside CLI gate removal | `src/cli/commands/outside.ts` |
| docs / agents-shared | Direct — teach the agents | `agents/_shared/preamble.md`, `src/templates/shared-preamble.md`, `AGENTS_README.md` |

No new domain. No new contract. Existing exports unchanged.

### Domain map position

This is a *cross-cutting* small upgrade — it touches three of the four domains but only in a thin slice each. The conceptual primitive is the inbox message; the change is "stop gating one of its existing fields."

---

## Workshop Opportunities

Watching for opportunities per project preference. Findings:

### WO-01 (LOW): rename `ackOf` → `inReplyTo` (deferred)
Cleaner naming; honest semantics. Deferred because (a) it's a schema-breaking change, (b) `inbox_ack` would still write the rename target, double-naming. Worth a small future plan if and only if naming aesthetics start hurting agent comprehension. **Do NOT include in this plan.**

### WO-02 (LOW): treat all replies (not just acks) as marking parent "read" (deferred)
Tempting but conflicts with peer-activity semantics. Out of scope. If replies should mark parent "responded to" without "acked," that's a separate `responseOf` concept — explicitly not what the user asked for.

### WO-03 (LOW): human-view treatment of non-ack chains
Plan 012's human-view-model already follows `ackOf`. Quick check in implementation: does it render reply chains nicely? If not, capture the gap as a P2 follow-up rather than expanding scope here.

**Recommendation**: skip workshop, go straight to spec. The design space is small and the project philosophy ("simple, easy to use, not the police") makes most options self-eliminating.

---

## Workshop Opportunities Summary

None warranting a workshop. Spec can proceed directly. Capture WO-03 as a stretch in the spec.

---

## External Research Opportunities

None. This is a self-contained code-and-docs change with no external standards or library decisions involved.

---

## Recommended Next Steps

1. Run `/plan-1b-v2-specify` to draft the spec (Mode: **Simple** — small surface, no workshop, single phase).
2. Brief and run `code-review-companion` again per Power On Mode (the upgraded § 6a anti-capture + drift-sweep prompt should reliably catch any doc drift this time).
3. Implementation should be one short phase: gate removal + label switch + preamble + AGENTS_README + tests.

---

## Appendix: file inventory

### Source files implicated

| File | Lines | Role |
|---|---|---|
| `src/runner/types.ts` | 189-202 | InboxMessage type with `ackOf?` (no change) |
| `src/schemas/inbox-message.json` | 1-17 | JSON schema (no change) |
| `src/mcp/types.ts` | 219-244 | `inbox_send` tool contract (description tweak) |
| `src/mcp/tools/inbox.ts` | 85-111, 320-340 | `inbox_send` handler + `parseOptionalAckOf` (no logic change) |
| `src/cli/commands/outside.ts` | 166-244 | outside-send gate (key change) |
| `src/runner/inbox-forwarder.ts` | 151-163 | render label (small change) |
| `src/runner/preamble-builder.ts` | 13-26 | preamble (add reply teaching) |
| `agents/_shared/preamble.md` | n/a | dogfood preamble (mirror change) |
| `src/templates/shared-preamble.md` | n/a | shipped preamble (mirror change) |
| `AGENTS_README.md` | 442 line area | doc (one-paragraph add) |
| `src/runner/inbox-poll.ts` | 144-148 | `unread` filter (no change — keep ack-only) |
| `src/runner/peer-activity.ts` | n/a | `lastAckOf` (no change — keep ack-only) |
| `src/runner/human-view-model.ts` | 288-304 | model already ackOf-aware |

### Test files implicated

| File | Change |
|---|---|
| `test/cli/outside-*.test.ts` | flip the "rejects --ack-of without --type ack" assertion to "accepts --ack-of with any type" |
| `test/runner/inbox-forwarder.test.ts` | add: render shows "In reply to:" when `type !== 'ack'` and `ackOf` present |
| `test/mcp/server.test.ts` or `tools/inbox.test.ts` | add: `inbox_send({ type: 'note', ackOf: <id> })` succeeds and stored message has `ackOf` populated |
| `test/cli/outside-peer.test.ts` | sanity — strict-peer should still apply equally to replies |

### Docs implicated

- `AGENTS_README.md` (one paragraph)
- `agents/_shared/preamble.md` + `src/templates/shared-preamble.md` (one bullet inside § Coordination tools)
- `docs/domains/runner/domain.md` history row
- `docs/domains/cli/domain.md` history row
- `docs/domains/mcp/domain.md` history row (description-only change, but still log it)

---

**Research complete.** Stopping here per skill instructions. Awaiting user signal to proceed to `/plan-1b-v2-specify`.
