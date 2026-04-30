# Companion Mode

A protocol for using a coordinated minih agent as a *companion* to your main work — a reviewer, watcher, or auditor that follows along through implementation rather than running once at the end.

This guide documents the protocol so it works the same way across projects, not just inside minih. Any agent harness that drives a coordinated minih agent can use it.

---

## What is companion mode?

A **companion** is a coordinated minih agent that:

1. Boots once at the start of a work session.
2. Long-polls the inbox for messages from the outside operator (you / your orchestrator).
3. Acts on each message without exiting.
4. Receives a final `control:stop` signal when the session is over.
5. Writes a **farewell envelope** to its `$MINIH_OUTPUT_PATH` summarising the session.

The canonical implementation is `agents/code-review-companion/` — a reviewer that follows you through commits and reviews each one as you ship. The pattern generalises to other watchers (e.g. a security companion, a docs-drift companion, a metrics watcher).

The opposite pattern — **one-shot agents** — boot, do one task, write output, exit. Companion mode is for work that's longer than one task.

---

## The Power On Mode protocol

"Power On Mode" is the orchestrator-side workflow that pairs with companion-mode agents. The orchestrator drives the work; the companion follows along; pings happen at every commit boundary; the companion fires findings asynchronously without blocking the main work.

The protocol has five phases:

### 1. Boot

Start the companion as a normal coordinated run:

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

The companion long-polls with `waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']`. As long as one of those types arrives within its idle budget (default 30 minutes), it stays alive.

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
3. **It closes the loop deterministically.** Without a stop signal, the companion idles for up to its `idleBudgetMs` (default 30 min) before self-terminating. That's wasted compute and a fuzzy session boundary.

The pattern: orchestrator owns the lifecycle; the companion's idle budget is a safety net, not the primary exit condition.

---

## Control signals

The companion's `prompt.md` defines which control signals it recognises. The canonical signals are:

| Signal | Body match | Effect |
|---|---|---|
| `control: stop` | `^stop\b` | Transition to `stopping`, write farewell envelope, exit. **Always wins** over an idle-budget shutdown until the farewell envelope is committed. |
| `control: pause for <duration>` | starts with `pause for` | Implementation-defined (companion-specific). |

A future signal worth considering — surfaced as a magicWand in plan 014's run:

> `control: drain` — distinct from `stop`. Tells the companion: "we're winding down, prepare your farewell, but don't exit yet in case something else comes up." Reduces idle token spend in Power On Mode sessions where the orchestrator finishes implementation but reads docs / writes plans for several minutes before sending `stop`.

This is not a standard signal in v1 — capture it as a project follow-up if companion-mode usage scales.

---

## Farewell envelope shape

Companion-mode agents SHOULD emit a farewell envelope structurally similar to:

```jsonc
{
  "session": {
    "startedAt": "ISO-8601",
    "endedAt": "ISO-8601",
    "exitReason": "stop_requested | idle_budget | timeout | error",
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
- `agents/code-review-companion/` — canonical companion implementation
