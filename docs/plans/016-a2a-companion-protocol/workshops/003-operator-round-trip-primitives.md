# Workshop: Operator round-trip primitives (MW1 / MW2 / MW5 cluster)

**Type**: CLI Flow + API Contract
**Plan**: 016-a2a-companion-protocol
**Spec**: (no formal spec — informs three deferred magicWands tied to FX003)
**Created**: 2026-05-02
**Status**: Draft

**Related Documents**:
- `../companion-experience-plan.md` § Deferred follow-ups (MW1, MW2, MW5)
- `../fixes/FX003-driving-from-outside-docs.md` (the docs side; this workshop is the CLI/tooling side)
- `../../../how/companion-mode.md` (current operator protocol)
- `agents/coordination-smoke-test/outside.md`, `agents/demo-companion/outside.md` (the patterns that sleep+cat their way around the missing primitives today)

**Domain Context**:
- **Primary**: `cli` (new commands + new flag semantics + doctor checks)
- **Related**: `runner` (the existing `pollInboxLane` / `appendInboxMessage` already does the heavy lifting; we only add a CLI surface)

---

## Purpose

Three magicWands point at the same gap on the **operator side**: when a human (or another agent acting as operator) drives a coordinated minih agent from outside, the round-trip primitives (send → wait for reply → ack-of-id) are foot-gunned. There's no `send-and-wait` one-shot, no warning when an `outside.md` teaches the wrong pattern, and a quiet `[]` when an operator passes a cross-lane id to `--after`.

This workshop designs three small operator-side primitives so the round-trip stops biting people the way it bit me during the live demo (and the way it'll bite every third-party agent author who copies our existing `outside.md` patterns).

## Key Questions Addressed

- What's the right shape for `outside send-and-wait` — a new top-level command, or a flag on `outside inbox send`?
- How does `--after` behaviour change so cross-lane ids stop returning silent `[]`?
- What's the smallest doctor heuristic that catches `sleep+cat` foot-guns without false positives?
- How does this cluster relate to FX003's docs work?

---

## 1. Why these three magicWands belong together

| MW | Symptom | Root cause | Where it lives |
|---|---|---|---|
| MW1 | `outside send` then `inside inbox list --wait --after ...` is the canonical round-trip but takes two commands and a watermark capture step | No one-shot primitive; FX003 documents the pattern but the pattern itself is verbose | `cli/commands/outside.ts` — new `send-and-wait` subcommand |
| MW2 | New agent authors `cat agents/<slug>/inbox/inside/messages.ndjson` after a `sleep N` because that's what our existing `outside.md` files teach. Doctor doesn't warn. | `outside.md` is a freeform doc the linter doesn't touch | `cli/commands/doctor.ts` — new heuristic check |
| MW5 | `inside inbox list --after <outside-msg-id>` returns `[]` instead of failing loud or comparing by timestamp | `--after` requires the id to exist in the lane being listed; cross-lane ids look like "no entries newer" | `runner/inbox-poll.ts:161-164` — `--after` fallback semantics |

**Shared narrative**: the operator's natural mental model is *"I sent a message; I want what came after it on the other side"*. Our primitives lock that mental model out:
- They force operators into a manual two-step (no `send-and-wait`).
- They silently fail when operators reach for the obvious cross-lane watermark (MW5).
- They don't catch operators reaching for `sleep+cat` even though we know that pattern is wrong (MW2).

**One coherent fix**: provide the natural primitive (MW1), make watermarks robust (MW5), and warn when authors avoid both (MW2). Together they make the FX003 how-to half as long because the right thing is also the obvious thing.

---

## 2. MW1 — `outside send-and-wait`

### 2.1 Shape

```
minih outside send-and-wait <slug>
  [--run <runId>]
  --type <type>
  --subject <subject>
  --body <body>
  [--ack-of <msgId>]              # threads under an existing inbox message
  --wait <ms>                     # required; same range as `inside inbox list --wait` (≤300_000)
  [--match-types <t,t,...>]       # optional; restrict the reply types we wait for
  [--match-ack-of-self]           # optional; only return replies whose .ackOf is this send's id
  [--strict-peer]                 # forwarded to outside inbox send (refuse on deaf peer)
```

The command is the composition of two existing operations:
1. `outside inbox send` (writes the outside message; captures its id)
2. `inside inbox list --wait <ms> --after <id>` (where `--after` semantics are the one MW5 is fixing — see § 3)

### 2.2 Output envelope

```jsonc
{
  "command": "outside.send-and-wait",
  "status": "ok",
  "data": {
    "slug": "demo-companion",
    "runId": "...",
    "sent": {
      "messageId": "01KQH...",
      "type": "task",
      "subject": "...",
      "ts": "..."
    },
    "replies": [
      // inside-lane messages whose ackOf matches `sent.messageId`,
      // OR (when --match-ack-of-self is OFF) any inside messages newer
      // than `sent.messageId` filtered by --match-types if given.
      {
        "id": "01KQH...",
        "type": "summary",
        "subject": "...",
        "body": "...",
        "ackOf": "01KQH...",      // sent.messageId
        "ts": "..."
      }
    ],
    "wait": {
      "requestedMs": 60000,
      "elapsedMs": 8423,
      "timedOut": false,
      "matched": "live"            // 'pre-existing' | 'live' | 'mixed' | 'timeout'
                                   // (same enum as wait_for_any post-MW6)
    },
    "peer": { ... }                // forwarded from underlying send
  }
}
```

### 2.3 Behaviour matrix

| Reply situation | Output |
|---|---|
| Inside replies threaded with matching `ackOf` arrive within the wait | `replies[]` populated; `timedOut: false`; `matched: 'live'` |
| Wait expires with no reply | `replies: []`; `timedOut: true`; `exitCode: 0` (timeout is not an error) |
| Inside replies arrive but `--match-ack-of-self` is set and none thread to our send | `replies: []`; `timedOut: false`; `matched: 'live'` (we received events, but none matched the strict filter) |
| Send fails (e.g. agent not running) | normal error envelope from `outside inbox send`; no wait attempted |

### 2.4 Why a new top-level command, not a flag

Considered alternatives:
- **`outside inbox send --wait <ms>`**: cleanest one-line ergonomics, but the existing `send` doesn't return a list of inbox messages — its envelope shape differs. Adding `--wait` would silently change return shape based on flag presence. Bad.
- **Two-step with helper script**: what FX003 documents today. Verbose; the watermark capture step is exactly what MW5 makes fragile.
- **`minih outside roundtrip <slug>`**: more general name, but then we need to define what "round-trip" means — it's specifically send-then-wait, so the verb-pair name is clearer.

**Decision**: `outside send-and-wait` as a sibling of `outside inbox send` and `outside state set`. Composes existing primitives; no new I/O.

### 2.5 What this command is NOT

- Not a polling loop. One send, one wait, one exit.
- Not a multi-message thread tracker. The wait ends at first reply (or first matching reply if `--match-types` is set). Operators wanting longer sessions still iterate manually.
- Not synchronous in the sense that the agent has finished. The agent may still be working when a reply lands; this command just bridges the most common operator pattern.

---

## 3. MW5 — `--after` cross-lane semantics

### 3.1 Today's behaviour (the bug)

```ts
// src/runner/inbox-poll.ts:161-164
if (options.after !== undefined) {
  const index = visible.findIndex((m) => m.id === options.after);
  visible = index === -1 ? [] : visible.slice(index + 1);
}
```

If `options.after` doesn't exist in the lane being listed, `visible = []`. Cross-lane ids ALWAYS hit this path because outside ids never appear in the inside lane.

### 3.2 Three options

**Option A — fail loud on unknown id.** Return an error code (`E175 AFTER_ID_NOT_FOUND`) when `options.after` isn't in the lane.
- Pros: explicit; impossible to silently miss.
- Cons: breaks current callers that intentionally pass an opaque cursor expecting `[]` if it's stale (e.g. MCP `inbox_list` post-pruning).

**Option B — interpret `--after` by ULID timestamp.** ULIDs are sortable; if the id isn't in the lane, fall back to ordering by `ts` and slice messages whose `ts > after.ts`. To extract `after.ts`, decode the ULID's first 48 bits.
- Pros: matches the natural mental model exactly. The operator's semantics ("everything newer than this") are preserved regardless of which lane the id was generated in.
- Cons: relies on ULID monotonicity (true in our ULID generator), and on the receiver having a way to decode a foreign id's timestamp without fetching the foreign lane.

**Option C — accept `--after-ts <iso>` as a sibling flag.** Operators who want timestamp-based slicing pass that explicitly; `--after <id>` keeps strict same-lane semantics with a doctor-style warning when the id isn't found.
- Pros: explicit, no breaking change to `--after`, no ULID-timestamp coupling.
- Cons: two flags doing similar things; FX003 has to teach which to use.

### 3.3 Recommendation: Option B with a safety valve

Implement **Option B** (decode ULID timestamp; slice by `ts > after.ts`). This is the operator-friendly default and matches their mental model.

Add an opt-in **`--after-strict`** flag (or env var `MINIH_AFTER_STRICT=1`) that restores Option A's "fail if id not in lane" behaviour for tests / scripted callers that need exact-match semantics.

ULID timestamp decode is 11 lines of code (Crockford-base32 decode of the first 10 chars → ms since epoch). The cost is small; the operator-experience win is large.

### 3.4 Concrete implementation sketch

```ts
// inbox-poll.ts
function decodeUlidTimestamp(id: string): number {
  const TIME_LEN = 10;
  // Crockford-base32 alphabet
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ms = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const idx = ALPHABET.indexOf(id[i]?.toUpperCase() ?? '');
    if (idx < 0) throw new Error(`bad ULID char: ${id[i]}`);
    ms = ms * 32 + idx;
  }
  return ms;
}

if (options.after !== undefined) {
  const sameLaneIdx = visible.findIndex((m) => m.id === options.after);
  if (sameLaneIdx >= 0) {
    visible = visible.slice(sameLaneIdx + 1);
  } else if (options.afterStrict) {
    visible = [];
  } else {
    // Cross-lane / pruned id — slice by decoded ULID timestamp
    try {
      const cutoffMs = decodeUlidTimestamp(options.after);
      visible = visible.filter((m) => Date.parse(m.ts) > cutoffMs);
    } catch {
      visible = [];  // unparseable id — preserve current quiet behaviour
    }
  }
}
```

### 3.5 Documentation impact (FX003)

FX003's how-to gets simpler. Today:

> ⚠ Capture the **last inside id** before sending; pass that to `--after`. Cross-lane ids return `[]`.

After MW5:

> Capture the id of any recent message; `--after` slices everything newer regardless of lane.

The cognitive load drop is meaningful — operators were having to learn a watermark-capture step that doesn't add value.

---

## 4. MW2 — `doctor` warning for `sleep+cat` foot-guns

### 4.1 Pattern to detect

```bash
sleep N
cat ...inbox/...messages.ndjson
# OR
sleep N
cat ...state/inside.json
# OR
sleep N
minih inside inbox list ...
```

Each of these is a synchronous-poll-with-prayer pattern that the post-FX003 canonical alternatives (`--wait`, `send-and-wait`) replace cleanly.

### 4.2 Heuristic

A doctor check `outside.md-poll-pattern` runs on each coordinated agent's `outside.md`. It looks for:

1. `sleep <N>` followed within 5 lines by `cat ...inbox/...` or `cat ...state/...`
2. `sleep <N>` followed within 5 lines by `minih inside inbox list` WITHOUT `--wait` on the same line
3. `while [...] do; ...; sleep N; done` polling loops (looser; emit MEDIUM if confident)

Severity: **warning** (not error). Authors may have legitimate reasons to demonstrate manual polling for debugging.

### 4.3 Output

```
⚠  outside.md-poll-pattern: line 14 — `sleep 3 && cat agents/<slug>/inbox/inside/messages.ndjson`
   Operators reading this learn polling-with-sleep instead of the canonical
   `inside inbox list --wait` pattern. See docs/how/driving-an-agent-from-outside.md.
```

### 4.4 Why warning, not error

Three reasons:
1. **Compatibility**: existing `outside.md` files in the repo (`coordination-smoke-test`, `code-review-companion`) have these patterns. Erroring would break `doctor` for repos in flight.
2. **Some patterns are intentional**: e.g. `sleep` between sends to stagger demos, where a `cat` of an unrelated file follows. False-positive risk.
3. **Doctor's role is to inform, not block**: per the existing pattern (`outside.md-drift`, `outside.md-size` are both warnings, never errors).

The warning surfaces during `just fft` and during operator-time `minih doctor` calls. FX003-7's discoverability hooks (init welcome, doctor pointer, README link) make sure operators see the canonical doc when they hit the warning.

### 4.5 False-positive defenses

- Skip the check if the file has fewer than 8 lines (probably a stub).
- Don't flag `sleep` inside fenced code blocks marked as `bash # not recommended` (extension-style: comments-as-suppression).
- Make the regex strict enough that bare `sleep 1` (no following `cat`) doesn't match.

---

## 5. How this cluster relates to FX003

FX003 is the **docs side** of the operator round-trip story (canonical how-to + scaffolding fix + drift sweep). This cluster is the **CLI side** of the same problem. They want to ship together:

| FX003 task | Companion in this workshop |
|---|---|
| FX003-1 new how-to page | Documents `send-and-wait` (MW1), the new `--after` semantics (MW5), and links to `doctor`'s warning (MW2) |
| FX003-5 init scaffolding | The scaffold's `OUTSIDE_TEMPLATE` should use `send-and-wait` (MW1) — not the two-step pattern |
| FX003-7 discoverability hooks | `doctor` MW2 warning fires on the legacy pattern; pointer to the new how-to is part of the warning text |

**Sequencing**: this cluster's fix dossiers would land before FX003 ships — FX003 documents the post-fix world, not the current one. If FX003 lands first, it'll need an immediate update once these CLI changes ship.

---

## 6. Migration plan (per-magicwand fix dossiers)

| Order | Fix | Rationale |
|---|---|---|
| 1 | **MW5 `--after` ULID-timestamp fallback** | Smallest scope; unblocks the natural mental model immediately; safest to ship first |
| 2 | **MW1 `send-and-wait`** | Builds on MW5's improved watermark semantics; easier to test cleanly when `--after` already works |
| 3 | **MW2 doctor `sleep+cat` warning** | Lands after MW1 so the warning text can point at the correct alternative |
| 4 | (FX003 absorbs the docs work) | Updates the canonical how-to to teach the post-MW1 patterns |

---

## 7. Worked example — the demo's Step 3, BEFORE vs AFTER

### BEFORE (today, what the failing demo did)

```bash
# Step 3: send Round 1 task and block on inside reply
WATERMARK=$(npx minih inside inbox list demo-companion --run "$RUN" 2>/dev/null \
  | jq -r '.data.messages | last | .id')
TASK=$(npx minih outside inbox send demo-companion --run "$RUN" \
  --type task --subject "Round 1: ..." --body "..." 2>/dev/null \
  | jq -r '.data.messageId')
npx minih inside inbox list demo-companion --run "$RUN" \
  --wait 60000 --after "$WATERMARK" 2>/dev/null \
  | jq '.data.messages | map({type, subject, ackOf})'
```

Three commands, manual watermark capture, jq pipelines, hidden bug if I capture watermark from outside lane (because of MW5's silent `[]`).

### AFTER (post-MW1+MW5)

```bash
npx minih outside send-and-wait demo-companion --run "$RUN" \
  --type task --subject "Round 1: ..." --body "..." \
  --wait 60000 --match-ack-of-self 2>/dev/null \
  | jq '.data.replies | map({type, subject})'
```

One command. The `--match-ack-of-self` flag does what the operator means: "only return replies threaded to the message I just sent". No watermark capture. No cross-lane confusion.

---

## 8. Quick reference

```bash
# Operator round-trip — one command
minih outside send-and-wait <slug> --run <runId> \
  --type task --subject "..." --body "..." \
  --wait 60000 --match-ack-of-self

# Watermark watching (MW5 — works regardless of which lane the id came from)
minih inside inbox list <slug> --run <runId> --wait 30000 --after <any-id>

# Doctor warning (MW2)
minih doctor
# ...
# ⚠  outside.md-poll-pattern: line 14 — sleep+cat pattern detected
#    Use `inside inbox list --wait` or `outside send-and-wait` instead.
```

---

## 9. Open questions

### Q1: Should `send-and-wait`'s default behaviour be `--match-ack-of-self ON`?

**RESOLVED**: yes, default ON. The natural operator model is "I sent X, give me replies to X". The opt-out (`--no-match-ack-of-self`) is for callers who want any newer reply regardless of threading (rare).

### Q2: Should `--after` ULID-timestamp fallback be opt-in instead of opt-out?

**RESOLVED**: opt-out via `--after-strict`. The existing default (silent `[]` on cross-lane) is wrong for the natural mental model; making the right thing opt-in would punish operators reaching for the obvious primitive.

### Q3: How does this cluster interact with workshop 002's MW6 `wait_for_any` pre-existing pre-render?

**RESOLVED**: orthogonal but compatible. `send-and-wait` calls into `inside inbox list --wait` which goes through the existing `pollLaneAndEmit`, not the MCP-side `wait_for_any`. MW6's MCP fix doesn't touch this path. If a future unification makes them share a primitive, both already produce the same `matched` enum (`'pre-existing' | 'live' | 'mixed' | 'timeout'`).

### Q4: What about `inside send-and-wait`?

**OPEN**: not in scope. Inside-side wait is `wait_for_any` (an MCP tool the agent already has). Adding a CLI version is out-of-scope (CLI doesn't drive inside writes).

### Q5: Does the doctor warning fire on `dist/templates/`?

**OPEN — must check during implementation**: the doctor walks `agents/`. If we add the warning to the scaffold template, that template AND the dogfood `_shared` should NOT trigger the warning text mistakenly. Concrete check: `dist/` shouldn't be walked by `doctor`. (Verify against `src/cli/commands/doctor.ts:resolvedDir`.)

### Q6: Should `send-and-wait` accept a list of expected reply types and fail when an unexpected type arrives?

**OPEN**: probably not. `--match-types <t,t,...>` filters; anything not in that list is ignored (still arrives in the lane, just not in `replies`). Erroring on "unexpected" behaviour is overreach for a generic CLI primitive.

---

## 10. Out of scope for this workshop

- **Workshop 002 cluster** (MW4 counters / MW6 wait_for_any pre-existing / MW7 farewell auto-derive) — different surface (MCP / runner manifest / inbox aggregation).
- **Workshop 004 cluster** (MW3 polling badge / MW8 reason lifting) — view-surface concerns, not operator round-trip.
- **An `inside send-and-wait`** — unsuitable for CLI; agents use `wait_for_any`.
- **A hardcoded retry loop in `send-and-wait`** — out of scope; if the operator wants retry-on-timeout semantics, that's shell-level (`while ... do ... done`).

---

**Implementation note**: this workshop produces no code. It defines three fix dossiers (FX008 `--after` ULID fallback, FX009 `send-and-wait`, FX010 doctor poll-pattern warning) ready for `/plan-5 --fix` when a session has appetite. FX003 should hold until at least MW5 lands so its canonical examples teach the post-fix patterns.
