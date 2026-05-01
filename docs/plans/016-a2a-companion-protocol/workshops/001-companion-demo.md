# Workshop: Two-Screen Companion Demo (`demo-companion`)

**Type**: Integration Pattern + CLI Flow
**Plan**: 016-a2a-companion-protocol
**Spec**: (no spec — informs research-dossier.md § 4 mapping)
**Created**: 2026-05-01
**Status**: Draft

**Related Documents**:
- `../research-dossier.md` — A2A vs minih companion mapping
- `../../../how/companion-mode.md` — Power On Mode protocol
- `agents/code-review-companion/prompt.md` — canonical companion exemplar
- `agents/coordination-smoke-test/outside.md` — outside-script pattern

---

## Purpose

Provide a **runnable, two-screen demo** that exercises every coordination primitive minih currently supports — inbox types, `ackOf` reply chains, state transitions (inside + outside), `wait_for_any`, `control:stop`, farewell envelope — in a five-minute live walkthrough.

This workshop:
1. Designs `demo-companion`, a chatty conversational companion built specifically to demonstrate back-and-forth comms.
2. Specifies the exact two-screen demo script the operator runs in screen B while the companion runs in screen A.
3. Annotates each step with which coordination primitive is being demonstrated, and the A2A equivalent (so the demo doubles as evidence for the research dossier's mapping table).

## Key Questions Addressed

- Which companion primitives need to fire to constitute a complete demo?
- What's the smallest companion design that exercises all of them without contrived behaviour?
- What's the exact command-by-command script the operator runs in screen B?
- Where's the A2A correspondence on each step (so we can point to live evidence when discussing the research dossier)?

---

## 1. Demo overview

Two terminals side-by-side:

```
┌────────────────────────────────────┐ ┌────────────────────────────────────┐
│ SCREEN A (companion)               │ │ SCREEN B (operator)                │
│                                    │ │                                    │
│  $ npx minih run demo-companion \  │ │  $ npx minih outside ...           │
│      --human                       │ │  $ npx minih state ...             │
│                                    │ │  (drives the conversation)         │
│  Live TUI shows:                   │ │                                    │
│   - inbox stream                   │ │                                    │
│   - state timeline                 │ │                                    │
│   - thinking + tool calls          │ │                                    │
│   - workbench (state snapshot)     │ │                                    │
└────────────────────────────────────┘ └────────────────────────────────────┘
```

The operator drives every step from screen B; the companion reacts in screen A. Roughly 5 minutes start-to-finish.

## 2. Coordination primitives the demo must exercise

| # | Primitive | Visible where | A2A equivalent |
|---|-----------|---------------|----------------|
| P1 | Boot a coordinated run | Screen A: TUI mounts | Agent server starts |
| P2 | `briefing`-typed inbox send | A: row appears | `message/send` (initial) |
| P3 | Inside `state_transition` (idle→reading→reporting→idle) | A: workbench timeline | `Task.status` updates |
| P4 | Inside `inbox_send` reply with `ackOf` (chained reply) | A: ⇄ icon in workbench | `Task.contextId` threading |
| P5 | Inside `inbox_send` of `type=question` setting state to `blocked` | A: "blocked" status row | `Task.status = input-required` |
| P6 | Outside replies to question with `--ack-of` | A: companion unblocks | Client supplies input-required input |
| P7 | Outside `state set` (operator changes outside-state) | A: outside timeline row | (no native A2A; client-side state) |
| P8 | `wait_for_any` long-poll (inbox + state.peer.changed) | A: thinking pause then resume | `message/stream` SSE |
| P9 | `directive` mid-task (no restart, scope change) | A: progress row "narrowing scope" | (custom; A2A has no native equivalent) |
| P10 | `control:stop` graceful shutdown | A: "stopping" row | `tasks/cancel` (soft variant) |
| P11 | Farewell envelope at `$MINIH_OUTPUT_PATH` | B: `cat report.json` | Terminal `Task.status = completed` + final `Artifact` |
| P12 | Auto-harvest retro (magicWand → `docs/retros/`) | B: file appears post-stop | (out of band; minih ledger) |

A complete demo touches all 12.

## 3. `demo-companion` design

A small companion whose *only* job is to be conversational and demonstrably exercise the primitives above. Not a code reviewer, not a validator — a friendly demo partner.

### 3.1 Persona

> "You are a curious companion who likes to think out loud. The operator will brief you on a topic, send you small tasks, and occasionally ask questions. You reply briefly, threaded with `ackOf`, and occasionally ask a clarifying question of your own — which forces the operator to reply before you continue. When the operator flips outside-state, you notice and acknowledge."

Keep it deliberately small — three or four files at most, no instructions.md needed.

### 3.2 File layout

```
agents/demo-companion/
├── prompt.md               # frontmatter + persona + loop + reply rules
├── output-schema.json      # farewell envelope shape
└── outside.md              # the operator script (this doubles as the demo guide)
```

### 3.3 Frontmatter

```yaml
---
description: "Conversational companion designed for live demos of coordination primitives — back-and-forth, threaded replies, state transitions, question/answer rounds."
tags: [demo, coordination, companion, exemplar]
model: gpt-5.5
timeout: 1800
coordination: enabled
---
```

`timeout: 1800` (30 min) is plenty for a demo session. `gpt-5.5` per repo convention.

### 3.4 Reply rules (load-bearing)

Every reply MUST include `ackOf` set to the inbox message that prompted it. This is what makes the workbench's ⇄ correlation lines appear in the human view.

| Inbound type | Inside response | `ackOf`? |
|---|---|---|
| `briefing` | `progress` (greeting + topic acknowledged) | yes |
| `task` | one or two `finding` messages + ONE `question` message | yes (all three) |
| `question` | one `summary` reply | yes |
| `directive` | one `progress` ack ("narrowing scope to: X") | yes |
| `control` (stop) | `farewell` | no |
| state.peer.changed | one `progress` row noting the outside-state flip | no (no inbox source to ack) |

### 3.5 State vocabulary

Smaller than code-review-companion's:

| status | When |
|---|---|
| `idle` | Long-polling for the next inbox message or peer-state flip |
| `reading` | Just received a task; loading context |
| `reporting` | Composing reply (findings + a question) |
| `blocked` | Sent a question; waiting on operator |
| `stopping` | `control:stop` received; writing farewell |

Use `state_transition` not `state_set` so transitions appear in the workbench timeline.

### 3.6 The loop (pseudocode in prompt.md)

```text
boot:
  state_transition status='idle', reason='ready for briefing'
  loop until briefing arrives or 5 min elapses

main loop:
  state_transition status='idle' (only if not already idle)
  result = inbox_list({
    unread: true,
    waitMs: 30000,
    waitForAny: ['task', 'question', 'directive', 'control', 'briefing']
  })
  if result.peerStateChanged:
    inbox_send type='progress' body='Noticed outside state → <new status> (<data.label>)'
    continue
  for msg in result.messages:
    inbox_ack({ id: msg.id })
    if msg.type == 'control' and body matches /^stop\b/:
      goto FAREWELL with exitReason='stop_requested'
    elif msg.type == 'briefing':
      respond_to_briefing(msg)
    elif msg.type == 'task':
      work_task(msg)
    elif msg.type == 'question':
      answer_question(msg)
    elif msg.type == 'directive':
      acknowledge_directive(msg)

FAREWELL:
  state_transition status='stopping'
  inbox_send type='farewell' body='Demo complete.'
  write farewell envelope to $MINIH_OUTPUT_PATH
  exit
```

### 3.7 Output schema (farewell envelope)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Demo Companion Farewell Envelope",
  "type": "object",
  "additionalProperties": true,
  "required": ["session", "conversation", "summary", "retrospective"],
  "properties": {
    "session": {
      "type": "object",
      "required": ["startedAt", "endedAt", "exitReason", "messageCounts"],
      "properties": {
        "startedAt": {"type": "string"},
        "endedAt": {"type": "string"},
        "exitReason": {
          "type": "string",
          "enum": ["stop_requested", "idle_budget", "timeout", "error"]
        },
        "messageCounts": {
          "type": "object",
          "required": ["briefingsReceived", "tasksReceived", "questionsAsked", "questionsAnswered", "directivesReceived"],
          "properties": {
            "briefingsReceived": {"type": "integer", "minimum": 0},
            "tasksReceived": {"type": "integer", "minimum": 0},
            "questionsAsked": {"type": "integer", "minimum": 0},
            "questionsAnswered": {"type": "integer", "minimum": 0},
            "directivesReceived": {"type": "integer", "minimum": 0}
          }
        }
      }
    },
    "conversation": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["round", "topic"],
        "properties": {
          "round": {"type": "integer", "minimum": 1},
          "topic": {"type": "string"},
          "highlights": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "summary": {"type": "string", "minLength": 30},
    "retrospective": {
      "type": "object",
      "required": ["magicWand", "magicWandTarget"],
      "properties": {
        "magicWand": {"type": "string", "minLength": 10},
        "magicWandTarget": {
          "type": "string",
          "enum": ["project", "minih", "coordination"]
        },
        "notes": {"type": "string"}
      }
    }
  }
}
```

---

## 4. The demo script (Screen B operator commands)

Run this as a guided walkthrough. Each step says:
- **Operator** — the command to run in screen B
- **Companion** — what should happen in screen A
- **Demonstrates** — the primitives + A2A correspondence

### Step 0 — Pre-flight

```bash
# Make sure we're using the latest build
just fft  # or: npm run build
```

### Step 1 — Boot the companion (screen A)

**Operator (screen A)**:
```bash
npx minih run demo-companion --human
```

**Companion**: TUI mounts. Header shows `demo-companion · running`. Workbench shows `idle` status. Transcript starts streaming.

**Demonstrates**: P1 — boot a coordinated run. *A2A: agent server starts; AgentCard would be published.*

---

### Step 2 — Capture the run id (screen B)

```bash
RUN=$(npx minih status demo-companion 2>/dev/null | jq -r '.data.runId')
echo "Run: $RUN"
```

### Step 3 — Brief the companion

**Operator (screen B)**:
```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type briefing \
  --subject "Topic: TUI rendering quirks" \
  --body "Hi! I want to chat about Ink/Yoga rendering quirks we hit recently. I'll send you tasks; you respond with observations and ask follow-ups. Ready?"
```

**Companion** (screen A): briefing row appears in transcript; `state → reading → reporting → idle`; one `progress`-typed reply rendered with ⇄ correlation arrow back to the briefing.

**Demonstrates**: P2, P3, P4 (initial briefing → reply with `ackOf`). *A2A: this is `message/send` with the response carrying the same `contextId`.*

---

### Step 4 — Send the first task

**Operator (screen B)**:
```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type task \
  --subject "Round 1: rounded borders" \
  --body "We saw ghost border characters with borderStyle='round' under frequent re-renders. Tell me your read on that, and ask me one follow-up question."
```

**Companion** (screen A):
1. State → `reading`, then `reporting`.
2. One or two `finding`-typed replies with `ackOf` set to the task id (e.g., "Yoga pixel rounding leaves residue when subtree re-mounts").
3. One `question`-typed message asking a clarifying question (e.g., "Did the ghost chars persist after switching to `borderStyle='single'`?").
4. State → `blocked` (because a question is outstanding).

**Demonstrates**: P3, P4, P5. *A2A: equivalent to a Task transitioning `working → input-required` with one or more `artifact-update` events along the way.*

---

### Step 5 — Answer the companion's question

First, find the question's message id (screen B):

```bash
QID=$(npx minih outside inbox list demo-companion --run "$RUN" 2>/dev/null \
  | jq -r '.data.messages | map(select(.from=="inside" and .type=="question")) | last | .id')
echo "Question id: $QID"
```

Then answer:

```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type question \
  --subject "Re: ghost chars after single?" \
  --body "Yes — single borders were the same. Only fully dropping the borders fixed it. We use whitespace gaps now." \
  --ack-of "$QID"
```

**Companion** (screen A): unblocks; `state → reporting → idle`; replies with a `summary`-typed message threaded to the answer.

**Demonstrates**: P5, P6 (the round-trip). *A2A: this is the canonical `input-required` flow — client supplies the missing input, task resumes to `working`, then `completed`.*

---

### Step 6 — Flip outside state to demonstrate peer-state listening

**Operator (screen B)**:
```bash
npx minih outside state set demo-companion --run "$RUN" \
  --status in-progress \
  --data-json '{"label":"thinking-out-loud-mode"}'
```

**Companion** (screen A): workbench's outside-state row updates; transcript shows a `progress` row from the companion: *"Noticed outside state → in-progress (thinking-out-loud-mode)"*.

**Demonstrates**: P7, P8 (`wait_for_any` woke on `state.peer.changed`). *A2A: no native equivalent — A2A's state lives on the Task, not on the client.*

---

### Step 7 — Send a directive (mid-stream scope change)

**Operator (screen B)**:
```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type directive \
  --subject "Be terser" \
  --body "Keep replies to one sentence per finding from now on."
```

**Companion** (screen A): one short `progress` row acknowledging the scope change; no state change beyond a brief flicker.

**Demonstrates**: P9. *A2A: no native equivalent; this is metadata-on-message in A2A terms.*

---

### Step 8 — Send round 2 (terser this time)

**Operator (screen B)**:
```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type task \
  --subject "Round 2: emoji width" \
  --body "We hit issues with double-width emoji (💭) throwing off Ink wrap math. Your read?"
```

**Companion** (screen A): one short `finding` reply, threaded; possibly no follow-up question this round (showing the directive took effect).

**Demonstrates**: P3, P4, plus the directive being respected.

---

### Step 9 — Stop the companion

**Operator (screen B)**:
```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type control \
  --subject "stop" \
  --body "stop — demo complete, please write your farewell"
```

**Companion** (screen A): state → `stopping`; `farewell`-typed message in transcript; TUI exits with summary.

**Demonstrates**: P10. *A2A: graceful equivalent of `tasks/cancel` (A2A's cancel is harder; a "soft stop" is project-defined).*

---

### Step 10 — Read the farewell envelope

**Operator (screen B)**:
```bash
RUN_DIR=agents/demo-companion/runs/$RUN
cat $RUN_DIR/output/report.json | jq
```

Expected: a JSON document matching the schema in §3.7 — session metadata, conversation rounds, summary, retrospective with `magicWand`.

**Demonstrates**: P11 (farewell envelope). *A2A: terminal `Task.status = completed` + final `Artifact` named `report.json`.*

---

### Step 11 — Verify retro auto-harvested

```bash
ls docs/retros/ | grep demo-companion
cat docs/retros/demo-companion.md | tail -20
```

Expected: a row appended with the run's `magicWand`.

**Demonstrates**: P12 (auto-harvest). *A2A: out of band; project ledger.*

---

## 5. Reference card (printable cheat-sheet for the operator)

```
┌────────────────────────────────────────────────────────────────────────┐
│ SCREEN A (companion):                                                  │
│   $ npx minih run demo-companion --human                               │
│                                                                        │
│ SCREEN B (operator):                                                   │
│   RUN=$(npx minih status demo-companion 2>/dev/null | jq -r .data.runId)│
│                                                                        │
│   # 1. Brief                                                           │
│   npx minih outside inbox send demo-companion --run "$RUN" \           │
│     --type briefing --subject "Topic" --body "..."                     │
│                                                                        │
│   # 2. Task (companion will reply + ask)                               │
│   npx minih outside inbox send demo-companion --run "$RUN" \           │
│     --type task --subject "Round 1: ..." --body "..."                  │
│                                                                        │
│   # 3. Find companion's question                                       │
│   QID=$(npx minih outside inbox list demo-companion --run "$RUN" \     │
│     2>/dev/null | jq -r '.data.messages | map(select(.from=="inside"\  │
│     and .type=="question")) | last | .id')                             │
│                                                                        │
│   # 4. Answer it                                                       │
│   npx minih outside inbox send demo-companion --run "$RUN" \           │
│     --type question --subject "Re: ..." --body "..." --ack-of "$QID"   │
│                                                                        │
│   # 5. Flip outside state (peer-state demo)                            │
│   npx minih outside state set demo-companion --run "$RUN" \            │
│     --status in-progress --data-json '{"label":"..."}'                 │
│                                                                        │
│   # 6. Directive                                                       │
│   npx minih outside inbox send demo-companion --run "$RUN" \           │
│     --type directive --subject "Be terser" --body "..."                │
│                                                                        │
│   # 7. Stop                                                            │
│   npx minih outside inbox send demo-companion --run "$RUN" \           │
│     --type control --subject "stop" --body "stop — demo complete"      │
│                                                                        │
│   # 8. Read farewell                                                   │
│   cat agents/demo-companion/runs/$RUN/output/report.json | jq          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. What this demo produces (artefacts to keep)

After a full run:

1. **Screenshot of screen A's TUI** at peak conversation — shows transcript, workbench timeline, state snapshot. (Companion-mode evidence.)
2. **Farewell envelope** at `agents/demo-companion/runs/<RUN>/output/report.json` — exemplar of a clean farewell with session, conversation, summary, retrospective.
3. **Inbox NDJSON** at `agents/demo-companion/runs/<RUN>/inbox/inbox-inside.ndjson` — replayable conversation log.
4. **Retro row** at `docs/retros/demo-companion.md` — proof auto-harvest fires.

These are the concrete evidence that backs the research dossier's mapping table.

---

## 7. Open questions

### Q1: Does the companion ask a question on EVERY task or only sometimes?

**RESOLVED**: Only on round 1 (and again post-directive if the directive doesn't say "no questions"). Asking on every task makes the demo tedious; never asking removes a primitive from the demo. Round 1 = ask; round 2 = no ask (directive took effect).

### Q2: Should we use `wait_for_any` directly in the prompt, or just `inbox_list({waitForAny: [...]})`?

**RESOLVED**: Use `inbox_list` with `waitForAny: [...]` — that's the established companion pattern (per `code-review-companion/prompt.md`). The `wait_for_any` MCP tool is for cases that *also* listen to state changes. The demo's Step 6 (state flip) needs us to listen for state changes too — so the demo prompt SHOULD use `wait_for_any` directly there, or the inbox-list call needs a `state.peer.changed` event included. Use `wait_for_any` for the main loop in the demo for clarity.

### Q3: Should we ship `demo-companion` in the npm package, or keep it dogfood-only?

**OPEN**: Per existing repo convention, dogfood agents are NOT shipped — only `smoke-test` is (per memory: "no need to ship with agents, maybe just ship with one sample"). Recommend keeping `demo-companion` repo-only as a working reference.

### Q4: What if the companion sends MORE than one question and the operator only answers one?

**OPEN**: Out of scope for the demo (we'll only fire one task in round 1, so only one question). For real usage this is a known soft edge — the companion will stay `blocked` until any matching `ackOf` reply arrives.

---

## 8. Why this design

- **Smaller than code-review-companion.** Demo doesn't need source-tree reading, drift audits, or severity rubric. Strip it down so the operator can read the prompt in one screen.
- **Forces the question→answer round.** Most companion demos don't show this; without it the workbench's `blocked` row never appears and the operator never has to think about `--ack-of`.
- **Forces the peer-state flip.** This is the only way to demonstrate `wait_for_any` listening on `state.peer.changed` — a primitive that's otherwise invisible.
- **Forces the directive.** Without a directive, the demo never shows scope-change-without-restart, which is one of the loop's distinguishing features versus a simple request/response.
- **Maps cleanly to A2A.** Each step has an A2A correspondence noted, so the demo doubles as live evidence for the research dossier's §4 mapping table.

---

**Implementation note**: this workshop ships alongside the actual agent files at `agents/demo-companion/` so the demo is runnable immediately. See those files for the concrete prompt + schema.
