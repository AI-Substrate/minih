# FX001 Companion-Collaboration Experiment Log

**Plan**: 009-human-agent-view (Phase 1 follow-up)
**Fix**: FX001 — coordination tool-surface bugs
**Started**: 2026-04-28

---

## Hypothesis

**H0**: There is no measurable difference between collaboration patterns when a code-edit agent works alongside a long-running coordinated review companion.

**H1**: There is a measurable difference in some combination of:
- **Quality**: HIGH/CRITICAL findings caught (real bugs caught vs missed).
- **Speed (edit)**: total wall-clock to complete all tasks.
- **Speed (review tail)**: how far behind the companion lags edit completion.
- **Cost (tokens)**: outside-message volume + companion's token use.
- **Subjective feel**: whether the loop is annoying or useful.

We're testing **at least three patterns** and probably more as we learn:

| Option | Description | Cost shape | Companion role |
|--------|-------------|-----------|----------------|
| **A** | Batched delta — one targeted task review after each task completes; code agent BLOCKS for `summary` reply before marking done. | Constant per task. | Reactive / focused. |
| **B** | Continuous dribble — code agent narrates intent + heartbeats + delta; companion replies at its discretion; code agent does NOT block on reply. | More outside chatter, less wait. | Conversational / opportunistic. |
| **C** | _TBD_ — likely "post-hoc panel" (companion idle through the whole run, then one giant review at the end against full diff). Cheapest outside chatter, slowest feedback loop. | One big review at end. | Late reviewer. |
| **D+** | Open. We invent more as we learn. | — | — |

Each option has its own folder (`option-a/`, `option-b/`, `option-c/`, ...) containing:
- The **prompt variant** (e.g. `plan-6-fx001-option-a.md`) — the actual instructions the code agent runs under.
- A **`runs/`** subfolder with **ordinal result files** (`001-<short-label>.md`, `002-...`, ...) one per experiment iteration.
- The **first run** is a baseline; subsequent runs may iterate the prompt to improve outcomes.

## Why this matters

This is the harness research for plan 009. Phase 2 of plan 009 ships a Human Agent View — a UI that pairs a human (or another agent) with a running coordinated agent. The experience of pairing **must** feel right. Before we ship the UI we need to know which collaboration pattern actually helps versus which adds noise. The data captured here tells us what defaults Phase 2 should encourage.

## Outcome scoring rubric

Per run, score 1-5 (with prose evidence) on:

| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| **Quality** | Companion missed real bugs we found later | Caught most, missed some | Caught everything before it shipped |
| **Edit-speed** | Slowed me down meaningfully | Neutral | Sped me up (caught me before rework) |
| **Tail** | Tail > total edit time | Tail ≈ 30-50% of edit time | Tail ≈ 0 (companion done before me) |
| **Cost feel** | Outside chatter felt overwhelming | Acceptable | Cheap, would always run |
| **Subjective** | Annoying, would turn off | Tolerable, not transformative | Genuinely changed how I work |

## Run index

| Date | Option | Run file | Verdict (1-5 avg) | Notes |
|------|--------|----------|-------------------|-------|
| 2026-04-28 | A (strict, then pipelined A') | `option-a/runs/001-fx001-baseline.md` | **3.4** | Strict A for FX001-1..4; pipelined A' for FX001-7..8. All 9 tasks landed; 4 LOW findings (1 false positive); 0 HIGH/CRIT. Surfaced HF-001/002/003 (CLI gaps). Workshop 008 produced as direct fallout. |
| _pending_ | B | `option-b/runs/001-fx001-baseline.md` | — | First baseline. |

## Cross-option comparison

_Populated as data accumulates._

| Metric | Option A avg | Option B avg | Option C avg |
|--------|-------------|-------------|-------------|
| Total edit time | — | — | — |
| Total tail | — | — | — |
| HIGH findings caught (count) | — | — | — |
| Outside messages sent (count) | — | — | — |
| Subjective avg | — | — | — |

## Open questions for the experiment design

1. Should the same FX001 task be repeated multiple times (each as a fresh experiment iteration)? Probably not — task knowledge bleeds across runs. Better: each iteration is a different small chunk of work.
2. How do we control for code-agent variance (different sessions = different reasoning)? Likely accept variance; report N>=3 averages.
3. Should the companion's prompt also be iterated (its `instructions.md`)? Yes — track which companion prompt version was active per run.

## Next experiment to run

→ Option A baseline against FX001 (which has 9 tasks). Single iteration. Capture timing per task. Decide next iteration based on results.

---

## Harness Friction Findings

Surfaced during the experiment runs themselves — gaps in minih that hurt collaboration loops. Each one is a future spec/plan candidate.

| ID | Run | Component | Pain | Proposed fix |
|----|-----|-----------|------|--------------|
| HF-001 | Run 001 (Option A) | `outside-inbox-list` | No `--wait`; operator loop-polls with `sleep 15` to detect companion's `summary` reply. Inside MCP `inbox_list` already long-polls. | Workshop 008 — expose `--wait <ms>` (default 5 min, max 5 min) on the outside CLI; share `pollInboxLane` between MCP and CLI. |
| HF-002 | Run 001 (Option A) | CLI command tree | `outside-*` prefix means "called from outside" but `outside-inbox-list` reads the **inside** lane (replies). Misleading. State commands are already grouped, others aren't — asymmetric. | Workshop 008 — `minih outside <verb> <slug>` and `minih inside <verb> <slug>` lane subcommand groups; one-release deprecation aliases. |
| HF-003 | Run 001 (Option A) | `minih resume` | Creates a **new run dir** with fresh inbox/state instead of resuming in the original run dir. Forces operator to `cd` and re-establish context every time the long-running companion's MCP subprocess needs to be restarted (e.g. after a dist rebuild). Should also accept a structured resume prompt the agent sees as a system message ("MCP just got rebuilt — your tools are now FX001-ready") not just a follow-up user turn. | New plan / spec: `minih resume --in-place` (default? toggle?) + `--resume-prompt <text>` distinct from the user follow-up. Same SDK `sessionId`, same run dir, same inbox lanes; spawn a fresh MCP subprocess but keep the conversation, the artifacts, and the operator workflow intact. |


