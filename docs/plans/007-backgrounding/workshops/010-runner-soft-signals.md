# Workshop: Runner Soft Signals (Nudge Protocol)

**Type**: Integration Pattern
**Plan**: 007-backgrounding
**Spec**: [coordination-spec.md](../coordination-spec.md)
**Created**: 2026-05-05
**Status**: Draft — exploratory · **Design v2 applied 2026-05-05** (orchestrator as primary nudger for idle)

**Related Documents**:
- [001-filesystem-layout.md](001-filesystem-layout.md) — `inbox/inside/messages.ndjson` is the carrier channel
- [002-state-machine.md](002-state-machine.md) — agent's response to a nudge may flow through state transitions
- [003-mcp-tool-surface.md](003-mcp-tool-surface.md) — `inbox_list` / `inbox_ack` already deliver these messages to the inside agent
- [005-preamble-and-prompting.md](005-preamble-and-prompting.md) — companion-mode prompts simplify dramatically once nudges land
- [008-inside-outside-prompting-and-retro.md](008-inside-outside-prompting-and-retro.md) — companion lifecycle context
- `docs/how/companion-mode.md` — current prose on idle-budget; will be rewritten when this lands
- FX008 (`docs/plans/018-agent-permissions/fixes/FX008-coordination-write-precondition.md`) — established the precedent that the runner can synthesise inbox messages (`fireTerminalDenial`)
- SQL followup `mw-companion-idle-budget-visibility` — magic wand that prompted this workshop
- Spec: [`docs/plans/019-runner-idle-nudge/runner-idle-nudge-spec.md`](../../019-runner-idle-nudge/runner-idle-nudge-spec.md) — Phase 1 implementation contract (Design v2 framing)

**Domain Context**:
- **Primary Domain**: `runner` (owns the file-system observations and the message-write side-effect for runner-side signals)
- **Related Domains**: `mcp` (no new tools needed — existing `inbox_list` already delivers); `cli` (operator-facing flags + status surfaces); `agents` (canonical companion prompts — outside.md owns the idle-nudging logic per Design v2)

---

## ⚠️ Design Update (2026-05-05) — Orchestrator is the Primary Nudger for Idle

> **User feedback (verbatim)**: *"it shoudl be noted, that the inside agent could ask for an update to the outside agent, or other htings. In reality the outside agent shoule be the thing doing the nudging. Minih agents in companion mode always will have an 'outside' agent."*

This workshop's first draft put **all** soft signals — including idle-budget — in the runner. That was wrong for the idle case specifically. The principle this update establishes:

> **The layer that has visibility into the condition is the layer that observes (and nudges).**

Applied to the signal taxonomy:

| Signal | Who observes? | Who nudges? |
|---|---|---|
| **Inbox idle** | Outside agent (it sees its own send-history) | **Outside agent** ← Phase 1 |
| Peer-died | Runner (process state) | Runner |
| File-changed | Runner (filesystem watcher) | Runner |
| Git-conflict / git-branch-changed | Runner (worktree state) | Runner |
| Disk-quota / token-budget / rate-limit | Runner (resource probes) | Runner |
| Parent-process-exiting / mcp-server-unhealthy | Runner (host state) | Runner |
| Time-checkpoint | Either (config-dependent) | Either |
| Peer-promoted / peer-paused | Runner (peer state) | Runner |

Most of the Phase 2 sketch stays valid — those are runner-only observations. **Idle is special** because the outside agent has perfect visibility into its own activity already; pushing the timer to the runner duplicates capability and puts lifecycle policy in the wrong layer (the runner is substrate; the orchestrator is the conductor).

### What changes for Phase 1

- **Runner does NOT post `control:idle-warning`.** The outside agent's prompt (canonical: `agents/code-review-companion/outside.md`) instructs it to:
  1. Track its own send-history (already in `inbox/outside/messages.ndjson`).
  2. After `idleBudgetMs - graceMs` of its own silence, send `control:idle-warning` to the inside agent via `outside-send`.
  3. After `idleBudgetMs` of silence, send `control:stop`.
- **Runner's role reduces to**:
  1. **Hard backstop** — kill the run if outside-inbox silence exceeds a generous backstop threshold (default proposal: `2 × idleBudgetMs`, or `idleBudgetMs + killGraceMs` — whichever the spec settles on). This catches the orchestrator-died case.
  2. **Visibility surface** — `minih status` exposes `idle.lastInboundAt`, `idle.elapsedMs`, etc. The outside agent reads this (or its local equivalent) to make nudge decisions; operators see it for transparency.
- **Inside agent gets a bidirectional request capability** — `inbox_send` from inside to outside is already supported by the existing MCP tool. The new contract is **prompt-level**: the inside agent's prompt should explicitly say "you can ask the outside agent for X via `inbox_send` with `type:'question'` or `type:'task'`." This was always *possible*; Phase 1 makes it *expected*.

### Companion mode invariant

> Per user assertion: *"Minih agents in companion mode always will have an 'outside' agent."*

This is the load-bearing assumption that lets us push idle-policy to the outside layer. In **companion mode**, an orchestrator is always present — that's the definition of the mode. For other coordinated configurations where the outside lane might be a passive operator (a human, a CLI script), the runner-side backstop catches the no-orchestrator case. We do **not** need a runner-side soft-warn for companion mode because the orchestrator is, by definition, the entity doing the work that drives the idle clock.

### Bidirectional request capability

The inside agent isn't just a passive nudge-receiver. It can:
- Ask the outside agent for an update: `inbox_send({ type: 'question', subject: 'context-update', body: '...' })`
- Request more time: `inbox_send({ type: 'task', subject: 'extend-budget', body: 'mid-review, need ~5 more minutes' })`
- Confirm continued engagement: `inbox_send({ type: 'note', subject: 'still-here', body: 'long-poll cycle 12, no work yet' })`

The outside agent's prompt must specify which of these it understands and how it responds. None of this is new MCP surface — it's all existing `inbox_send` semantics — but the **conversation patterns** become first-class contract instead of ad-hoc convention.

### What stays unchanged

- Phase 2 signal taxonomy (peer-died, file-changed, git-conflict, disk-quota, etc.) — these stay runner-side because the runner is the only layer that can observe them.
- The `meta.origin` distinction (runner-injected vs outside-issued) — still useful for runner-side signals.
- Inbox envelope shape — outside agents already use this channel; no new wire format.
- The escalation ladder concept (warn → stop → kill) — but ownership shifts: outside-agent owns warn+stop; runner owns the hard kill backstop.

### Implications for sections below

The original Phase 1 design (runner-side idle-watch, lifecycle wiring, fake-clock unit tests) is preserved below as historical design exploration. The current implementation contract lives in the spec at [`docs/plans/019-runner-idle-nudge/runner-idle-nudge-spec.md`](../../019-runner-idle-nudge/runner-idle-nudge-spec.md). **When this workshop is read for implementation, the spec is authoritative.** When read for design rationale, the broader signal taxonomy, or the runner-side soft-signal patterns that DO apply to Phase 2, the sections below remain useful.

---

## Purpose

Pin down the **runner-to-inside soft-signal contract** — a generalised "nudge" protocol where the runner observes a condition, posts a structured `control:*` envelope into the inside inbox, and lets the agent decide how to respond.

Originated as the design fix for the long-standing magic wand "expose `idleBudgetMs` to the inside companion" (4+ independent retros). The nudge reframe replaces that wand: the agent never needs to **see** the budget number — when it matters, the runner **tells the agent** about it.

This workshop scopes:
1. **Phase 1 (in-scope for plan)**: `control:idle-warning` — the immediate cure for the magic wand.
2. **Phase 2 (sketch only — explicitly OOS for current plan, captured to preserve design space)**: file-change events, peer-died notifications, disk-quota warnings, parent-process-exiting signals, git-state changes, resource limits.

The core insight: **today, runner→inside communication exists but only for terminal events** (`fireTerminalDenial` writes a denial envelope). Generalising this to non-terminal soft signals is a small extension with large surface-area payoff.

## Key Questions Addressed

1. What is the wire-level shape of a soft-signal envelope (subject, sender, meta)?
2. How does the agent distinguish a runner-injected message from an outside-orchestrator message?
3. What is the escalation ladder when the agent ignores a nudge? (warn → stop → kill)
4. How does the agent push back ("I'm busy, give me more time")?
5. What's the immediate Phase-1 contract for idle-warning, and what configurability does it need?
6. What other observers/conditions could ride this channel later, and does the design accommodate them without breaking?
7. How does this interact with the existing terminal-denial flow (FX008) so observers don't see contradictory state?

---

## Today's Mechanics (Baseline)

### Existing primitives (already shipped)
- `inbox/inside/messages.ndjson` — append-only NDJSON of envelopes the inside agent reads via `inbox_list`.
- `InboxMessage`: `{ id, sender: 'inside'|'outside', type: string, subject, body, ts, ackOf?, meta? }` (see `src/runner/types.ts`).
- `fireTerminalDenial` (FX008) — runner writes a synthetic message to the inside inbox in response to a permission denial. The `sender` field is currently set to `'outside'` (treating runner-as-outside). **This is the seed of the pattern this workshop generalises.**
- The companion already long-polls via `inbox_list({ waitForAny: ['task','question','directive','control','briefing','review-request'] })`.

### Today's idle-budget pain (the trigger)
- Companion prompt instructs: `if elapsed_since_last_outside_message > input.idleBudgetMs: goto FAREWELL`.
- `input.idleBudgetMs` is set by the operator via `--input` JSON; default 30 min from the companion's input-schema.
- **The agent has no inside-visible surface to read `input.*`.** It is told to compare against a value it can't see.
- 4+ independent companion retros log this contradiction (see `docs/retros/code-review-companion.md`).
- Workarounds in the wild: counting empty long-poll cycles, using `minih status` elapsed time as a proxy, treating `run start` as the baseline when no outside message arrives.

### Why "expose idleBudgetMs to inside" is the wrong fix
- Forces every companion prompt to keep an explicit clock-comparison branch.
- Pushes lifecycle policy into the agent (which is the wrong layer — the runner observes, the agent reacts).
- Doesn't generalise — every future runner-observable condition (file change, peer death, etc.) would need its own visibility hack.

The right fix is to **invert the flow**: the runner makes the observation, then *delivers the relevant signal as a message at the moment it matters*.

---

## Proposed Contract (Phase 1)

### Wire-level envelope

A runner-injected nudge is just an `InboxMessage` written to `inbox/inside/messages.ndjson` — **no schema change**. We use existing fields with a reserved subject namespace:

```json
{
  "id": "01HZ7Y9...",
  "sender": "outside",
  "type": "control",
  "subject": "idle-warning",
  "body": "No outside-inbox activity for 28m30s. ~90s until idle-budget timeout. Wrap up if you want a clean exit.",
  "ts": "2026-05-05T10:34:00.000Z",
  "meta": {
    "origin": "runner",
    "signal": "idle-warning",
    "remainingMs": 90000,
    "thresholdMs": 1800000,
    "elapsedMs": 1710000,
    "reason": "inbox-silent",
    "escalation": "control:stop in 90s if no activity"
  }
}
```

Why the existing schema works:
- `type: "control"` already exists — orchestrators send `control:stop`. Reusing it keeps the agent's `waitForAny` filter unchanged.
- `subject: "idle-warning"` is a kebab-case action (consistent with `subject: "stop"` in existing control messages).
- `meta.origin: "runner"` lets the agent (and humans inspecting the inbox) distinguish runner-injected from operator-injected control messages — important when both can issue `control:stop`.

### Subject taxonomy (Phase 1)

| `type` | `subject` | `meta.signal` | Trigger | Escalates to |
|--------|-----------|---------------|---------|--------------|
| `control` | `idle-warning` | `idle-warning` | inbox silent for `idleBudgetMs - graceMs` | `control:stop` (after `graceMs`) |
| `control` | `stop` | `idle-stop` | inbox silent for `idleBudgetMs` | hard kill (after `killGraceMs`) |

Existing operator-issued `control:stop` is unchanged — only the meta differs (`origin: "operator"` vs `"runner"`).

### Escalation ladder

```
T = 0                     T = idleBudgetMs - graceMs    T = idleBudgetMs    T = idleBudgetMs + killGraceMs
│                         │                              │                   │
│ — inbox silence —       │ control:idle-warning         │ control:stop      │ SIGTERM the run process
│                         │  (graceMs to wrap up)        │ (killGraceMs to   │
│                         │                              │  exit cleanly)    │
└─────────────────────────┴──────────────────────────────┴───────────────────┘
   Default budget timer    Soft nudge — "consider exit"   Firm — "stop now"   Hard — process termination
```

Defaults (proposed):
- `idleBudgetMs`: 30 min (unchanged from today)
- `graceMs`: 90s
- `killGraceMs`: 30s

Reset semantics:
- **Any new message in `inbox/outside/messages.ndjson` resets the timer.** This is what "idle" means today — nothing changes.
- **An agent-side `state_set({ status: 'busy', ... })` resets the timer.** This is the agent's push-back lever (see "Agent contract" below).

### Agent contract (the prompt simplification)

**Before (current companion prompt, paraphrased):**
> If `elapsed_since_last_outside_message > input.idleBudgetMs`, goto FAREWELL with `exitReason='idle_budget'`.

**After:**
> If your inbox contains a `control:idle-warning`: cleanup-and-farewell. You have approximately `meta.remainingMs` to write your retro, post final findings, and emit your output report.
>
> If your inbox contains a `control:stop` from origin=`runner`: same as `control:stop` from operator — exit cleanly, immediately.
>
> If you receive an `idle-warning` but you genuinely have unfinished work: emit `state_set({ status: 'busy', data: { reason: 'mid-review' } })` to reset the timer. The runner will not nudge you again until inbox-silence resumes.

**This deletes the elapsed-clock branch from every companion prompt.** No more counting polls, no more reading `input.*`, no more arbitrary heuristics.

### Operator surfaces

- `minih run --idle-grace-ms <ms>` — operator override for `graceMs`. Defaults to 90s.
- `minih run --kill-grace-ms <ms>` — operator override for hard-kill grace. Defaults to 30s.
- `MINIH_DISABLE_IDLE_NUDGE=1` — env-var kill-switch (agent never receives the soft warning; goes straight to `control:stop` at budget). Symmetric with the `MINIH_DISABLE_COORD_WRITE_PRECONDITION` pattern shipped in FX008.
- `minih status <slug> --run <id>` — exposes (in JSON envelope only): `idle.lastInboundAt`, `idle.elapsedMs`, `idle.budgetMs`, `idle.nextWarnAt`, `idle.nextStopAt`. **This restores the operator-facing visibility that today's flow lacks** without forcing the agent to consume it.

### Observability

- Each soft signal emitted by the runner appends a `runner.nudge.fired` event to `events.ndjson` with the same payload that was written to the inbox.
- `minih view <slug> --run <id>` and `minih attach` render `control:*` messages in the timeline lane already; no UI work needed.
- Retro auto-harvest can correlate `idle-warning` + `control:stop` + `farewell-emitted` to surface "did the agent honour the nudge?" stats over time.

---

## Phase 2 — Future Signal Types (Sketch / Brainstorm — OOS for current plan)

> ⚠️ **Out of scope for the current plan.** Captured here so the Phase-1 design doesn't paint us into a corner. If/when these land, each gets its own workshop.

The same channel can carry many runner-observed conditions. The pattern is always: *runner observes → posts `control:<subject>` → agent reacts.*

| `subject` | `meta.signal` | Trigger | Why agent might care | Escalation |
|-----------|---------------|---------|----------------------|------------|
| `peer-died` | `peer-down` | Peer agent's run.json transitions to terminal status | Companion can stop watching, write final retro before farewell window expires | None — informational |
| `peer-paused` | `peer-paused` | Peer's outside state transitions to `paused` | Companion can pause its own polling cadence to save tokens | None |
| `file-changed` | `file-watch` | Watched path (e.g., `docs/plans/<active>/tasks/`) sees writes | Companion can re-orient when its plan-of-record gets updated mid-run | None |
| `git-branch-changed` | `git-branch` | Working-dir branch HEAD moves underneath the agent | Companion can re-fetch its commit log; orchestrator may want a sanity check | None |
| `git-conflict-detected` | `git-conflict` | Merge conflict appears in tracked paths | Companion should pause review until resolved | Maybe `control:stop` if persistent |
| `disk-quota-warning` | `quota-disk` | Run dir exceeds threshold | Agent prunes verbose tool output before it gets killed | `control:stop` if hard quota |
| `token-budget-warning` | `quota-tokens` | Estimated remaining context approaches a configured floor | Companion compacts early; orchestrator gets `state_set({status:'compact-pending'})` | `control:stop` if exhausted |
| `rate-limit-imminent` | `quota-rate` | Provider's rate-limit headers near throttle | Companion backs off; orchestrator may sleep | None |
| `parent-process-exiting` | `host-shutdown` | minih CLI receives SIGTERM and is unwinding | Agent emits farewell envelope ASAP | Hard kill is unavoidable |
| `mcp-server-unhealthy` | `mcp-down` | Inside MCP probe fails | Agent tries to wrap up — no more state/inbox writes will succeed | `control:stop` |
| `time-checkpoint` | `clock` | Configured wall-clock boundary (e.g., daily) | Long-running companions can drop a periodic retro stub | None |
| `peer-promoted` | `peer-up` | Co-running agent transitions to `active` | Companion may switch from "wait" to "review-ready" | None |

### Design properties this Phase-2 sketch validates

- **Same envelope shape works** for all of them — no schema changes.
- **Escalation ladder is per-signal**, not global. Some are informational only; some have firm follow-ups.
- **Agent contract stays uniform**: "if you see a `control:<x>`, the runner observed something; check `meta.signal` for the kind, `meta.origin` for who told you, and react per your policy."
- **Per-signal kill-switches** follow a uniform env-var pattern: `MINIH_DISABLE_<SIGNAL>=1`.
- **All signals are best-effort** — agents that ignore them aren't broken, they're just less responsive.

### Phase-2 design questions (deferred)

- Should `meta.signal` values be a **closed enum** (validated, registry-tracked) or **open string** (free-form)? Closed gives static type safety but every new observer needs a registry update; open is YAGNI-friendly but risks subject-spam.
- Do we need a **subscription model** (agent declares "I care about `peer-down` and `git-conflict`") or is best-effort delivery + agent-side filter enough?
- What's the **batch behaviour** when multiple signals fire in a tight window — coalesce, throttle, or fire-each?
- Is there ever a **runner→outside** signal (e.g., notify the operator that the agent is unhealthy)? Probably yes, but uses the outside inbox + a different `meta.origin`.

---

## Open Questions (Phase 1)

### Q1: Should `sender` be `'outside'` or a new `'runner'` value?

**OPEN.** Two options:

- **Option A — keep `sender: 'outside'`, distinguish via `meta.origin`** (current FX008 precedent).
  - Pro: zero schema change; agent's `waitForAny: ['control']` filter already works.
  - Pro: matches today's reality — from the inside agent's perspective, the runner is "the outside world".
  - Con: muddier audit trail in inbox files (operator-issued vs runner-issued require meta inspection).
  - Con: makes the `Side` union ('inside'|'outside') a soft lie — there's actually a third actor.

- **Option B — widen `Side` to `'inside' | 'outside' | 'runner'`**.
  - Pro: clearer semantics; `sender: 'runner'` is unambiguous.
  - Pro: unblocks future TUI/inspect surfaces that want to colour-code by source.
  - Con: schema migration; every `Side`-typed switch needs a new arm.
  - Con: every existing test fixture and snapshot file needs touching.

**Tentative answer**: Start with **Option A** (consistent with FX008 precedent). Revisit if Phase 2 brings more sources and the meta-indirection becomes unwieldy.

### Q2: What resets the idle timer — outside-inbox writes, or any state activity?

**OPEN.** Three options:

- **A — only `inbox/outside/messages.ndjson` writes reset.** Simplest; matches the current prompt heuristic.
- **B — outside-inbox writes OR `state_set({ status: 'busy' })` reset.** Lets the agent push back when it's mid-tool-call but not receiving messages.
- **C — any inside-state write resets.** Most permissive; an agent that's running tools at all gets credit.

**Tentative answer**: **B**. Gives the agent a structured way to say "I'm not idle, I'm working" without making every state poke a budget reset (which would let chatty agents avoid the nudge entirely).

### Q3: How is `graceMs` configured, and does it need to be per-signal in Phase 1?

**RESOLVED for Phase 1**: One global `graceMs` (CLI flag `--idle-grace-ms`, default 90s). Per-signal grace defers to Phase 2 when more signals exist.

### Q4: What if the agent's first response to `idle-warning` is to send a long-running `inbox_send` to the orchestrator that itself takes >graceMs? Do we re-warn or escalate?

**OPEN.** Three options:

- **A — single warn, then escalate at budget.** Simplest. Agent must wrap up *fast* during grace.
- **B — warn resets timer but only once per cycle.** Agent gets one "you have 90s" nudge per idle window. Re-entering idle after busy resets eligibility.
- **C — re-warn every grace interval until budget.** Nags. Probably annoying.

**Tentative answer**: **B**. The warn is a one-shot signal per idle window. If the agent goes busy and idles again, it gets a fresh warn cycle.

### Q5: How does this interact with FX008's `fireTerminalDenial`?

**RESOLVED**. Terminal denials (FX008) are **terminal** — `terminalReason` is set, status flips to `failed`, no further nudges fire. The nudge protocol only operates on **active** runs. This is a one-way gate: terminal events suppress nudges; nudges never produce terminal state directly (they may be **followed by** a runner-issued `control:stop` which the agent honours, but the agent's exit is what's terminal, not the nudge itself).

### Q6: What if `inbox/inside/messages.ndjson` write fails when the runner tries to nudge?

**RESOLVED**. Soft-signal best-effort: log to `events.ndjson` (`runner.nudge.fire_failed`), record into a runner-side counter, retry once after a short backoff, then escalate directly to the next ladder rung. Same fail-safe pattern as FX008's signal-failure recording.

### Q7: Is the budget a per-run input or a per-agent default?

**RESOLVED for Phase 1**: Both layers, like today. Per-agent default lives in input-schema (e.g., companion's `default: 1800000`). Per-run override via `--input '{"idleBudgetMs": 600000}'`. CLI flag `--idle-budget-ms` may also override at run-time. Precedence: CLI flag > `--input` > schema default.

### Q8: Should the agent see `meta.remainingMs` as ground truth, or just as a hint?

**RESOLVED**. **Hint only.** The agent must not branch on the exact number; it's there for prose ("~90s remaining"). Ground truth is "you got the warn → budget will lapse soon → wrap up." This protects the contract from clock-skew and from agents over-fitting to specific values.

---

## Migration / Rollout Strategy

### Phase 1 implementation order
1. Land the runner-side timer + nudge writer (gated behind `MINIH_ENABLE_IDLE_NUDGE=1` initially for canary runs).
2. Update canonical `code-review-companion` prompt to consume `control:idle-warning` and remove the elapsed-clock branch.
3. Run dogfood for one week with the canary flag; verify retros stop asking for `idleBudgetMs` visibility.
4. Flip the default ON; rename env-var to `MINIH_DISABLE_IDLE_NUDGE` (kill-switch instead of opt-in).
5. Update `docs/how/companion-mode.md` "Idle budget" section — replace clock-watching prose with the nudge contract.
6. Sweep `agents/*/prompt.md` for other prompts that reference `idleBudgetMs` and update them.

### Backward compatibility
- **Old companions** (those still doing clock comparison): unaffected. They never read `meta.signal`, so the nudge is just one more `control:*` message they ignore. The runner's own `control:stop` at budget still fires on schedule — old companions exit normally.
- **Old prompts referencing `input.idleBudgetMs`**: still work; the value still appears in the prompt. The new path simply makes the comparison unnecessary.
- **Outside operators** sending `control:stop`: unchanged. Their messages have `meta.origin: 'operator'` (or absent), the agent's existing `control:stop` handler still fires.

---

## Quick Reference

### What an inside agent sees on a typical idle-warning cycle

```jsonc
// Polled via inbox_list({ waitForAny: ['control'] })
{
  "messages": [
    {
      "id": "01HZ7Y9...",
      "sender": "outside",
      "type": "control",
      "subject": "idle-warning",
      "body": "No outside-inbox activity for 28m30s. ~90s until idle-budget timeout.",
      "ts": "2026-05-05T10:34:00.000Z",
      "meta": {
        "origin": "runner",
        "signal": "idle-warning",
        "remainingMs": 90000
      }
    }
  ]
}
```

### What an inside agent does

```
on inbox message:
  if msg.type == 'control' and msg.subject == 'idle-warning':
    if I have unfinished work:
      state_set({ status: 'busy', data: { reason: 'mid-review' } })   # reset timer
    else:
      # cleanup path — runner will issue control:stop in ~remainingMs
      post_final_findings()
      write_retro()
      emit_output_report()
      # then natural farewell on next loop, or wait for control:stop
```

### What an operator sees in `minih status`

```json
{
  "data": {
    "verdict": "active",
    "runId": "...",
    "idle": {
      "lastInboundAt": "2026-05-05T10:05:30.000Z",
      "elapsedMs": 1710000,
      "budgetMs": 1800000,
      "graceMs": 90000,
      "nextWarnAt": "2026-05-05T10:34:00.000Z",
      "nextStopAt": "2026-05-05T10:35:30.000Z"
    }
  }
}
```

---

## Implementation Touchpoints (Sketch)

When this turns into a plan, these are the files that change:

- `src/runner/idle-watch.ts` (NEW) — timer + observer; emits `runner.nudge.fire` events.
- `src/runner/runner.ts` — wire the watcher into the run lifecycle (start at session-ready, stop at terminal).
- `src/runner/types.ts` — extend `LiveRunManifest` with `idle: { lastInboundAt, budgetMs, graceMs }`.
- `src/cli/commands/run.ts` — `--idle-grace-ms`, `--kill-grace-ms`, `--idle-budget-ms` flags.
- `src/cli/commands/status.ts` — surface `idle.*` in JSON envelope.
- `agents/code-review-companion/prompt.md` — replace clock-comparison branch with nudge handler.
- `docs/how/companion-mode.md` — rewrite the "Idle budget" section.
- `test/runner/idle-watch.test.ts` (NEW) — fake-clock unit tests for the ladder.
- `test/cli/run-idle-nudge.test.ts` (NEW) — integration test: run with `--idle-budget-ms=2000 --idle-grace-ms=500`, assert envelope arrives, assert state-busy resets, assert `control:stop` fires at budget.

Estimated scope: medium plan (~2 phases, ~12-15 tasks). Smaller than FX008 because no permission-system entanglement.

---

## Why this matters beyond idle-budget

The nudge protocol is a **first-class harness primitive**. Once the runner can reach into the inside inbox to deliver observations, every future runner-side observability or lifecycle concern has a uniform delivery channel. We stop accreting one-off "expose X to inside" hacks (the `idleBudgetMs` magic wand was about to become the third or fourth such hack).

It's also the natural counterpart to the orchestrator→companion message channel that already exists. Today the inside agent has two message sources (operator messages, in-prompt config); after Phase 1, it has three (operator messages, in-prompt config, runner observations). The third is the one that's been silently missing.

The Phase-2 sketch is the proof: the same channel solves file-watching, peer-status, quota warnings, and host-shutdown notifications — all currently either impossible or solved by ad-hoc means. That's the velocity-compounding play.
