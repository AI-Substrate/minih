# Workshop: Filesystem Layout for Inbox & State

**Type**: Storage Design
**Plan**: 007-backgrounding
**Spec**: [coordination-spec.md](../coordination-spec.md)
**Created**: 2026-04-26
**Status**: Draft

**Related Documents**:
- [research-dossier.md](../research-dossier.md) — Critical Finding 02 (per-agent vs per-run trade-off); QT-06 (test infrastructure gap)
- [external-research/agent-harness-survey.md](../external-research/agent-harness-survey.md) — AutoGen/Aider filesystem-backed message log precedent
- [002-state-machine.md](002-state-machine.md) — uses the state files defined here
- [003-mcp-tool-surface.md](003-mcp-tool-surface.md) — uses the inbox/state files defined here

**Domain Context**:
- **Primary Domain**: `runner` (owns folder convention, schemas, state.ts)
- **Related Domains**: `cli` (consumes paths via outside commands), `mcp` (consumes paths via baked spawn config)

---

## Purpose

Pin the on-disk layout of inbox messages and state files so every other workshop in this plan can reference concrete paths. This is **load-bearing**: the layout decides reproducibility, cross-run coordination semantics, snapshot strategy, and test fixture shape. Once agents start writing here, the convention is hard to change.

## Key Questions Addressed

- Per-agent shared (mutable across runs) vs per-run isolation vs hybrid?
- Where do per-run snapshots live, and what do they capture?
- File-naming convention (folders + leaf files)?
- Atomic write strategy for state JSON?
- Concurrent-access semantics?
- Initial state behavior (lazy auto-create vs explicit init command)?
- Inbox/state per-agent vs per-slug-and-namespace (cross-agent inboxes in v1)?

## Resolved Open Questions From Spec

- **Inbox retention** → **RESOLVED**: keep forever in v1. Pruning is a follow-up. Defensible because individual messages are tiny (KBs), grow slowly, and history has audit value.
- **Inbox/state per-agent vs cross-agent** → **RESOLVED**: per-agent only in v1. No cross-agent inbox. If two distinct agents need to coordinate, they each own one side of the same inbox/state pair (one is "outside" caller of the other). Multi-agent meshes are out of scope per the spec.
- **Initial state auto-create** → **RESOLVED**: lazy auto-create on first read or first write. No explicit `minih state init` command. Default content: `{ "phase": "idle", "data": {} }`. Initial state is *not* recorded in `state/history.ndjson` — only transitions are.
- **Inbox sender identity** → **RESOLVED for v1**: sender is `'outside' | 'inside'` — a *side*, not a *principal*. Implicit context from the lane the message landed in. Adding richer sender metadata (e.g., host caller's identity) is a follow-up; the schema includes a `sender` field but we constrain its values for now.
- **Asymmetric write access** → **RESOLVED**: outside CLI can read both `outside.json` and `inside.json`, write only `outside.json`. Inside MCP can read both, write only `inside.json`. Symmetric. Each side owns its own state file. Inbox lanes follow the same rule (each side writes only to its own outgoing lane).

---

## Overview

minih keeps two new categories of mutable cross-run data per agent:

1. **Inbox** — append-only messages between outside (host caller) and inside (agent inside session). Two lanes — one per sender.
2. **State** — two side-state JSON files (one per side) plus a transition history log. Each side owns and writes its own state file; both can read both.

These live at `agents/<slug>/{inbox,state}/` and persist across runs. Each run captures a *snapshot* of these files into its run folder so the run remains reproducible (the existing "frozen inputs" philosophy is preserved — frozen means "captured at run end" for these cross-run files).

### Why per-agent shared (and not per-run isolation)

The user's stated use case requires cross-run continuity:

> "outside agent can be like 'I've just finished phase 2'. The inside agent can be like, 'I've just finished reviewing phase 2'."

If inbox/state were per-run, this conversation could only happen during one run. The user's model is multi-turn coordination across many runs of the same agent (or many runs of an inside agent driven by outside events). Per-run isolation breaks the model.

### Why we still snapshot per-run

minih's frozen-inputs philosophy ("an agent IS a folder; runs are immutable") is a load-bearing reproducibility guarantee. Mutable cross-run files threaten it. Snapshots restore it: the run folder captures the state of the world *at run end*, so re-running validation against an old run shows what that run actually saw.

---

## Filesystem Tree

```
agents/<slug>/
├── prompt.md                               # Today: agent definition
├── instructions.md                         # Today: optional
├── input-schema.json                       # Today: optional
├── output-schema.json                      # Today: optional
│
├── inbox/                                  # NEW — per-agent shared, mutable
│   ├── outside/
│   │   └── messages.ndjson                 # outside writes here; inside reads
│   └── inside/
│       └── messages.ndjson                 # inside writes here; outside reads
│
├── state/                                  # NEW — per-agent shared, mutable
│   ├── outside.json                        # outside owns/writes; both read
│   ├── inside.json                         # inside owns/writes; both read
│   └── history.ndjson                      # append-only, all transitions, both sides
│
└── runs/                                   # Today: per-run frozen folders
    └── <runId>/
        ├── prompt.md, instructions.md, ... # Today: frozen inputs
        ├── output/report.json              # Today: agent output
        ├── events.ndjson                   # Today: streaming events
        ├── completed.json                  # Today: run metadata
        ├── stderr.log                      # Today: stderr capture
        │
        ├── inbox-snapshot/                 # NEW — frozen at run end
        │   ├── outside.ndjson              # snapshot of inbox/outside/messages.ndjson
        │   └── inside.ndjson               # snapshot of inbox/inside/messages.ndjson
        │
        └── state-snapshot.json             # NEW — frozen at run end
                                            # { outside: <outside.json>, inside: <inside.json> }
```

### Why two folders for inbox lanes

`inbox/outside/messages.ndjson` and `inbox/inside/messages.ndjson` are separate files for three reasons:
1. **Atomic appends per writer**: each side appends only to its own lane → no concurrent writes to the same file.
2. **Easy unread-tracking**: each side polls the *peer's* lane only. No filtering by sender on every list.
3. **Future extension**: if v2 ever adds more "sides" (e.g., a third "supervisor"), each gets its own lane file without changing the format of existing lanes.

The folder layer (`inbox/<sender>/messages.ndjson`) is intentional even though there's only one file per folder today — keeps room for per-side artifacts (e.g., `inbox/outside/attachments/`) without restructuring.

### Why `history.ndjson` is single-file (not per-side)

State transition history needs total ordering across both sides to reason about cross-side cause-and-effect (e.g., "outside transitioned to done at T; inside transitioned to complete at T+1"). One ordered file is the natural representation.

### Why `state-snapshot.json` is single-file (not split)

A single file makes it trivially atomic to read at a point in time and to assert "what state did this run see". Includes both sides' state at run end.

---

## File Formats

### `inbox/<sender>/messages.ndjson`

One JSON object per line. Append-only.

```jsonc
// Example: inbox/outside/messages.ndjson (outside wrote these)
{"id":"01J3...","sender":"outside","type":"note","subject":"phase 2 done","body":"ready for review","ts":"2026-04-26T10:14:33.221Z"}
{"id":"01J4...","sender":"outside","type":"directive","subject":"focus","body":"prioritize the auth module","ts":"2026-04-26T10:18:02.881Z"}
```

```jsonc
// Example: inbox/inside/messages.ndjson (inside wrote these)
{"id":"01J5...","sender":"inside","type":"ack","subject":"phase 2 review done","body":"3 issues found, see report","ts":"2026-04-26T10:21:11.005Z","ackOf":"01J3..."}
```

**Field shape (validated by `inbox-message.json` schema):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string (ULID) | yes | Lexicographically sortable; chronologically near-monotonic |
| `sender` | enum: `"outside"\|"inside"` | yes | Must match the lane (validated on write) |
| `type` | string | yes | Free-form in v1; suggested defaults `note\|status\|directive\|ack\|free` |
| `subject` | string | yes | ≤ 200 chars (suggested) |
| `body` | string | yes | ≤ 10,000 chars (suggested) |
| `ts` | string (ISO 8601 UTC) | yes | Server-side stamp at write time |
| `ackOf` | string (message id) | no | If this message is in reply to / acknowledging another |
| `meta` | object | no | Open envelope for future extensions |

**Why ULID for `id`**: lexicographic sort ≈ chronological sort, so cursor-based pagination works without a side index. Locally unique; no collision risk per agent. 26 chars — readable.

### `state/<side>.json`

Single JSON object. Atomic write (write-temp + rename).

```jsonc
// Example: state/outside.json
{
  "phase": "in-progress",
  "data": {
    "currentPhase": 2,
    "filesEdited": ["src/auth.ts", "src/auth.test.ts"]
  },
  "updatedAt": "2026-04-26T10:14:30.000Z",
  "updatedBy": "outside"
}
```

**Field shape (validated by `outside-state.json` and `inside-state.json` schemas):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `phase` | string (enum) | yes | Set of allowed values comes from state machine (workshop 002). Default enums shipped; per-agent overridable via frontmatter. |
| `data` | object | yes | Free-form per-side payload. May be empty `{}`. |
| `updatedAt` | string (ISO 8601 UTC) | yes | Set by writer on every write. |
| `updatedBy` | enum: `"outside"\|"inside"` | yes | Must match the side that owns this file. Validated on write. |

The two schemas (`outside-state.json`, `inside-state.json`) differ ONLY in the allowed `phase` enum values and the constrained `updatedBy` value. Same outer shape.

### `state/history.ndjson`

One JSON object per line. Append-only.

```jsonc
{"ts":"2026-04-26T10:00:00.000Z","side":"outside","from":"idle","to":"in-progress","reason":null,"peerStateAtTime":{"phase":"idle"}}
{"ts":"2026-04-26T10:14:30.000Z","side":"outside","from":"in-progress","to":"done","reason":"phase 2 wrapped","peerStateAtTime":{"phase":"reviewing"}}
{"ts":"2026-04-26T10:21:11.000Z","side":"inside","from":"reviewing","to":"complete","reason":"3 issues filed","peerStateAtTime":{"phase":"done"}}
```

**Field shape (validated by `state-history-entry.json` schema):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ts` | string (ISO 8601 UTC) | yes | When the transition was applied |
| `side` | enum: `"outside"\|"inside"` | yes | Which side transitioned |
| `from` | string | yes | Phase before transition |
| `to` | string | yes | Phase after transition |
| `reason` | string \| null | yes | Human-readable explanation; nullable if not provided |
| `peerStateAtTime` | object | yes | Snapshot of peer's `{ phase }` at the moment transition was applied. Used by retroactive analysis to reconstruct the gating context. |

**Why include `peerStateAtTime`**: the user's invariant ("inside complete only after outside done") is enforced at transition time. Recording the peer's phase at that moment lets future debugging answer "why was this transition allowed/rejected" without reconstructing from interleaved files.

---

## Snapshot Files (Run Folder Additions)

### `runs/<runId>/inbox-snapshot/{outside,inside}.ndjson`

Verbatim copy of `agents/<slug>/inbox/{outside,inside}/messages.ndjson` taken at run end. Preserves the conversation that this specific run participated in.

```bash
# At run end, runner does:
cp agents/<slug>/inbox/outside/messages.ndjson \
   agents/<slug>/runs/<runId>/inbox-snapshot/outside.ndjson
cp agents/<slug>/inbox/inside/messages.ndjson \
   agents/<slug>/runs/<runId>/inbox-snapshot/inside.ndjson
```

If the source files don't exist (no inbox activity), the snapshot files are zero-byte (touch). Empty NDJSON is valid.

### `runs/<runId>/state-snapshot.json`

Combined snapshot of both side states at run end:

```jsonc
{
  "ts": "2026-04-26T10:25:00.000Z",
  "outside": { "phase": "done", "data": {...}, "updatedAt": "...", "updatedBy": "outside" },
  "inside":  { "phase": "complete", "data": {...}, "updatedAt": "...", "updatedBy": "inside" }
}
```

If side files don't exist, the corresponding sub-object is `null`.

### Why snapshots happen at run END (not at start)

- A run that *initiates* inbox activity needs the post-run state to reflect what the agent did.
- A run that consumes inbox activity wants to know what was visible at run start, but that's reconstructable: read the snapshot of the *prior* run and any messages whose timestamp ≤ run start.
- Snapshotting at end is also simpler — runner already has the "wrote completed.json" hook for end-of-run side effects.

(If a future need surfaces for start-of-run snapshots, add `inbox-snapshot/at-start/` and `state-snapshot-at-start.json`. Forward-compatible.)

---

## Atomic Write Strategy

### Append-only NDJSON files (inbox lanes, state history)

**Strategy**: `fs.appendFileSync(path, line + '\n')` directly. POSIX guarantees `write(2)` of less than `PIPE_BUF` (4096 bytes on Linux/macOS) is atomic. NDJSON lines stay well under this in practice.

**For lines exceeding `PIPE_BUF`**: write a temp line file then `cat` append (or open with `O_APPEND` and write — also atomic per-write under POSIX). Document the line-size budget. We'll set a soft limit of 8 KB per inbox message (subject + body + headers); enforce at MCP tool input validation.

**Concurrent appenders to same lane**: not a concern in v1 because each lane has exactly one writer (outside CLI for outside lane; inside MCP for inside lane). If we ever change that, revisit with `flock` or single-writer enforcement.

### State JSON files (mutable state.<side>.json)

**Strategy**: write-temp + rename. Atomic on POSIX:

```ts
function writeStateAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, path); // POSIX atomic rename within same fs
}
```

Two writers to the same state file (e.g., two `minih state set <slug> --side outside ...` invocations in parallel) → last-write-wins; no corruption. Acceptable in v1.

If we ever need stricter (e.g., compare-and-swap on `updatedAt`), document then; not in scope.

---

## Concurrent-Access Semantics

| Scenario | Behavior in v1 | Future option if needed |
|----------|----------------|--------------------------|
| Outside writes outbox + inside reads inbox at the same time | Reader sees lines that were `write()`d *before* their `open + readv()` started. Simple consistency model, sufficient for "check inbox at instruction-driven intervals." | n/a |
| Two outside CLI processes call `outside-send <slug>` simultaneously | Both lines appended; ordering by `ts` field (server-side stamp at append time). | File lock + queue if order matters more strictly. |
| Two outside CLI processes call `state set <slug> --side outside` simultaneously | Last-write-wins on the JSON file; both transitions logged in `history.ndjson`. | Compare-and-swap on `updatedAt`. |
| MCP server (inside) and outside CLI (outside) write their respective files in parallel | Independent files; no conflict. History entries from both append to the shared history; ordered by `ts`. | n/a |
| Run completes while a new outside message is being appended | Snapshot may capture either state; window is microseconds. Race is benign. | Quiesce-then-snapshot if an actual problem surfaces. |

---

## Initial State Behavior

When `state.get` (or any read) is called and the side file doesn't exist:

```ts
// Pseudo-code in runner/state.ts
function getStateLazy(side: Side, slug: string, agentsDir: string): SideState {
  const path = stateFilePath(side, slug, agentsDir);
  if (!fs.existsSync(path)) {
    return { phase: 'idle', data: {}, updatedAt: new Date().toISOString(), updatedBy: side };
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
```

The lazy-default is **never persisted** until a transition or set actually writes. Reads that find nothing return the synthetic default; no write side effect.

When `state.set` or `state.transition` is called and the side file doesn't exist, the writer creates the parent directory and writes the file. The first transition is logged in `history.ndjson` with `from: 'idle'` (the synthetic default).

---

## Default Schemas (Default Phase Enums)

These are the *defaults*; agents can override via frontmatter (workshop 002 covers transition rules; this workshop covers the file shape).

### `src/schemas/outside-state.json`

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://minih.dev/schemas/outside-state.json",
  "type": "object",
  "required": ["phase", "data", "updatedAt", "updatedBy"],
  "properties": {
    "phase": {
      "type": "string",
      "enum": ["idle", "in-progress", "paused", "done", "error"]
    },
    "data": { "type": "object" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "updatedBy": { "const": "outside" }
  },
  "additionalProperties": false
}
```

### `src/schemas/inside-state.json`

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://minih.dev/schemas/inside-state.json",
  "type": "object",
  "required": ["phase", "data", "updatedAt", "updatedBy"],
  "properties": {
    "phase": {
      "type": "string",
      "enum": ["idle", "in-progress", "paused", "reviewing", "complete", "error"]
    },
    "data": { "type": "object" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "updatedBy": { "const": "inside" }
  },
  "additionalProperties": false
}
```

### `src/schemas/inbox-message.json`

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://minih.dev/schemas/inbox-message.json",
  "type": "object",
  "required": ["id", "sender", "type", "subject", "body", "ts"],
  "properties": {
    "id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "sender": { "type": "string", "enum": ["outside", "inside"] },
    "type": { "type": "string", "minLength": 1, "maxLength": 50 },
    "subject": { "type": "string", "minLength": 1, "maxLength": 200 },
    "body": { "type": "string", "minLength": 0, "maxLength": 10000 },
    "ts": { "type": "string", "format": "date-time" },
    "ackOf": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "meta": { "type": "object" }
  },
  "additionalProperties": false
}
```

### `src/schemas/state-history-entry.json`

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://minih.dev/schemas/state-history-entry.json",
  "type": "object",
  "required": ["ts", "side", "from", "to", "reason", "peerStateAtTime"],
  "properties": {
    "ts": { "type": "string", "format": "date-time" },
    "side": { "type": "string", "enum": ["outside", "inside"] },
    "from": { "type": "string", "minLength": 1 },
    "to": { "type": "string", "minLength": 1 },
    "reason": { "type": ["string", "null"] },
    "peerStateAtTime": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": { "type": "string" }
      }
    }
  },
  "additionalProperties": false
}
```

All schemas use absolute `$id` URIs per Prior Learning PL-10 (AJV refs must be absolute).

---

## Quick Reference

```bash
# Outside writes a note to inside agent's inbox
minih outside-send my-agent --type note --subject "phase 2 done" --body "ready for review"

# Outside lists what inside has sent back
minih outside-inbox-list my-agent

# Outside sets its own state
minih state set my-agent --side outside --key phase --value done

# Outside reads either side
minih state get my-agent --side outside
minih state get my-agent --side inside
```

```ts
// Inside agent (MCP tool calls — no IDs needed)
inbox.list({ unread: true })
inbox.send({ type: "ack", subject: "review of phase 2 done", body: "3 issues filed", ackOf: "01J3..." })
inbox.ack({ msgId: "01J3..." })
state.get({ side: "peer" })
state.set({ key: "filesReviewed", value: ["src/auth.ts"] })
state.transition({ to: "complete", reason: "3 issues filed" })
```

---

## Open Questions

### Q1: Should `inbox-snapshot/` be optional (skip if no inbox activity in this run)?

**OPEN** (small): saving zero-byte snapshot files is harmless and keeps the run-folder layout uniform (every run has the same directory tree). But it adds 2 zero-byte files per run.
- Option A: always create (uniform layout)
- Option B: only create if inbox files non-empty (smaller folder)
- **Leaning**: A (uniformity > 0 bytes saved).

### Q2: Snapshot at start-of-run too?

**OPEN** (defer): not needed for v1's use cases. If retro-analysis ever needs "what did this run see at start," can be reconstructed from prior run's snapshot + timestamps. Add `at-start/` subdir later if pain emerges.

### Q3: Is `data` field on state objects free-form or schema-validated?

**OPEN** (defer to per-agent schemas): in v1, the system schema only validates the outer shape (`phase`, `data: object`, `updatedAt`, `updatedBy`). The agent can ship its own per-side schema for `data` payload (e.g., `agents/<slug>/outside-state-data-schema.json`) and the runner validates against it on write. Mirror existing pattern with `output-schema.json`.
- **Leaning**: v1 = system schema only (free-form `data: object`); per-agent payload schemas = follow-up enhancement.
