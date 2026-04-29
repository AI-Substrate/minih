# Workshop: Retro Harvest Discipline — Making Agent Improvement First-Class

**Type**: Integration Pattern (process / culture, not feature)
**Plan**: 010-coordination-cli-and-resume
**Spec**: _(meta — applies to every minih run, not a single feature)_
**Created**: 2026-04-29
**Status**: Draft

**Related Documents**:
- [`agents/_shared/preamble.md`](../../../../agents/_shared/preamble.md) (the producer side — agents emit retros)
- [Plan 010 retrospective](../runs/002-companion-retrospective.md) (the harvested artifact format)
- Memory: "harness-is-the-product-v2" — velocity compounds when retros land back in the harness

**Domain Context**:
- **Primary concept**: minih's improvement loop (the part of the harness that turns agent friction into harness upgrades)
- **Touched domains**: `cli` (new harvest command surface), `runner` (terminal-condition hook), `agent-prompts` (operator-side teaching), `docs` (retro ledger)

---

## Purpose

Capture **why retro harvesting kept being forgotten**, then design **strategies that make it impossible to forget**, for both human operators and harnessing LLM agents using minih. The cost of forgetting is not abstract — it's the loss of every "magicWand" insight an agent ever produced, which is the entire compounding mechanism that makes the harness improve over time.

## Key Questions Addressed

1. Why does an LLM orchestrator (or a human) skip retro harvesting even when prompted to value it?
2. What's the asymmetry between agent-side teaching (heavy) and operator-side teaching (currently missing)?
3. What concrete affordances would make retro harvest as automatic as `just fft`?
4. Which strategy is cheapest to deploy first, and which is most load-bearing?

---

## The Lapse — A Worked Example

### What happened (this session)

- Plan 010 HF-003 implementation. Companion was running. I (the orchestrator) sent four review requests during T009-T019.
- Companion run **timed out at 300s** before processing any of them. Its `output/report.json` was never written. No magicWand. No difficulties. Nothing to harvest.
- I marked the task complete without checking the companion's terminal state. The user had to ask: *"did u grab the magic wand and other difficulties?"*
- Truth on inspection: this run produced nothing harvestable. But I had also not noticed that the run had failed at all.

### Why I missed it

Five honest causes, smallest to largest:

1. **Vague verb**: my orchestration prompt said "drain findings before final commit". *Drain* is ambiguous — drain means absorb mentally? Persist to disk? Both?
2. **No explicit task**: the plan had T001-T019. There was no `T20: harvest companion retro to docs/retros/<plan>.md`. Retro harvest was treated as cleanup, not a deliverable.
3. **Prior-art trap**: last session I *had* written `runs/002-companion-retrospective.md`. My internal model said "done; not a recurring step." Each new companion run produces a *new* retro — there's no end-state.
4. **Lifecycle blindness**: companion ran in the background. I had no automatic signal for "companion completed/failed". Polling its run.json status is something I have to *remember* to do.
5. **Asymmetric teaching**: `agents/_shared/preamble.md` lines 32, 50, 53 train agents to emit retros, with strong language ("REQUIRED"). There is **no equivalent operator-side prompt** anywhere in minih saying "always harvest retros". The producer-consumer loop has only the producer half built.

The most important cause is #5. The other four are downstream of it.

---

## The Asymmetry — Why It Persists

### What minih teaches today

**Producer side (agent-facing) — strong, repeated, structured**:

- `agents/_shared/preamble.md` lines 32-115 (8 separate references to magicWand/difficulties)
- Output schema enforces `retrospective.magicWand` as REQUIRED
- Validator fails the run if it's missing
- Pretty mode tells the agent at session start which envelope shape it must emit

**Consumer side (operator-facing) — currently absent**:

- No CLI command `minih harvest`
- No `docs/retros/` directory
- No mention in `README.md` of "harvesting retros is part of the workflow"
- No plan-3 / plan-6 skill instruction "before phase complete, harvest any retros"
- No completion-time hint in `displaySummary` saying "📝 Retro available — run `minih outside retro show <slug>`"

The producer fires retros into the void. The consumer is supposed to walk over and pick them up — but nothing tells them to.

### Why this is the harness's bug, not the operator's

Per the constitution memory ("harness is the product, velocity compounding matters"): if the harness can't make the right thing automatic, the harness is incomplete. Putting the burden on the operator's memory means **velocity does not compound**, because retros pile up unharvested in run dirs and never reach the project's institutional knowledge.

---

## Strategies — Ranked by Leverage

The strategies below are deployable independently. Each costs time but each adds redundancy. The most load-bearing items are #1 (automatic appending) and #5 (skill-level enforcement); the cheapest first wins are #2 (completion hint) and #4 (`harvest` command).

### 1. Auto-append at terminal condition (most load-bearing)

**What**: When `runAgent` completes (success, degraded, or failed), the runner reads `output/report.json` and appends `retrospective.magicWand` + `retrospective.difficulties` to `docs/retros/<slug>.md` (or `<plan-id>.md` if a plan context is detectable).

**Why it dominates**: it makes harvest **impossible to forget** because no human action is required. The retro lands in the same commit as the work that produced it.

**Implementation sketch**:

```ts
// src/runner/runner.ts — at the existing completed.json write site
if (parsedReport?.retrospective) {
  await appendRetroLedger({
    slug: definition.slug,
    runId,
    runDir,
    magicWand: parsedReport.retrospective.magicWand,
    difficulties: parsedReport.retrospective.difficulties ?? [],
    targetPath: resolveRetroLedgerPath(config.cwd, definition.slug),
  });
}
```

**Trade-off**: needs to handle the failed-run case where there is no report. Use the run-folder snapshot + `events.ndjson` heuristics to capture *what we know* — at minimum a "run failed before retro" stub line.

### 2. End-of-run completion hint (cheapest)

**What**: `displaySummary` prints one extra line when a retro exists:

```
📝 Retrospective: magicWand → "..."   (run `minih outside retro show <slug>` for full)
```

**Why**: re-anchors the operator's attention at exactly the moment they were about to consider the run done.

**Cost**: ~10 lines in `pretty.ts`.

### 3. First-class `docs/retros/` directory + ledger format

**What**: Create the directory at `minih init` time. Define a simple append format:

```markdown
## 2026-04-29T08:54:22Z — code-review-companion / 2026-04-29T08-49-22-285Z-10e5

**magicWand** (target: minih): peerIdleSince field in coordination state — runner computes from last outside message timestamp; included in state_get response so long-running companions can self-manage idle budget.

**difficulties**:
- MH-004: error-code numbering collision with existing E121-E128 (severity: medium)
- MH-005: companion's own outside.md references break post-rename (severity: low)
```

**Why**: gives `grep`-able institutional memory. A new operator joining the project sees the project's friction record without crawling run dirs.

**Cost**: doc convention + a small writer helper.

### 4. `minih harvest` (or `outside retro harvest`) CLI command

**What**: explicit operator-facing verb that does the append manually for any agent run:

```bash
minih harvest code-review-companion          # latest run
minih harvest code-review-companion --run X  # specific run
minih harvest --all-since HEAD~1             # batch, since last commit
```

**Why**: gives operators an idempotent, scriptable surface. Pre-commit hooks, CI gates, and skill scripts can call this.

**Cost**: one CLI command + reuse of the writer from strategy #1.

### 5. Plan-skill enforcement (highest cultural leverage)

**What**: edit the canonical plan-3 / plan-6 / plan-7 skill templates so every plan's task table includes a final mandatory task:

```
| [ ] | Tn | Harvest companion retros to docs/retros/<plan>.md | docs | docs/retros/ | All retro files referenced; magicWand actionable items added to next-plan candidates list |
```

And a pre-phase-complete checklist item: "before declaring phase complete, run `minih harvest --since-phase-start`."

**Why**: the skills are the source of all plan templates. Embedding "harvest" there is the cultural intervention that scales — every future plan will inherit it.

**Cost**: skill text edit (one paragraph in plan-3, one in plan-6, plus the implicit checklist). Zero code.

### 6. Retro-completeness gate in `just fft`

**What**: a `just fft` stage that fails if any agent run in the last N commits has an unharvested retro:

```bash
# pseudo
for run in $(find agents/*/runs -newer .git/HEAD/last-harvest); do
  retro_present=$(jq -r '.retrospective.magicWand // empty' "$run/output/report.json")
  if [ -n "$retro_present" ] && ! grep -q "$run" docs/retros/*.md; then
    echo "UNHARVESTED: $run"
    exit 1
  fi
done
```

**Why**: shifts the discipline from "remember to harvest" to "the build is red until you harvest". Same psychology as TDD.

**Cost**: ~20 lines of bash; opt-in initially.

### 7. Companion-prompt mirror

**What**: extend `agents/_shared/preamble.md` with a short paragraph aimed at the *operator* (since LLM operators read this file too when reasoning about the system):

```markdown
## For Operators (Human or Orchestrating Agent)

When you stop reading this agent's events and consider the run "done", **two artifacts matter equally**:
1. The agent's primary work product (`output/report.json` data section)
2. The agent's `retrospective` (magicWand + difficulties)

Harvest both. The retro is **the agent's input back into the harness** — without it, this run did not improve the system.

Recommended: `minih harvest <slug>` after every successful or failed run; `--all-since <ref>` before a planning session.
```

**Why**: places the consumer-side prompt in the same file the agent itself reads, ensuring orchestrating LLMs see it whenever they read the preamble for context.

**Cost**: ~12 lines of markdown; mirrors existing surface, no schema change.

### 8. Lifecycle notification to orchestrator

**What**: when a coordinated agent's run reaches terminal state (completed, timed out, crashed), surface a structured notification to the orchestrating agent's outside inbox:

```json
{
  "id": "...",
  "sender": "system",
  "type": "lifecycle",
  "subject": "agent.terminated",
  "body": "code-review-companion run … exited with result=timeout. Retro: not written.",
  "data": { "runId": "...", "result": "timeout", "retroAvailable": false }
}
```

**Why**: solves cause #4 (lifecycle blindness). The orchestrator doesn't need to remember to poll; the system tells it.

**Cost**: runner writes one inbox message at the existing terminal-condition site. Reuses existing forwarder.

---

## Recommended Rollout

| Priority | Strategy | Effort | Risk |
|----------|----------|--------|------|
| **P0** | #2 completion hint | ~10 LOC | trivial |
| **P0** | #5 plan-skill enforcement | doc edit | trivial |
| **P0** | #7 operator paragraph in preamble | ~12 LOC | trivial |
| **P1** | #4 `minih harvest` command | ~80 LOC | low |
| **P1** | #3 `docs/retros/` ledger format | doc convention | low |
| **P2** | #1 auto-append at terminal condition | ~120 LOC | medium (failure modes) |
| **P2** | #8 lifecycle notification to orchestrator | ~30 LOC | low |
| **P3** | #6 `just fft` retro-completeness gate | ~30 LOC bash | medium (false positives) |

Recommend P0 + P1 in a single fix-mode plan. P2/P3 in a follow-up plan once the primitives exist.

---

## Worked example — How it would have caught this session's lapse

With **#2 (completion hint)** in place:
> When `code-review-companion run …10e5` exited with `result: timeout`, `displaySummary` would have printed:
> ```
> ⚠️ Retrospective: not written (run timed out before farewell)
>    Run `minih outside retro show code-review-companion --run …10e5` to inspect.
> ```
> I'd have seen this immediately and known the companion produced nothing.

With **#8 (lifecycle notification)** in place:
> A `system / agent.terminated / retroAvailable: false` message would have landed in the orchestrator's outside inbox at 22:54:22Z. My next inbox-list call would have surfaced it. I'd have known the companion had timed out 2+ hours before the user asked.

With **#5 (plan-skill enforcement)** in place:
> Plan 010 would have had a T020 task: "Harvest companion retros to `docs/retros/010.md`". I'd have hit it during T019 final gate and discovered the empty `output/report.json` then.

Defense in depth. Any one of #2, #5, or #8 alone would have prevented this specific lapse.

---

## Open Questions

### Q1: Where should the retro ledger live — `docs/retros/<slug>.md` or `docs/retros/<plan>.md`?

**OPEN**. By-slug is simpler (one file per agent, accumulates forever); by-plan keeps each plan's retros bounded. Both have value. Suggested: dual write — append to *both* files. Cost is low (one extra fs.appendFile call); benefit is each file remains readable for its purpose.

### Q2: Should auto-append (#1) be opt-out or opt-in?

**OPEN**. Opt-out (default on) maximizes adoption — every minih project gets the loop closed for free. Opt-in feels safer but means most projects never enable it. Lean opt-out with a `MINIH_NO_AUTO_HARVEST=1` escape hatch.

### Q3: Should the operator paragraph (#7) live in `_shared/preamble.md` (which is sent into the agent context) or in a sibling file like `agents/_shared/operator-notes.md`?

**RESOLVED — preamble**. LLM orchestrators read the agent's preamble when reasoning about how to run the agent; placing operator-side teaching there ensures it's in the same context window as the agent-side teaching. The mild cost (a few extra tokens in every agent prompt) is worth the cultural reinforcement.

### Q4: How does this interact with non-LLM operators (humans)?

**OPEN**. The completion hint (#2) and `minih harvest` command (#4) are useful for humans. The preamble paragraph (#7) is wasted on humans because they don't read the agent's preamble. Suggested: also add a short paragraph to `README.md` / `AGENTS_README.md` Quick Start covering the harvest step.

### Q5: What about retros from coordinated agents that never finished gracefully (timed out, crashed)?

**RESOLVED** — they get a stub entry: `magicWand: "(unavailable — run terminated as <result>)"`. This is signal in itself. Crashed runs probably *had* a difficulty worth knowing about (the crash); a stub keeps the ledger complete and the empty entry visible.

---

## Quick Reference

```bash
# After every meaningful agent run:
minih harvest <slug>                    # not yet built (P1)
minih outside retro show <slug>         # exists today; manual

# At plan completion:
minih harvest --all-since <commit>      # not yet built (P1)

# Pre-commit (once #6 lands):
just fft                                 # gate fails if unharvested retros exist
```

```markdown
# In every plan's task table (per #5):
| [ ] | Tn | Harvest companion retros to docs/retros/ | docs | docs/retros/<plan>.md | All retros from this plan's runs are present; actionable magicWand items moved to next-plan candidates |
```

```markdown
# In agents/_shared/preamble.md (per #7):
## For Operators (Human or Orchestrating Agent)

The agent emits a `retrospective` for a reason — it's the input back into the
harness. Harvest both the work product and the retro every time. Without that,
the run did not improve the system.
```

---

## Why this matters more than it looks

This is the single biggest under-invested loop in minih. Every other plan in `docs/plans/` produced retros, and most of those retros vanished into run dirs. The compounding-velocity premise of the harness assumes those retros surface. Closing this loop is probably worth as much as any single feature plan, because it changes the *rate* at which every future feature plan produces value.
