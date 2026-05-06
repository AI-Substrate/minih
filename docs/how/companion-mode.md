# Companion Mode

A protocol for using a coordinated minih agent as a *companion* to your main work — a reviewer, watcher, or auditor that follows along through implementation rather than running once at the end.

This guide documents the protocol so it works the same way across projects, not just inside minih. Any agent harness that drives a coordinated minih agent can use it.

---

## What is companion mode?

A companion is a coordinated minih agent that:

1. Boots once at the start of a work session.
2. Long-polls the inbox for messages from the outside operator (you / your orchestrator).
3. Acts on each message without exiting.
4. Receives a final `control:stop` signal when the session is over.
5. Writes a **farewell envelope** to its `$MINIH_OUTPUT_PATH` summarising the session.

The canonical implementation is `agents/code-review-companion/` — a reviewer that follows you through commits and reviews each one as you ship. The pattern generalises to other watchers (e.g. a security companion, a docs-drift companion, a metrics watcher).

The opposite pattern — **one-shot agents** — boot, do one task, write output, exit. Companion mode is for work that's longer than one task.

> ⚠️ **Permission requirement**: every companion-mode agent MUST resolve to a policy that permits `write` (so it can ship `output/report.json` at step 5). `minih run` enforces this at boot via the FX008 precondition; agents whose resolved policy denies write are refused with [`E205 COORDINATION_WRITE_DENIED`](./permissions.md#coordinated-agents). If you're authoring a coordination-enabled agent, set `permissions.overrides.write: allow` (or pick a write-permitting preset). See [`permissions.md § Coordinated agents`](./permissions.md#coordinated-agents) for the full message format and remediation paths.

---

## The Power On Mode protocol

"Power On Mode" is the orchestrator-side workflow that pairs with companion-mode agents. The orchestrator drives the work; the companion follows along; pings happen at every commit boundary; the companion fires findings asynchronously without blocking the main work.

The protocol has five phases:

### 1. Boot

**First time per project**: install the companion via the bundled registry. Idempotent — re-running on an existing install upgrades or reports `unchanged`:

```bash
minih agent install code-review-companion
```

If you've authored your own companion or want a third-party one, install via git URL:
`minih agent install github:owner/repo#main:agents/<your-companion> --yes`. See [`agent-pack.md`](./agent-pack.md) for the full install / upgrade / drift surface.

**Then start a run**:

```bash
npx minih run code-review-companion
```

Capture the run ID for use throughout the session:

```bash
RUN_ID=$(npx minih status code-review-companion 2>/dev/null | jq -r '.data.runId')
```

### 2. Brief

Send one `briefing`-typed message naming the plan, the protocol expectations, and what to watch for:

```bash
npx minih outside inbox send <slug> --run "$RUN_ID" \
  --type briefing \
  --subject "Plan NNN: <title> — Power On Mode start" \
  --body "Plan: <path>
Spec: <path>

Protocol:
- I will ping at every commit boundary as type=task with subject 'review-request: T### <sha>'
- Fire-and-forget; reply only if you find issues
- I'll send control:stop when the session ends

Hazards to watch: <list>"
```

The companion long-polls with `waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']`. As long as one of those types arrives within its check-in protocol's wait windows (see [Lifecycle and check-in protocol](#lifecycle-and-check-in-protocol) below), it stays alive.

### 3. Review at every commit boundary

After every meaningful commit during implementation:

```bash
SHA=$(git rev-parse --short HEAD)
npx minih outside inbox send <slug> --run "$RUN_ID" \
  --type task \
  --subject "review-request: T### $SHA" \
  --body "Diff: git show $SHA. Watch for: <specific concerns>. Reply if you find issues."
```

The companion either:
- Replies with one or more `finding`-typed messages targeting the review-request via `ackOf`, or
- Sends a `summary`-typed APPROVE message, or
- Stays silent if the change is fine.

Fire-and-forget — the orchestrator does NOT wait for the companion before moving on. If a finding arrives, address it in the next commit and ping the new SHA.

### 4. Drain (optional but recommended)

When the implementation is done but you haven't reported yet, ping the companion with the final SHA and ask for a full sweep:

```bash
npx minih outside inbox send <slug> --run "$RUN_ID" \
  --type task \
  --subject "review-request: final $SHA — DONE" \
  --body "Final commit. Please scan the entire commit range for: <specific final checks>. I'll send control:stop after I read your reply."
```

This gives the companion one last chance to surface findings that only emerge from looking at the full diff range, not just individual commits.

### 5. Stop and read the farewell

**Send `control:stop` BEFORE reporting back to your operator/user**:

```bash
npx minih outside inbox send <slug> --run "$RUN_ID" \
  --type control \
  --subject "stop — session done" \
  --body "stop — session complete. Please write your farewell envelope and exit."
```

The companion sees the `type:control` message, matches its body against `^stop\b`, transitions to `stopping`, and writes a final report to `$MINIH_OUTPUT_PATH` (typically `agents/<slug>/runs/<runId>/output/report.json`).

Then **read the farewell**:

```bash
RUN_DIR=agents/<slug>/runs/$RUN_ID
cat $RUN_DIR/output/report.json
```

The farewell envelope contains the canonical session record — fold any open findings or retro insights into your operator-facing report.

---

## Why send `control:stop` before reporting back?

Three reasons:

1. **The farewell envelope is the canonical "everything I have to say" record.** The companion may have findings or insights only surfaced in the farewell, not during live review.
2. **Auto-harvest captures the retro for the project ledger.** The companion's `magicWand` and `difficulties` get appended to `docs/retros/<slug>.md` automatically (when minih's auto-harvest is on, which is the default). This is part of how the harness improves itself across sessions — but it only fires when the run completes.
3. **It closes the loop deterministically.** Without a stop signal, the companion now uses a check-in protocol (introduced in plan 019) that asks the orchestrator "still needed?" after a configurable empty-poll streak; if no reply, it exits cleanly with `no_engagement` (first-contact) or `idle_budget` (post-task). See [Lifecycle and check-in protocol](#lifecycle-and-check-in-protocol). Without `control:stop` you still pay extra polling cycles before the check-in fires (typically ~5-10 minutes vs the ~30 min `idleBudgetMs` safety net of older companions), so an explicit `control:stop` remains the cleanest exit.

The pattern: orchestrator owns the lifecycle; the companion's check-in protocol is a fast-failure path, not the primary exit condition.

---

## Control signals

The companion's `prompt.md` defines which control signals it recognises. The canonical signals are:

| Signal | Body match | Effect |
|---|---|---|
| `control: stop` | `^stop\b` | Transition to `stopping`, write farewell envelope, exit. **Always wins** over the check-in protocol — including during the post-check-in wait window. Exits with `stop_requested`, never `no_engagement`/`idle_budget`. |
| `control: pause for <duration>` | starts with `pause for` | Implementation-defined (companion-specific). |

A future signal worth considering — surfaced as a magicWand in plan 014's run:

> `control: drain` — distinct from `stop`. Tells the companion: "we're winding down, prepare your farewell, but don't exit yet in case something else comes up." Reduces idle token spend in Power On Mode sessions where the orchestrator finishes implementation but reads docs / writes plans for several minutes before sending `stop`.

This is not a standard signal in v1 — capture it as a project follow-up if companion-mode usage scales.

---

## Lifecycle and check-in protocol

> Introduced in **plan 019** ([spec](../plans/019-runner-idle-nudge/runner-idle-nudge-spec.md), [workshop with empirical baseline](../plans/019-runner-idle-nudge/workshops/001-idle-nudge-use-cases.md)). Replaces the older "compare elapsed-since-last-message against `idleBudgetMs`" prompt branch that 4+ companion retros independently flagged as confusing.

The canonical companion (`code-review-companion`) uses an **inside-asks-outside check-in** protocol to avoid wasted compute when the orchestrator forgets to `control:stop`. The runner is uninvolved — this is purely a prompt-level convention the companion's `prompt.md` § 2 implements.

### Why a check-in instead of a runner-side nudge?

Workshop 001 surveyed 10 recent canonical companion runs:
- **60% happy path** — orchestrator sent `control:stop` cleanly
- **30% never-engaged** — orchestrator booted the companion then never sent any message (`tasksReceived: 0`)
- **10% engaged-then-forgot** — orchestrator sent tasks, got findings, then forgot to stop

The "stall" is always on the **outside**, never on the inside (idle is healthy — the companion is doing exactly what the prompt says). The inside companion can't fix outside discipline directly, but it CAN ask: "are you still there?" If yes → reply with a `task` or `control:stop` (either resets the streak or ends the run). If no → the companion exits cleanly after a brief wait.

### Two thresholds, one heuristic

The companion tracks a small integer counter (`emptyPollStreak`) — the number of consecutive empty long-poll cycles since the last engagement. When the counter exceeds a configured threshold, the companion sends ONE `still-needed` question:

| Threshold | Default | When it fires | Exit if unanswered |
|---|---|---|---|
| `firstContactPollThreshold` | 20 polls (~10 min) | After orient + this many empty polls with **zero** outside engagement | `no_engagement` |
| `postTaskPollThreshold` | 10 polls (~5 min) | After completing at least one task + this many empty polls | `idle_budget` |
| `replyWaitPolls` | 4 polls (~2 min) | Companion waits this many more empty cycles after a check-in before farewelling | n/a (it's a wait window) |

After the check-in fires, the companion waits `replyWaitPolls` more empty cycles. If the orchestrator replies with anything (task / question / control:stop), the streak resets and the companion stays alive. If no reply, the companion farewells with the appropriate `exitReason`.

**One check-in per idle window.** A second empty streak after a fresh task gets a fresh check-in; consecutive empty polls without engagement do NOT get a second nag.

**`control:stop` always wins.** If the orchestrator replies with `control:stop` during the wait window, the companion exits with `stop_requested`, not `no_engagement`/`idle_budget`.

### How orchestrators respond to a check-in

The check-in is a regular `question`-typed inbox message with `subject: 'still-needed'`. Any orchestrator that handles the existing `question` inbox vocabulary handles it for free — reply with whatever's appropriate:

- **More work coming** → reply with a `task` (companion's streak resets, normal flow continues)
- **Done now** → send `control:stop` (companion farewells with `stop_requested`)
- **Pause briefly** → reply with a brief `note` or `progress` ack (companion's streak resets, but it'll re-check after the next threshold)
- **Genuinely don't know yet** → ignore (companion farewells after `replyWaitPolls`; you can boot a new one later)

In **Power On Mode**, this means the orchestrator agent (the coding agent driving implementation) sees the check-in pop up in `minih view` / `minih attach` and can react explicitly — the closure is no longer silent at the 30-min budget.

### Configuring the protocol

Per-run, via the standard `--input` JSON:

```bash
# tighter, faster cleanup
minih run code-review-companion --input '{"firstContactPollThreshold": 10, "postTaskPollThreshold": 5, "replyWaitPolls": 2}'

# disable check-in protocol entirely (legacy idleBudgetMs-only behavior)
minih run code-review-companion --input '{"firstContactPollThreshold": 0, "postTaskPollThreshold": 0}'
```

`idleBudgetMs` is still supported and still acts as the absolute upper bound on idle time. Under the check-in protocol it rarely fires — but it remains the safety net for cases where the check-in path is disabled or doesn't behave as expected.

### Inside-asks-outside as a general capability

The check-in is the **canonical example** of a broader pattern: the inside companion can use `inbox_send({ type: 'question', ... })` to ask the orchestrator about anything — scope clarifications, status confirmations, budget requests. The lifecycle check-in is just the most common instance of this. Companion authors may add other inside-initiated questions to their prompts when the conversation pattern is useful.

---

## Farewell envelope shape

Companion-mode agents SHOULD emit a farewell envelope structurally similar to:

```jsonc
{
  "session": {
    "startedAt": "ISO-8601",
    "endedAt": "ISO-8601",
    "exitReason": "stop_requested | idle_budget | no_engagement | timeout | error",
    "messageCounts": {
      "tasksReceived": 0,
      "findingsSent": 0,
      "questionsAsked": 0
    }
  },
  "findings": [
    {
      "id": "F001",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "file": "path/to/file.ts",
      "category": "...",
      "issue": "...",
      "recommendation": "...",
      "ackOf": "01H...XYZ"  // ← review-request msg id this finding targets
    }
  ],
  "summary": "Plain-prose recap of the session and verdict.",
  "retrospective": {
    "workedWell": "...",
    "confusing": "...",
    "magicWand": "...",
    "magicWandTarget": "coordination" | "minih" | "project",
    "coordination": { /* peer-flow notes */ }
  }
}
```

The exact schema lives in each companion agent's `output-schema.json` — but the high-level structure (session metadata, findings array, summary, retrospective) is the contract that orchestrators rely on.

---

## Wait-for-any (plan 014) and companion mode

The new `wait_for_any` MCP tool lets companion implementations long-poll for *both* inbox messages AND state changes in a single call. A companion that wants to react to operator state-flips (e.g., "outside set status to `review-requested`") in addition to inbox messages can use:

```jsonc
wait_for_any({
  events: [
    {
      kind: 'inbox.message',
      filter: { types: ['task', 'question', 'directive', 'control', 'briefing', 'review-request'] }
    },
    { kind: 'state.peer.changed' }
  ],
  waitMs: 30000
})
```

See [`AGENTS_README.md` § Wait for any](../../AGENTS_README.md) for the tool's full surface.

---

## Quick reference — minimum viable Power On Mode session

```bash
# 1. Boot
npx minih run my-companion &
RUN_ID=$(npx minih status my-companion 2>/dev/null | jq -r '.data.runId')

# 2. Brief
npx minih outside inbox send my-companion --run "$RUN_ID" \
  --type briefing --subject "Session start" --body "Plan: ..."

# 3. Review (per commit, repeat as needed)
SHA=$(git rev-parse --short HEAD)
npx minih outside inbox send my-companion --run "$RUN_ID" \
  --type task --subject "review-request: T001 $SHA" --body "Diff: git show $SHA"

# (... do work, commit, repeat step 3 ...)

# 4. Stop and read the farewell BEFORE reporting back
npx minih outside inbox send my-companion --run "$RUN_ID" \
  --type control --subject "stop" --body "stop — session done"

# Wait for the farewell to land (a few seconds)
sleep 5

# Read it
cat agents/my-companion/runs/$RUN_ID/output/report.json | jq

# 5. Now you can report back to your operator with the farewell folded in.
```

---

## See also

- [`coordination-loop-validator.md`](./coordination-loop-validator.md) — richer canonical loop example
- [`AGENTS_README.md`](../../AGENTS_README.md) § Coordination — outside/inside CLI surface
- [`AGENTS_README.md`](../../AGENTS_README.md) § Companion mode → § Upgrading an existing one-shot agent to companion mode — the migration recipe
- `agents/code-review-companion/` — canonical companion implementation
