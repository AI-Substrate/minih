# Workshop: View surface context lifting (MW3 / MW8 cluster)

**Type**: API Contract + Data Model + Integration Pattern
**Plan**: 016-a2a-companion-protocol
**Spec**: (no formal spec — informs two deferred magicWands tied to view rendering and peer-state visibility)
**Created**: 2026-05-02
**Status**: Draft

**Related Documents**:
- `../companion-experience-plan.md` § Deferred follow-ups (MW3, MW8)
- `../research-dossier.md` § A2A `Task.status.message` (precedent — A2A's Task carries a status message alongside the enum)
- `src/runner/types.ts` (`SideState`, `LiveRunStatus`, peer event payload definitions)
- `src/cli/human/panes/workbench.tsx` (the renderer that's stuck with bare enum pills)

**Domain Context**:
- **Primary**: `runner` (`SideState` extension; peer event payload extension; state-history reverse-lookup helper)
- **Related**: `cli` (`--human` workbench can finally render context once it's there); agent prompts (the convention that nudges agents to populate `data.label`)

---

## Purpose

Two deferred magicWands point at the same underlying disease: **the actionable state context exists on disk in `state/history.ndjson`, but every consumer-facing surface strips it.** Status enums (`idle`, `reading`, `blocked`, …) make it through. The `reason` string ("awaiting answer to: Q1: Which quirk?", "preparing for: Round 2: emoji width") and `data.label` ("thinking-out-loud-mode") get dropped. Peer agents and operators see bare enum pills and have to guess intent.

This workshop designs three small lifts that surface the rich context where it's already useful — the `SideState` envelope, the `state.peer.changed` event payload, and the `--human` workbench's idle-polling indicator — without breaking any current caller.

## Key Questions Addressed

- Where do we read `reason` from at state-read time? Cache it on `SideState`, or read `history.ndjson` lazily?
- What's the right shape for the polling badge — a separate UI element, or absorbed into the existing state pill?
- Should `data.label` become a first-class field, or stay as the convention it is today (free-form `data` blob)?
- How does the peer event payload extension stay backward-compatible?

---

## 1. Why these two magicWands belong together

| MW | Symptom | Root cause | Surface |
|---|---|---|---|
| MW3 | `--human` view's workbench shows a bare state pill (`idle`); during long `wait_for_any` calls there's no signal that the agent is alive-and-polling vs hung | Workbench renders `manifest.status` + last-known `selfReportedState`; doesn't distinguish "polling now" from "stalled" | `cli/human/panes/workbench.tsx` |
| MW8 | `inside state get` returns `{status, data, updatedAt, updatedBy}` only — no `reason`. Peer agents see `state.peer.changed` events without the why. Operators see status enums without intent. | `SideState` is structurally the latest state row; `reason` lives in `history.ndjson` and isn't joined when reading | `runner/types.ts` (`SideState`); `runner/event-wait.ts` (peer event payload); shared preamble (agent convention for `data.label`) |

**Shared narrative**: both magicWands are about *information density on view surfaces*. The lanes (`state/history.ndjson`) carry rich actionable signal; the consumers downsample it. Solving them together means designing one extended `SideState` shape and threading it through every consumer (CLI envelopes, peer events, the workbench renderer).

---

## 2. The state read pipeline today (what we're extending)

```
state/history.ndjson    ← append-only ledger; rich rows with reason + data + updatedAt
       │
       ▼
state/inside.json       ← latest-only snapshot {status, data, updatedAt, updatedBy}
state/outside.json      ← same shape for outside
       │
       ▼  read by:
       ├── cli `inside state get` / `state` / `outside state` envelopes
       ├── mcp `state_get` tool (for peer agents)
       ├── runner peer event emit (for state.peer.changed)
       ├── peer-activity verdict derivation
       └── --human workbench
```

The latest snapshot files are written eagerly and read cheaply, but they intentionally drop `reason` (it's "just" a transition annotation, the snapshot is the authoritative state).

**Lift**: when a consumer reads state, read the **latest matching row from `history.ndjson`** to recover `reason` + `lastTransitionAt`. This is one tail-and-parse on a file that's typically <50KB. Cache the lookup in process for one event tick to avoid repeated reads.

---

## 3. MW8 — Lift `reason` into `SideState`

### 3.1 New shape

```ts
export interface SideState {
  status: string;
  data: Record<string, unknown>;
  updatedAt: string;
  updatedBy: 'inside' | 'outside';
  /** NEW: reason string from the latest matching history.ndjson row.
   *  Null when no row exists (boot state) or the row had no reason. */
  reason: string | null;
  /** NEW: timestamp of the latest transition INTO this status.
   *  Distinct from updatedAt (which moves on every state_set). */
  lastTransitionAt: string | null;
}
```

### 3.2 Where to compute it

Two reasonable seams:

**Option A — at write time.** Every `state_transition` / `state_set` in `runner/state.ts` writes both the snapshot AND a derived "context" file alongside containing `{reason, lastTransitionAt}`. Reads pull from snapshot + context.

**Option B — at read time.** Snapshot stays as today; readers call a small helper `readSideStateWithContext(runDir, side)` that opens the snapshot and tail-reads `history.ndjson` for the latest row matching the snapshot's `status`.

**Recommendation: Option B.** Pure read-side change; doesn't touch the write path. The `history.ndjson` tail-read is cheap (NDJSON, last-line preferred). Adding a sidecar file (Option A) creates a write-coordination concern (must update atomically with the snapshot).

### 3.3 Concrete helper sketch

```ts
// runner/state-context.ts (NEW)
import type { SideState } from './types.js';

export function readSideStateWithContext(
  runDir: string,
  side: 'inside' | 'outside',
): SideState {
  const snap = readSnapshot(runDir, side);  // existing function
  // Tail history.ndjson for the latest row matching snap.status on this side
  const last = readLastMatchingHistoryRow(runDir, side, snap.status);
  return {
    ...snap,
    reason: last?.reason ?? null,
    lastTransitionAt: last?.ts ?? null,
  };
}
```

`readLastMatchingHistoryRow` reverses through `history.ndjson` (it's small) and returns the first row whose `side` matches and whose `to === snap.status`. ~15 lines.

### 3.4 Surfaces that benefit

Once `SideState` carries `reason`, every existing consumer gets it for free:

| Surface | Today's payload | Post-MW8 |
|---|---|---|
| CLI `inside state get` envelope | `{status, data, updatedAt, updatedBy}` | `{status, data, updatedAt, updatedBy, reason, lastTransitionAt}` |
| MCP `state_get` tool result | same | same |
| `state.peer.changed` event payload | `{newState: <SideState>}` | `{newState: <SideStateWithReason>}` |
| `--human` workbench state pill | `idle` | `idle · briefed` (status + reason snippet) |
| `outside inbox send` peer block | `selfReportedState: 'idle'` | `selfReportedState: 'idle', selfReportedReason: 'briefed'` |

### 3.5 Backward compatibility

- Existing fields unchanged.
- New fields nullable. Consumers that don't know about them ignore them.
- TypeScript callers building `SideState` literally (rare; mostly tests) compile-error on missing `reason`/`lastTransitionAt` — that's caught at build time, not runtime.

---

## 4. MW8 (continued) — `data.label` convention

### 4.1 Today

Schema permits `data: object`. Some agents stuff things in `data` (the demo's `data.label = 'thinking-out-loud-mode'`); most don't. The workbench has no convention to render.

### 4.2 New convention

Adopt `data.label` as the canonical operator-friendly status variant. Render in this order:

1. If `data.label` is a non-empty string → use as the primary visible label
2. Otherwise → use `status` enum value verbatim
3. In both cases → if `reason` is non-null → render as a secondary line / tooltip

### 4.3 Where the convention lives

Three places:

**Shared preamble** (already touched by FX002-4 for schema-rejection handshake):

> When you `state_transition`, you may set `data.label` to a short operator-friendly string describing what you're doing (e.g. `'reading-spec'`, `'fixing-tests'`, `'awaiting-answer'`). This becomes the primary label rendered in the human view; otherwise the status enum is used.

**Default state schemas** (`src/schemas/inside-state.json` and the per-agent schemas):

> Add a comment to `data.properties.label` documenting the convention. Optional `string`, no enum constraint.

**Workbench renderer**:

> Implement the precedence rule above.

### 4.4 What this is NOT

- Not a replacement for `status`. The enum stays as the machine-readable state.
- Not a free-text-fest. Agents are nudged toward kebab-case short labels via the preamble.
- Not enforced by schema. Convention only.

---

## 5. MW8 (continued) — Peer event payload extension

### 5.1 Today

```jsonc
{
  "kind": "state.peer.changed",
  "ts": "2026-05-01T07:51:41.905Z",
  "data": {
    "newState": {
      "status": "in-progress",
      "data": { "label": "thinking-out-loud-mode" },
      "updatedAt": "2026-05-01T07:51:41.779Z",
      "updatedBy": "outside"
    }
  }
}
```

Peer agent sees `status` and `data.label` (if the writer populated it). No `reason`.

### 5.2 Post-MW8

```jsonc
{
  "kind": "state.peer.changed",
  "ts": "2026-05-01T07:51:41.905Z",
  "data": {
    "newState": {
      "status": "in-progress",
      "data": { "label": "thinking-out-loud-mode" },
      "updatedAt": "2026-05-01T07:51:41.779Z",
      "updatedBy": "outside",
      "reason": "operator declared engaged",     // NEW
      "lastTransitionAt": "2026-05-01T07:51:41.779Z"  // NEW
    },
    "delta": {                                    // NEW (additive)
      "fromStatus": "idle",
      "toStatus": "in-progress",
      "fromReason": null,
      "toReason": "operator declared engaged"
    }
  }
}
```

The `delta` block is the second piece of the MW8 lift — peer agents reacting to state changes shouldn't have to remember the prior status. Today they need to track it themselves; the new payload includes the transition explicitly.

### 5.3 Why include `delta` separately from the `newState`

- **Peer agents writing `if (newState.status === 'blocked')` already work** — backward-compat preserved.
- **Peer agents writing `if (delta.fromStatus !== 'blocked' && delta.toStatus === 'blocked')`** — the "edge detection" pattern — no longer need to maintain their own snapshot.
- **Self-state changes** (where you're the writer) can emit `delta.fromReason === delta.toReason` to indicate `data` changed without a status transition.

---

## 6. MW3 — `--human` polling badge

### 6.1 Today

Workbench renders state pill from manifest. During a long `wait_for_any` call, the pill stays at `idle` (or the last self-reported state). No signal of "currently waiting for input" vs "stalled".

### 6.2 Proposal: composite pill

The state pill becomes two-part:

```
[ idle · polling 27s ]      ← left: status (+ data.label per MW8)
                              right: poll-status indicator
```

**Status part** (left):
- Per MW8: `data.label` if set, else `status` enum.
- Reason rendered below as a thin grey line when present.

**Poll-status part** (right):
- `polling Ns` (active poll window remaining; warm cyan)
- `idle Ns` (between polls — `now - lastPollAt` since the last `wait_for_any` returned)
- `stalled` (no poll for >2 × normal cadence; warm orange)
- `dead` (no poll for >30min — already today's `peer.dead` heuristic; red)
- (empty) for non-coordinated runs

### 6.3 Where the data comes from

The existing `derivePeerActivity` (in `runner/peer-activity.ts`) already computes `currentlyPolling`, `pollWindowEndsAt`, `lastPollAt`, `idleSinceMs`. The workbench just needs to consume them.

The `peer-activity` derivation runs lazily today (only on `outside inbox send`). For the workbench to show a live indicator, it'd need to either:
- **Poll itself** every ~2s (cheap; reads NDJSON tail).
- **Subscribe via `state.self.changed`** — but state changes don't reflect poll cadence.

**Recommendation**: workbench polls `derivePeerActivity` itself every 2s. Cheap; no architectural disruption.

### 6.4 What this is NOT

- Not a heartbeat metric for non-coordinated agents (their state isn't poll-driven).
- Not a replacement for `peer.verdict` (the existing dead/silent/listening derivation). The badge is operator-facing visual info; `peer.verdict` is the canonical machine-readable signal.

---

## 7. Migration plan (per-magicwand fix dossiers)

| Order | Fix | Rationale |
|---|---|---|
| 1 | **MW8a — `SideState` extension** (`reason`, `lastTransitionAt`) | Foundation; every other surface depends on it |
| 2 | **MW8b — peer event payload extension** (delta block) | Builds on 8a; pure additive change |
| 3 | **MW8c — `data.label` convention** (preamble + workbench precedence) | Independent of 8a/b; pure convention + renderer |
| 4 | **MW3 — workbench polling badge** | Last; benefits from 8a's `reason` rendering being already-shipped so the composite pill is cohesive |

8a and 8b can collapse into one fix dossier; 8c and MW3 are separate.

---

## 8. Worked example — peer-state listening, BEFORE vs AFTER

### Scenario
A companion is watching the operator's outside state with `wait_for_any({events: [{kind: 'state.peer.changed'}], waitMs: 30000})`. The operator flips outside state from `idle` to `in-progress` with `data.label = 'reviewing-PR-42'` and `reason = 'started review'`.

### BEFORE (today)
Companion's wait result:
```jsonc
{
  "events": [{
    "kind": "state.peer.changed",
    "ts": "...",
    "data": {
      "newState": {
        "status": "in-progress",
        "data": { "label": "reviewing-PR-42" },
        "updatedAt": "...",
        "updatedBy": "outside"
      }
    }
  }]
}
```
Companion sees `status: in-progress`. To know what was happening before — and what the operator's intent is now beyond the enum — the companion has to:
- Maintain its own snapshot of the prior outside status (extra prompt complexity).
- Read `state/history.ndjson` directly (not exposed via MCP).
- Or just guess.

### AFTER (post-MW8)
```jsonc
{
  "events": [{
    "kind": "state.peer.changed",
    "ts": "...",
    "data": {
      "newState": {
        "status": "in-progress",
        "data": { "label": "reviewing-PR-42" },
        "updatedAt": "...",
        "updatedBy": "outside",
        "reason": "started review",
        "lastTransitionAt": "..."
      },
      "delta": {
        "fromStatus": "idle",
        "toStatus": "in-progress",
        "fromReason": null,
        "toReason": "started review"
      }
    }
  }]
}
```

Companion can now:
- React on `delta.fromStatus === 'idle' && delta.toStatus === 'in-progress'` (edge detection, no local snapshot).
- Render `Operator started "started review" (reviewing-PR-42)` in its own progress message — actionable narration, not enum mush.

This is the PARTICULAR thing that makes inter-agent coordination *useful* rather than just *possible*. Companions should know intent, not just enum.

---

## 9. Quick reference

```bash
# State get with context (MW8)
minih inside state get demo-companion --run "$RUN" 2>/dev/null | jq '.data.state'
# {
#   "status": "blocked",
#   "data": { "label": "awaiting-clarification" },
#   "updatedAt": "...",
#   "updatedBy": "inside",
#   "reason": "awaiting answer to: Q1: Which quirk?",          ← NEW
#   "lastTransitionAt": "..."                                  ← NEW
# }

# Workbench (MW3 — composite pill)
# +-- Inside agent ---------------+
# | [ awaiting-clarification · polling 12s ]
# |   awaiting answer to: Q1: Which quirk?
# +-------------------------------+

# Peer event (MW8b)
wait_for_any({events: [{kind: 'state.peer.changed'}], waitMs: 30000})
# Returns events with newState.{reason, lastTransitionAt} + delta block
```

---

## 10. Open questions

### Q1: Should `reason` be returned by `inside state get` even for non-coordinated agents?

**RESOLVED**: yes — non-coordinated agents have no `state/history.ndjson` so `reason` returns `null` naturally. No special-case needed.

### Q2: Should `data.label` have a length cap?

**OPEN — consider during MW8c implementation**: agents could put paragraphs in `data.label` and break the workbench layout. Suggest a soft cap of 40 chars enforced via doctor warning; not a schema cap (we don't want runtime rejection). Truncation in the renderer with `…` ellipsis.

### Q3: Does the workbench's polling badge polling itself every 2s cause Ink re-render storms?

**OPEN — verify during MW3 implementation**: per memory, frequent re-renders + rounded borders triggered Yoga ghost-char artifacts (which is why we dropped borders). 2s is well below that threshold; should be fine. But test before shipping.

### Q4: Should `delta` be omitted when the change is purely a `state_set` (no status transition)?

**RESOLVED**: emit `delta` always but with `fromStatus === toStatus` when only `data` changed. Peer agents that care about pure status edges check that condition; ones that care about any change get all events.

### Q5: How does this interact with workshop 002's `report_draft`?

**RESOLVED**: orthogonal but compatible. `report_draft` could embed `session.lastReason` from the current `SideState` once MW8 ships. That's a nice-to-have, not a dependency.

### Q6: Should the workbench show outside-state's `reason` AND inside-state's `reason` simultaneously?

**OPEN — UX call during MW3 implementation**: probably yes (workbench has two lanes anyway). Each lane gets its own composite pill + reason line. Verify the layout doesn't push other panes off the visible area.

---

## 11. Out of scope for this workshop

- **Workshop 002 cluster** (MW4 / MW6 / MW7) — different surface (inbox aggregation, not state context).
- **Workshop 003 cluster** (MW1 / MW2 / MW5) — operator round-trip, not view rendering.
- **A new `state.history` MCP tool** for agents who want to read their own transition history. Possible future fix; not in MW3/MW8 scope.
- **Status enum standardization** across all agents — the schema-vocabulary check (FX002-3) is the existing answer.
- **Cross-run state queries** ("what was the outside state at the time of run X?") — different problem entirely.

---

**Implementation note**: this workshop produces no code. It defines four candidate fix dossiers (FX011 SideState extension, FX012 peer event delta, FX013 data.label convention, FX014 workbench polling badge). FX011 is the foundation; FX012/13 are independent additive changes; FX014 is the visible payoff. File via `/plan-5 --fix` per dossier when a session has appetite to land them.
