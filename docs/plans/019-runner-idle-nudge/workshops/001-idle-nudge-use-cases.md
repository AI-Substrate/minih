# Workshop: Idle Nudge — Real Use Cases (Grounded in `code-review-companion`)

**Type**: Integration Pattern · Use-Case Workshop
**Plan**: 019-runner-idle-nudge
**Created**: 2026-05-05
**Status**: Draft — exploratory · **Sequel to** [`007/workshops/010-runner-soft-signals.md`](../../007-backgrounding/workshops/010-runner-soft-signals.md)

> **User direction** (verbatim): *"why do they have to prompt. what has happened that the inside agent has stalled (has it even stalled). What is the flow. Use code review companion as a guide, workshop now as i think we need to have a use case firmly documented before we go fumbling in the dark making product choices without really knowing why"*

---

## Why this workshop exists

The first two workshops (`010-runner-soft-signals.md` v1 and v2) jumped to **mechanism design** ("the runner posts a `control:idle-warning`" / "the outside agent posts a `control:idle-warning`") without first establishing **what problem the nudge actually solves**. That's how we end up making product decisions about a flow we haven't actually traced. This workshop walks the lifecycle one step at a time, against the canonical `code-review-companion`, and only then asks what (if anything) needs to change.

## Empirical baseline — what actually happens today

Survey of the most recent **10** `code-review-companion` runs:

| Run | tasksReceived | exitReason | Diagnosis |
|-----|---------------|------------|-----------|
| 2026-05-02T12-29 | 3 | `stop_requested` | ✅ Happy path — orchestrator issued stop after work done |
| 2026-05-03T09-55 | 1 | `stop_requested` | ✅ Happy path |
| 2026-05-03T15-37 | 2 | `idle_budget` | ⚠️ Orchestrator forgot to stop after work |
| 2026-05-03T16-08 | 8 | `stop_requested` | ✅ Happy path (busy session) |
| 2026-05-04T14-25 | 0 | `idle_budget` | 🚧 Orchestrator never sent a single message — likely never engaged |
| 2026-05-04T14-41 | 0 | `idle_budget` | 🚧 Same — orchestrator never engaged |
| 2026-05-04T14-49 | 0 | `idle_budget` | 🚧 Same |
| 2026-05-04T15-22 | 1 | `stop_requested` | ✅ Happy path |
| 2026-05-04T17-44 | 3 | `idle_budget` | ⚠️ Orchestrator forgot to stop after work |
| 2026-05-04T18-36 | 3 | `stop_requested` | ✅ Happy path |

**Distribution:**
- 60% happy path (`stop_requested` after real work)
- 30% orchestrator never engaged (`idle_budget`, `tasksReceived: 0`)
- 10% orchestrator engaged but forgot to release (`idle_budget`, `tasksReceived > 0`)

That's our problem space. Three concrete scenarios. The 60% is fine; the 40% is what we're optimising for.

---

## The flow — what the companion actually does

```text
                                                           ┌───────────────────────┐
boot ──► orient (read plans/tasks) ──► state=idle ──► poll │ inbox_list({waitMs:30s│
                                       (~30s long-poll)    │ waitForAny:[task,…] })│
                                                           └─────────┬─────────────┘
                                                                     │
                                              ┌──────────────────────┼─────────────────────┐
                                              │ (empty)              │ (got message)       │
                                              ▼                      ▼
                              ┌──────────────────────────┐    ┌──────────────────────┐
                              │ if elapsed > idleBudgetMs│    │ ack + dispatch       │
                              │   FAREWELL exit          │    │ (task → reading →    │
                              │ else                     │    │  reviewing → reporting│
                              │   loop                   │    │  → idle)             │
                              └──────────────────────────┘    └──────────────────────┘
                                                                     │
                                                                     └──► back to idle/poll
```

Important property: **idle is the default healthy state.** The companion is *not* "stalled" when it's idle — it's doing exactly what the prompt says: long-polling. The 30s waitMs means the SDK isn't burning tokens during these polls (it's a server-side long-poll on the inbox file).

So the framing question — *"has the inside agent stalled?"* — has a clean answer: **no.** Idle is healthy. The pathology lives elsewhere.

---

## Where does the pathology actually live?

For each of the three scenarios from the empirical baseline:

### Scenario A — Happy path (60%)

- Orchestrator (human or coding-agent) sends `task` (review-request).
- Companion works, sends findings.
- Loop until orchestrator's work batch is done.
- Orchestrator sends `control:stop`.
- Companion farewells cleanly.

**Pathology**: none. **Nudge needed**: none.

### Scenario B — Orchestrator never engaged (30%)

- `minih run code-review-companion &` was started by some outer process.
- Orientation completed; companion now polls.
- No outside message ever arrives. `tasksReceived: 0`.
- After 30 min, `idle_budget` exit.

**Why does this happen?**
- The user (or orchestrator agent) booted the companion intending to use it, then got distracted / context-switched / decided not to use it after all.
- The orchestrator agent's session ended (e.g., I send `nohup minih run code-review-companion &` from a CLI session, then the session ends or the user closes the conversation).
- The orchestrator booted multiple companions and only used one.

**Where's the pathology?**
- Not in the companion. It did the right thing: idled, polled, exited cleanly at budget.
- Not in the runner. It did the right thing too: spawned the run, let it idle, captured the budget exit.
- **In the orchestrator** — it boots companions it doesn't end up using. Either because its plan changed, or because session lifecycle (orchestrator process exit) doesn't propagate to companion lifecycle.

**Would a nudge help?**
- A nudge from the runner saying "your inside has been idle 25 min, no engagement" would go… *where?* The orchestrator session may not exist anymore. There's no process to receive the nudge.
- A nudge from the inside saying "anyone there?" would go to a possibly-dead orchestrator inbox — same problem.

**Real fix**: shorten the idle budget for orientation-only sessions, OR give the orchestrator a "did this session end orphan?" check at exit time. **Neither is what either of the previous workshops proposed.**

### Scenario C — Orchestrator engaged but forgot to stop (10%)

- Orchestrator sends N tasks, gets findings back.
- Orchestrator's work batch ends.
- Orchestrator forgets to send `control:stop`.
- Companion idles for the rest of `idleBudgetMs`, then exits.
- `tasksReceived > 0`, `exitReason: 'idle_budget'`.

**Why does this happen?**
- Orchestrator agents (like me) are working on a complex task, the companion is supporting infrastructure, and at the end of the task it slips the orchestrator's mind to issue stop.
- This shows up in the live retros: F002 in companion run `2026-04-30T11-29-56` literally captured this — *"send `control:stop` BEFORE reporting back to the user."*
- Compounding factor: if `auto-harvest` is on, the retro only fires AFTER farewell. So the orchestrator misses the companion's last word for 25-30 min while the budget elapses.

**Where's the pathology?**
- **In the orchestrator's protocol.** It needs a "before I report done, stop the companion" step.
- Secondarily, in the companion's behaviour: 25 min of pure idle polling is wasteful when the orchestrator clearly isn't coming back. But this is also true: the companion CAN'T tell the difference between "orchestrator is done" and "orchestrator is taking a long pause."

**Would a nudge help?**
- A nudge from the inside saying "hey, anyone still there? I can stand down if not" would help — *if the orchestrator is alive and listening.* If the orchestrator (especially an automated coding agent) has moved on to other work, the companion's question goes into an inbox no one's polling.
- A nudge from the runner to the inside saying "no one's said anything in N min, exit if you want" is just a more elaborate version of the existing `idleBudgetMs` exit. Saves no compute (it's polling on long-poll anyway) and costs prompt complexity.

**Real fix**: give the orchestrator a strong protocol cue ("you MUST stop the companion before reporting done"). The minih-side AGENTS.md actually already does this — *"Before reporting back to the user, send `control:stop`"* — but it relies on the agent reading and following the doc. We could turn it into a **check** rather than a doc.

---

## The realisation

Looking at all three scenarios honestly:

| Scenario | "Inside stalled"? | "Outside stalled"? | Real pathology |
|----------|-------------------|--------------------|--------------- |
| A — happy path | No | No | None |
| B — orchestrator never engaged | No (idle is healthy) | Partial (gone) | Outer process lifecycle didn't propagate |
| C — orchestrator forgot stop | No (idle is healthy) | No (just moved on) | Orchestrator's discipline / protocol |

**The inside agent never stalls.** The "stall" is always:
- An **outside process lifecycle** problem (B), OR
- An **outside protocol discipline** problem (C).

A runner-side or outside-side soft-warn into the inside inbox helps neither. The inside isn't the source of the pathology and isn't the place to fix it.

## What the previous workshops got wrong

**Workshop 010 v1**: Runner posts `control:idle-warning` to inside. *Wrong, because the inside doesn't have a problem.*

**Workshop 010 v2**: Outside agent posts `control:idle-warning` to inside. *Wrong for the same reason — and additionally, in scenario B the outside is gone and can't post anything; in scenario C the outside is alive but distracted, and the warn-then-stop-from-outside ladder is just extra prompt complexity for an outcome (orchestrator says stop) that's already supported.*

Both workshops were solving "inside knows when to exit" — but **inside already knows when to exit**. The current `idleBudgetMs` exit works. The retros that asked for "expose `idleBudgetMs` to inside" weren't really asking for visibility — they were expressing frustration that the prompt told them to do clock arithmetic. That's a prompt-craft issue, not a protocol issue.

---

## What ACTUALLY helps each scenario

> ⚠️ **Vocabulary note (added during plan 019 implementation)**: This workshop's "ACTUALLY helps" section, the reframed-protocol section below, and the open-questions list use the working name `firstContactBudgetMs` (millisecond-based). When the spec was finalised the field was renamed to **`firstContactPollThreshold`** (poll-count-based) — see workshop's "Prompt Diff Sketch" addendum + the `Update 2026-05-05 — Defaults adjusted post-clarify` callout below. The shift was intentional: poll counts are LLM-friendlier than clock arithmetic. Treat any mention of `firstContactBudgetMs` in the rest of this workshop as **historical reasoning** that was superseded by the integer-counter form. The shipped contract lives in `agents/code-review-companion/input-schema.json` and the spec at `runner-idle-nudge-spec.md`.

### Scenario A — Happy path

Nothing to do. Don't break it.

### Scenario B — Orchestrator never engaged (30%)

Two real fixes, neither involves nudging:

1. **Shorter budget for un-engaged sessions**: if `tasksReceived == 0` after, say, 5 min of polling, exit early with a new `exitReason: 'no_engagement'`. The companion was clearly never used. Saves ~25 min × 30% of runs = real compute.
   - Implementation: add `firstContactBudgetMs` to input-schema (default 300_000). Inside-prompt extends boot loop with: *"If no outside message arrives within `firstContactBudgetMs` after orientation completes, farewell with reason `no_engagement`."*
   - This is **prompt-only**, no runner changes. Discoverable and configurable per companion.
   - Symmetric retro request: workshop 010's old Q3 mentioned *"first-contact timeout"* — this matches.

2. **Orchestrator-process lifecycle propagation**: if the orchestrator that booted the companion is gone, the runner could detect orphan and shut down. **This is the real "runner backstop" use case** — but it's about *process supervision*, not idle messaging. (Phase 2 territory; needs the peer-died signal from workshop 010.)

### Scenario C — Orchestrator engaged but forgot stop (10%)

Real fixes, ranked by impact:

1. **Orchestrator-side protocol enforcement**: AGENTS.md already says "before reporting back, send `control:stop`." Turn that into a **check**, not just docs:
   - When the orchestrator agent's main session is wrapping up (it's writing its final summary), check whether it has any active companion runs. If yes, refuse to "complete" until they're stopped. This is a coding-agent harness-level check, not a runner change.
   - **Out of scope for this plan** — but it's the real fix.

2. **Inside-initiated check-in question**: the inside companion, after, say, 5 idle long-poll cycles in a row (~150s) since the last completed task, proactively sends a single `inbox_send({type:'question', subject:'still-needed', body:'I have been idle for ~3 minutes since your last task; should I stand down, or do you have more work?'})`. The orchestrator either replies `control:stop` (yes done) or `task` (no, here's more) — both reset the idle clock as a bonus.
   - **This is the only legitimate "nudge" in this whole space, and the nudge goes inside→outside, not outside→inside.**
   - If the orchestrator is dead (Scenario B's tail), the question goes unanswered and the companion just continues to its existing `idleBudgetMs` exit. No regression.
   - If the orchestrator is distracted, the question lands in its inbox and either prompts a reply or reminds it to stop.
   - This is **prompt-only**, zero runner changes.
   - It also exercises the request-capability stanza we wanted to introduce anyway — making the protocol bidirectional instead of just one-direction.

3. **Shorter default `idleBudgetMs`** for the canonical companion: 30 min is a lot. If we trust scenario-C check-ins to convert silently into clean exits, we could drop the default to, say, 10 min and still rarely hit it.

---

## The reframed protocol

Throwing out both workshops' previous mechanism designs, here's the protocol that falls out of these scenarios:

### Inside companion (canonical `code-review-companion`)

- **First-contact budget** (Scenario B fix): `firstContactBudgetMs` (default 300s). If no outside message arrives within this window after orient completes, farewell with `exitReason: 'no_engagement'`.
- **Re-engagement check-in** (Scenario C fix): after ~5 consecutive empty long-poll cycles since the last completed task (heuristic: roughly 2-3 minutes of post-work silence), send ONE `question` to the orchestrator: *"I'm idle since `<task.subject>` completed; do you need more, or should I stand down?"*
  - State remains `idle` with reason `checking-in`.
  - If orchestrator replies with `task` or `control:stop`, normal flow resumes.
  - If no reply within the next `idleBudgetMs - elapsed`, normal `idle_budget` farewell.
  - Send at most ONE check-in per idle window — don't nag.
- **Existing `idleBudgetMs` final-fallback**: unchanged. It's the safety net.

### Outside agent / orchestrator (any caller — human, coding agent, test harness)

- **No new contract** beyond what AGENTS.md already says: send `control:stop` before reporting done.
- **Optionally respond to the inside's check-in**: but treating the check-in as just another `question` (which orchestrators already handle) means no new protocol is required.

### Runner

- **No change for Phase 1.**
- Orphan-process detection (Scenario B's deeper fix) is Phase 2, tied to peer-died from workshop 010.

### What the inside-agent's `idleBudgetMs` looks like under this protocol

`idleBudgetMs` becomes the **safety net only** — the absolute upper bound. Normal completion goes through:
- `control:stop` from orchestrator (Scenario A)
- `no_engagement` self-exit (Scenario B)
- check-in → `control:stop` (Scenario C)

If `idleBudgetMs` ever fires under this protocol, something unusual happened. That's the right framing.

---

## Worked example — the new flow for Scenario C

```text
T=0:00   minih run code-review-companion (orchestrator boots companion)
T=0:05   companion orients, sends progress, state=idle, polls
T=0:10   orchestrator sends task: "review commit a1b2c3d"
T=0:15   companion findings emitted, state=idle
T=0:30   orchestrator sends task: "review commit e4f5g6h"
T=0:35   findings, state=idle
T=0:40   orchestrator wraps up its main work, forgets to stop companion
T=0:40   companion: poll cycle 1 (empty)
T=1:10   companion: poll cycle 2 (empty)
T=1:40   companion: poll cycle 3 (empty)
T=2:10   companion: poll cycle 4 (empty)
T=2:40   companion: poll cycle 5 (empty)  → triggers check-in
T=2:41   companion: inbox_send({type:'question', subject:'still-needed',
                                body:'idle ~3 min since last task; stand down or more work?'})
                    state remains idle, reason='checking-in'
T=2:42   orchestrator (still alive) sees the question in its bash session output / TUI
T=2:43   orchestrator sends: control:stop (or "yes, here's more work")
T=2:43   companion farewells cleanly
```

Comparison: **without the check-in, the companion would idle until T=30:40** (the original `idleBudgetMs`). Saved ~28 minutes of polling × 10% of runs.

For Scenario B (orchestrator never engaged):
```text
T=0:00   minih run code-review-companion
T=0:05   companion orients, sends progress, state=idle, polls
T=5:00   no outside message ever arrived
T=5:00   companion exits with farewell, exitReason='no_engagement'
```

Saved ~25 minutes × 30% of runs.

---

## Proposed scope for plan 019 — much simpler

After this workshop, the right scope for plan 019 is **prompt-only changes to the canonical companion**:

1. Add `firstContactBudgetMs` to input-schema (default 300_000), default-on.
2. Update inside prompt:
   - Add `no_engagement` exit branch in main loop after orient.
   - Add `checking-in` heuristic (~5 empty polls since last task → send one `question`).
   - Document the request-capability via the check-in itself (no separate stanza needed; the check-in IS the example).
3. Update `instructions.md` with the new exit reasons.
4. Update output-schema's `exitReason` enum: add `no_engagement`.
5. Update `docs/how/companion-mode.md` to describe the check-in pattern.
6. Update AGENTS.md companion-mode block to reflect the new lifecycle.
7. Tests: prompt-content regression (the new exit branches exist), output-schema accepts the new enum value, smoke test with a deterministic outside harness verifying check-in fires.

**No runner changes.** **No CLI flag changes.** **No new MCP surface.** **No new domain modifications.**

This drops complexity from CS-2 to **CS-1 (trivial)**. Confidence increases because nothing in the runner moves.

---

## What about the original "expose idleBudgetMs to inside" magic wand?

Re-evaluating with this workshop's framing:

The 4+ retros asking for `idleBudgetMs` visibility were really expressing two things:
1. *"My prompt tells me to compare against a value I can't see"* — solved by removing that prompt branch entirely. Inside-agent doesn't compare anymore.
2. *"I want to make lifecycle decisions based on time-elapsed"* — replaced by the cycle-counter heuristic ("5 empty polls since last task"), which is what the agents already used as workaround in the wild.

So the magic wand is **resolved by deletion**, not by new tooling. Mark it `superseded`.

---

## What about the broader runner soft-signal protocol?

Workshop 010's Phase 2 (peer-died, file-changed, git-conflict, disk-quota, etc.) is **still valid**. Those ARE runner-only observations and the soft-signal pattern is the right way to deliver them. This workshop doesn't invalidate that — it just removes idle-budget from the list of things that need that machinery.

So workshop 010 stays. Its Phase 1 (idle) is replaced by the prompt-only solution from THIS workshop. Phase 2 of 010 remains as the future blueprint for runner-observed signals.

---

## Open questions (much fewer now)

1. **Q1 — Check-in heuristic: "5 empty polls" or "elapsed > 150s since last task"?** Empty polls is more LLM-natural (counter-based, no clock arithmetic). Time-based is more deterministic for tests.
   - **Tentative**: empty-polls. Aligns with how agents already think.

2. **Q2 — Should the check-in be at most-once-per-idle-window, or once-per-task-cycle?** Once-per-idle-window prevents nagging if the agent enters multiple idle/working/idle cycles. Once-per-task-cycle is more responsive but risks spam.
   - **Tentative**: once-per-idle-window after the previous task completed. Fresh task arrival resets eligibility.

3. **Q3 — Default `firstContactBudgetMs`: 5 min?** The 30% of runs with `tasksReceived: 0` typically idled to 30 min. 5 min is generous enough for orchestrators that have a slow boot. 2 min if we want to be aggressive.
   - **Tentative**: 5 min default, configurable per-run.

4. **Q4 — Should the check-in exit-reason match `idle_budget` or get its own value (`stand_down_confirmed`)?** Distinct exit-reason makes retro analysis sharper.
   - **Tentative**: distinct — `stand_down_confirmed` if the check-in led to `control:stop`, `idle_budget` if check-in went unanswered.

5. **Q5 — Does this protocol generalise to non-canonical companions?** The check-in heuristic and `firstContactBudgetMs` are companion-mode patterns. Other coordinated agents (one-shot agents with `coordination: enabled` for state but no orchestrator) shouldn't need them.
   - **Tentative**: companion-mode-only. Document as "if your agent is companion-mode, you should adopt this; otherwise it's optional."

---

## Decision needed before proceeding

**Does this scope match the intent?**

- ✅ Solves the actual pathology (60/30/10 split — addresses the 40%)
- ✅ Smaller change (CS-1, prompt-only)
- ✅ Preserves the runner's role for the legitimate Phase 2 signals (workshop 010)
- ✅ Resolves the magic wand by deletion, not by adding visibility tooling
- ✅ Makes the bidirectional request-capability concrete via a single example (the check-in)

If yes, plan 019's spec needs to be substantially rewritten (Design v3) and `/plan-2-clarify` resumed against the new, smaller scope.

If no, here's where the discussion can pivot:
- Maybe the runner-side protocol from 010 v1 IS warranted for Phase 2 signals, and we ship that infrastructure now even if idle-budget doesn't use it. (Scope creep risk.)
- Maybe there's a Scenario D this workshop didn't trace and the analysis is incomplete.
- Maybe the check-in question feels like prompt bloat and you'd rather just lower the default `idleBudgetMs`.

---

## Update 2026-05-05 — Unification confirmed (Option A)

> **User question** (verbatim): *"ah, so firstContactBudget, by existing hte outside agent gets a notice that they forgot to tell it what to do?"*

Confirmed. The early exit at `firstContactBudgetMs` is itself the notice — the orchestrator sees:
- `minih status` showing `dead` with `exitReason: no_engagement`
- Subsequent `outside-send` failing with "agent not running"
- A retro entry auto-harvested into `docs/retros/code-review-companion.md`

But this realisation surfaced a **unification opportunity**: the same check-in heuristic works for both Scenario B (no engagement) AND Scenario C (forgot to stop). One prompt rule, two threshold triggers.

### Unified protocol (Decision: Option A)

The inside companion has ONE check-in heuristic with two configurable thresholds:

| Trigger | Threshold (default) | Baseline | After-no-reply exit |
|---------|---------------------|----------|---------------------|
| **First-contact check-in** | `firstContactBudgetMs` (5 min) | After orientation completes | `no_engagement` |
| **Post-task check-in** | ~5 empty polls since last task (~150s) | After most-recent task's farewell | `idle_budget` (existing) |

The mechanism is the same:

```text
on threshold reached:
  inbox_send({
    type: 'question',
    subject: 'still-needed',
    body: '<context-appropriate phrasing>'
  })
  state remains 'idle' with reason 'checking-in'
  wait for reply window (~60s)
  if reply:
    normal flow (task → work, control:stop → farewell)
  else:
    farewell with appropriate exitReason
```

### Why this is better than two separate rules

- **One prompt branch**, not two — companion prompt stays compact.
- **Same observability** in `minih view` / `minih attach` — humans watching the TUI see the question pop up regardless of which threshold triggered it. That's another path-to-discovery for distracted orchestrators.
- **Same retro pattern** — `subject: 'still-needed'` shows up consistently across both scenarios; aggregating retros tells you about both forgetfulness modes through one signal.
- **Bidirectional request-capability is exercised the same way** in both cases — the check-in IS the documented example of "inside can ask outside for X."

### The two thresholds in detail

**Threshold 1 — First-contact**:
- Heuristic-friendly form: "If you have completed orientation and `firstContactBudgetMs` has elapsed without ANY outside message arriving, send the check-in question."
- Body suggestion: *"I've been oriented and idle since boot — do you have a task for me, or shall I stand down?"*
- After ~60s of no reply: farewell with `exitReason: 'no_engagement'`.

**Threshold 2 — Post-task**:
- Heuristic-friendly form: "If you have completed at least one task and have polled 5 consecutive empty long-poll cycles since the last task's completion, send the check-in question."
- Body suggestion: *"I'm idle since `<last task subject>` completed (~3 min ago) — do you need more, or shall I stand down?"*
- After ~60s of no reply: continue polling until `idleBudgetMs` (the existing safety net), exit with `exitReason: 'idle_budget'`.
- At most ONE check-in per idle window — fresh task arrival resets eligibility.

### Open questions resolved by this update

- **Q1 (heuristic shape)**: Empty-polls counter for post-task; orient-completion + simple time-elapsed for first-contact. Both LLM-friendly.
- **Q2 (once-per-window)**: Yes — at most one check-in per idle window. Don't nag.
- **Q3 (firstContactBudgetMs default)**: 5 min. Generous enough for slow orchestrator boots; short enough to make `no_engagement` discoverable while the orchestrator is still in-session.
- **Q4 (distinct exitReason)**: Yes — `no_engagement` for first-contact failure (new), `idle_budget` for post-task failure (existing — don't break what works).
- **Q5 (companion-mode-only)**: Yes — this is a companion-mode lifecycle pattern, not a coordination pattern. Other coordinated agents (one-shot tools with `coordination: enabled` for state but no orchestrator) don't need it.

### Updated scope for plan 019

1. Add `firstContactBudgetMs` to `agents/code-review-companion/input-schema.json` (default 300_000).
2. Update `agents/code-review-companion/prompt.md`:
   - Drop the `elapsed_since_last_outside_message > input.idleBudgetMs` clock-comparison branch.
   - Add the unified check-in heuristic with both thresholds.
   - Document the request-capability via the check-in pattern.
3. Update `agents/code-review-companion/output-schema.json` `exitReason` enum: add `no_engagement`.
4. Update `agents/code-review-companion/instructions.md` to mention the new check-in pattern (cross-link to companion-mode.md).
5. Update `docs/how/companion-mode.md` "Idle budget" section: replace clock-arithmetic prose with the unified check-in protocol; add subsections for each threshold.
6. Update top-level `AGENTS.md` companion-mode block: brief mention of the check-in pattern + cross-link.
7. Tests:
   - Output-schema regression (new enum value accepted).
   - Prompt-content regression (both check-in branches present).
   - Smoke test with deterministic outside harness verifying first-contact check-in fires + exits cleanly when no reply.
   - Smoke test verifying post-task check-in fires + resets on `task` reply.

**Still CS-1 (trivial)** — prompt + schema + docs only. No runner changes. No CLI flag changes. No new MCP surface.

This becomes the basis for the v3 spec. The two earlier framings (runner-as-nudger v1, outside-as-nudger v2) are both retired in favour of this **inside-asks-outside check-in** protocol. The principle stays consistent: *the layer with visibility into the condition is the layer that observes* — but the condition here is "I've been waiting and don't know if I'm still needed," which only the inside agent can observe directly.

---

## Prompt Diff Sketch — does the unified heuristic read naturally?

Validating that the unified protocol can be expressed in the canonical companion prompt without LLM-hostile features (clock arithmetic, multiple coupled flags, ambiguous phase transitions).

### Current `code-review-companion/prompt.md` § 2 (Coordination Loop)

```text
boot:
  cd $MINIH_PROJECT_ROOT
  if input.initialTask is set:
    treat it as the first inbox task (synthesised id: 'task-init-<runId>')
    work it
  else:
    run the ORIENT DEFAULT (see § 5)
  state_transition status='idle'
  inbox_send type=progress  (the orient/initial summary)

main loop:
  state_transition status='idle'  (only if not already idle)
  result = inbox_list({
    unread: true,
    waitMs: 30000,
    waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']
  })
  if result is empty:
    if elapsed_since_last_outside_message > input.idleBudgetMs:    ← LLM-hostile branch
      goto FAREWELL with exitReason='idle_budget'                    (clock arithmetic
    else:                                                            against unseen value)
      continue   # loop and long-poll again
  for each msg in result.messages:
    inbox_ack({ id: msg.id })
    if msg.type == 'control' and msg.body matches /^stop\b/:
      goto FAREWELL with exitReason='stop_requested'
    if msg.type == 'task':
      WORK the task (see § 6)
    ...
```

### Proposed § 2 — unified check-in heuristic, no clock arithmetic

```text
boot:
  cd $MINIH_PROJECT_ROOT
  # Three loop-state values you maintain across iterations:
  emptyPollStreak = 0           # consecutive empty long-polls since last engagement
  sentCheckInThisStreak = false # whether you've already asked "still needed?" in this streak
  awaitingFirstContact = true   # flips to false the first time anything outside arrives

  if input.initialTask is set:
    awaitingFirstContact = false                # initialTask counts as your first contact
    treat it as the first inbox task (synthesised id 'task-init-<runId>')
    work it
  else:
    run the ORIENT DEFAULT (see § 5)

  state_transition status='idle'
  inbox_send type=progress  (the orient/initial summary)
  goto main loop

main loop:
  state_transition status='idle'  (only if not already idle)
  result = inbox_list({
    unread: true,
    waitMs: 30000,
    waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']
  })

  if result.messages is non-empty:
    # Engagement — reset all idle tracking
    awaitingFirstContact = false
    emptyPollStreak = 0
    sentCheckInThisStreak = false
    for each msg in result.messages:
      inbox_ack({ id: msg.id })
      if msg.type == 'control' and msg.body matches /^stop\b/:
        goto FAREWELL with exitReason='stop_requested'
      if msg.type == 'task':            WORK the task (see § 6)
      if msg.type == 'question':
        ANSWER the question (small inbox_send reply, brief 'reading')
      if msg.type == 'directive':
        narrow scope of the current task (do NOT restart). If no task is in flight,
        treat as a deferred preference for the next task.
    # Done with this batch — back to top of main loop
    continue

  # result is empty — increment streak and decide
  emptyPollStreak += 1

  # 1. Already asked, still no answer? Time to go.
  if sentCheckInThisStreak and emptyPollStreak >= checkInPollIndex + 2:
    if awaitingFirstContact:
      goto FAREWELL with exitReason='no_engagement'
    else:
      goto FAREWELL with exitReason='idle_budget'

  # 2. Should we ask "still needed?" now?
  if not sentCheckInThisStreak:
    if awaitingFirstContact and emptyPollStreak >= 10:    # ≈5 min after orient with zero contact
      inbox_send({
        type: 'question',
        subject: 'still-needed',
        body: "I've been oriented and idle since boot — do you have a task for me, or shall I stand down?"
      })
      sentCheckInThisStreak = true
      checkInPollIndex = emptyPollStreak
    else if not awaitingFirstContact and emptyPollStreak >= 5:  # ≈2.5 min after last task
      inbox_send({
        type: 'question',
        subject: 'still-needed',
        body: "I'm idle since my last task completed — do you need more, or shall I stand down?",
        ackOf: <last task's id, if you remember it>
      })
      sentCheckInThisStreak = true
      checkInPollIndex = emptyPollStreak

  # 3. Otherwise, just keep long-polling
  continue

FAREWELL:
  state_transition status='stopping'
  inbox_send type=farewell  (short goodbye + exit reason)
  write the farewell envelope to $MINIH_OUTPUT_PATH (see § 7)
  exit
```

### LLM-friendliness check

| Aspect | Current | Proposed | Verdict |
|---|---|---|---|
| Clock arithmetic | `elapsed_since_last_outside_message > idleBudgetMs` (against unseen value) | None — pure integer counters | ✅ Improved |
| Variables to track | 1 implicit clock comparison | 3 explicit counters/flags | ⚠️ More state, but explicit |
| Branches in idle path | 1 (clock check) | 3 (already-asked, should-ask-now, just-poll) | ⚠️ More branches, but each is simpler |
| Reset semantics | Implicit (no clear hook) | Explicit at "engagement detected" | ✅ Improved |
| Initial-task handling | Conflates with idle baseline | Explicit flag (`awaitingFirstContact = false`) | ✅ Improved |
| LLM-natural concepts | "elapsed time since last X" | "5 polls in a row with nothing", "have I checked in yet" | ✅ Improved |

### Constants explained

| Constant | Default | What it means | Why |
|---|---|---|---|
| `firstContactPollThreshold` | 10 polls (≈5 min @ 30s/poll) | After orient + this many empty polls with nothing ever received → check-in | Gives slow orchestrator boots a window; still short enough for `no_engagement` to be discoverable |
| `postTaskPollThreshold` | 5 polls (≈2.5 min) | After task completion + this many empty polls → check-in | Tight enough to catch "forgot to stop" quickly; loose enough to tolerate orchestrator thinking time between tasks |
| `replyWaitWindow` | 2 polls (≈60s) | After check-in sent, wait this many more empty polls before exiting | Gives the orchestrator one round-trip to react; not so long that it doubles overall idle time |

All three could be exposed as input-schema fields if dogfood reveals tuning needed; default-only is fine for v1.

### Edge cases verified

1. **Task arrives during the check-in wait window**: handled by the "result.messages is non-empty" branch — resets streak, processes task, no_engagement is averted.
2. **Orchestrator answers the check-in with a question**: same as above — engagement detected, reset, dispatch the question, back to idle. New streak starts fresh (no nag).
3. **Multiple idle/work cycles**: each completed task resets `sentCheckInThisStreak` and `emptyPollStreak`, so check-ins fire at most once per idle window. Workshop Q2 resolved by mechanism.
4. **`initialTask` provided**: `awaitingFirstContact` initialized false; first-contact branch never fires; only post-task branch is reachable. Correct.
5. **Stop arrives mid-streak**: processed normally, FAREWELL with `stop_requested`. Stop-precedence preserved.
6. **Pathological orchestrator that ignores everything**: companion sends check-in, waits 2 more polls, exits. Worst case ≈ 5-6 min for `no_engagement`, ≈ 3.5 min for post-task `idle_budget`. Both massive improvements over today's 30 min.

### Verdict

The diff is implementable. The proposed prompt is **larger** than the current one (by ~25 lines) but eliminates the LLM-hostile clock arithmetic in favour of integer counter logic that LLMs handle reliably (tracking iteration counts is well within their wheelhouse — they already do this in agentic loops elsewhere).

The prompt would need a brief explanatory paragraph above the pseudo-code:

> "The check-in heuristic ensures you don't sit idle indefinitely when the orchestrator has either never engaged or has forgotten about you. You ask **once** per idle streak whether you're still needed; if no reply, you exit cleanly. Engagement (any non-empty inbox poll) resets the streak."

Adding that paragraph + the pseudo-code is well within the prompt budget. The current `code-review-companion/prompt.md` is 245 lines; the diff would push it to ~285 lines. No concern.

**Conclusion**: the unified protocol is implementable as a clean prompt rewrite. Proceed with v3 spec.

---

## Update 2026-05-05 — Defaults adjusted post-clarify

The prompt diff sketch above uses workshop-tentative thresholds (10/5/2 polls). The spec's clarify session settled on **more generous defaults** (20/10/4 polls) — biased toward safety against slow orchestrators during the dogfood period.

Effective lifetime under new defaults:
- **Scenario B (no engagement)**: ~24 polls × 30s = ~12 min (vs current 30 min)
- **Scenario C (forgot to stop)**: ~14 polls × 30s = ~7 min (vs current 30 min)

Less aggressive than the workshop's tentative numbers but still substantial improvements over the 30-min status quo. The pseudocode itself is unchanged — only the constants.
