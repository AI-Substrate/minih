---
description: "Implement plan 011 with Option C: POWER ON MODE — fire-and-forget review pings to a live companion, no blocking, drain findings before final commit. Variant of plan-6-v2-implement-phase."
experiment: "Option C — Power On Mode. Code agent works at full speed. After each commit boundary (HF tier), sends ONE outside-message to the companion with file list + focus. Does NOT wait for reply. Drains companion findings opportunistically and at the final-gate task. Hard rule: never block on companion latency."
---

Please deep think / ultrathink as this is a complex task.

# plan-6 — Plan 011 OPTION C (POWER ON MODE)

> **Experiment variant.** This file is a per-experiment copy of `plan-6-v2-implement-phase` with the **Power On Mode** companion-collaboration protocol. The base behaviour is unchanged; the additions are bracketed with `<!-- OPTION-C: ... -->` markers. After each successful run, capture results in `runs/NNN-<short-label>.md` in this folder.

> **Why "Power On"**: implementation does not idle. The code agent treats the companion as an asynchronous reviewer running in parallel — it pings, it keeps going, it absorbs replies whenever they arrive, and it makes sure all findings have been considered before the final commit. Companion latency (slow, fast, or even crashed) NEVER stalls implementation.

---

## ⚡ OPTION C — Power On Mode Companion Protocol

The user is running `code-review-companion` in another terminal. **Do NOT wait** for it between tasks. Instead:

### Per-task rhythm (no blocking)

For every task T###:

1. **Pre-task progress update** (per the mandatory checklist below).
2. **Do the task**: write tests, implement, run tests, commit if it's a commit-boundary task.
3. **Post-task progress update**.
4. **Move on immediately.** Do NOT poll the companion. Do NOT ask "is there a reply yet?" Do NOT idle.

### Per-commit-boundary ping (fire-and-forget)

When a logical group of tasks lands as a single commit (e.g. the HF-A bundle, or HF-B, etc. — see plan's "Notes for /plan-6 implementation" for commit boundaries):

1. **AFTER** the commit lands locally, fire ONE message:

   ```bash
   minih outside inbox send code-review-companion \
     --type review-request \
     --subject "review <commit-label>" \
     --body "<commit short SHA> just landed. Scope:
   - <abs path 1>
   - <abs path 2>
   ...
   Diff: git show <sha> (or HEAD if just-pushed)
   Focus: <2-3 sentence prompt — what changed, what's risky>
   Reply with one inbox 'finding' per real issue and a 'summary' message with verdict.
   I will NOT block on your reply — I'm continuing to the next tier. Drain queue at end."
   ```

2. Note `T_ping_sent` ISO-8601 in the execution log.
3. **Continue immediately** to the next task. Do NOT read the inbox now.

### Opportunistic drain (between tiers, free-form)

Between commit boundaries you MAY (not must) glance at the companion's inbox:

```bash
minih inside inbox list code-review-companion --type finding 2>/dev/null
minih inside inbox list code-review-companion --type summary 2>/dev/null
```

If anything HIGH or CRITICAL is in the inbox, address it inline before proceeding (mark a discoveries-table entry). Do not chase MEDIUM/LOW until the drain phase.

### Drain phase (mandatory before the final-gate task)

**Before** the plan's final-gate task (e.g. T013 in plan 011), the agent MUST drain the companion inbox:

1. Send a final ping:

   ```bash
   minih outside inbox send code-review-companion \
     --type review-request \
     --subject "drain — final gate approaching" \
     --body "Implementation is at <last-commit-label>. Final gate (just fft + smoke) is about to run. Send a 'summary' message with overall verdict and any outstanding HIGH/CRITICAL findings. Then 'control' farewell."
   ```

2. Wait up to 60 s for a `summary` message via `minih inside inbox list code-review-companion --wait 60000 --type summary`.
3. If a summary arrives:
   - HIGH/CRITICAL → fix inline (or surface to user with a clear ask), THEN run final gate
   - MEDIUM/LOW → log to discoveries table; final gate can proceed
4. If no summary arrives within 60 s:
   - Treat as `companion_unresponsive=true`, log it, **proceed with final gate anyway** (the human is also reviewing)
5. Run the final-gate task as written.
6. **AFTER** the final gate is green, send the companion the farewell:

   ```bash
   minih outside inbox send code-review-companion \
     --type control \
     --subject "stop" \
     --body "Plan 011 implementation complete. Final gate green at <commit sha>. Thanks. Stop."
   ```

### Hard rules (Power On Mode invariants)

- **Never wait between tasks.** The whole point of Power On Mode is no idling.
- **Always commit-boundary ping.** Never let a commit land without telling the companion.
- **Always drain before final gate.** This is the single mandatory blocking moment, capped at 60 s.
- **Per-ping = constant work.** Always pass only the files that changed in THIS commit (the recently-landed scope), never `HEAD~N..HEAD` with growing N. The companion sees a stable review surface.
- **Crash tolerance.** If the companion has died (no reply at drain phase, status=`failed` in `run.json`), log `companion_dead=true` and continue. The dogfood result is itself useful.
- **Capture timestamps.** For each ping: `T_ping_sent`, `T_first_reply` (best-effort), `T_drain_complete`. Append to the experiment run file at the end.

### Run-file format (`runs/NNN-<label>.md`)

After ALL tasks complete, append an experiment summary:

```markdown
# Run NNN — <short label>

**Date**: <iso-date>
**Plan**: 011-retro-harvest-loop
**Mode**: Power On (Option C)
**Companion run**: <runId>
**Result**: <ok | partial | failed>

## Per-Tier Pings

| Tier | Commit | Files | T_ping_sent | T_first_reply | Findings (H/M/L) |
|------|--------|-------|-------------|----------------|-------------------|
| HF-A | <sha>  | <count> | ... | ... | 0/2/1 |
| HF-B | ...    | ...     | ... | ... | ... |

## Drain Phase

- T_drain_ping_sent: ...
- T_drain_summary_received: ... (or "timed out")
- Verdict from companion: <quote summary verbict>
- Outstanding findings actioned: <list>
- Outstanding findings deferred: <list>

## Power On Mode — How It Felt

- Total implementation time (first edit → final commit): <minutes>
- Did Power On mode let me work continuously? <yes/no, why>
- Did the companion ever block me? <yes/no, when>
- Was the drain phase enough to catch real issues? <yes/no, evidence>
- Magic Wand for Option C: <one-liner — what would make this even better>
- Difficulties (if any): <list with severity>
```

---

## 📝 LOG DISCOVERIES AS YOU GO

Throughout implementation, capture discoveries in:
1. **Execution Log** (`execution.log.md`) — detailed narrative
2. **Discoveries Table** (`## Discoveries & Learnings` in tasks.md or plan) — structured record

Log when you encounter: something unexpected, needed research, hit a trouble spot, found a gotcha, made a decision, introduced debt, or gained an insight.

---

## 🛑 MANDATORY: UPDATE PROGRESS AFTER EVERY TASK — NO EXCEPTIONS

The user watches the flight plan for live progress. Updating it is **highest priority**.

After EACH task you MUST update these locations before proceeding to the next task:

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Per-Task Progress Checklist — use this EVERY time, NO EXCEPTIONS      ┃
┃                                                                       ┃
┃ STARTING T00X:                                                        ┃
┃ [ ] Tasks Table: [ ] → [~]                                            ┃
┃ [ ] Architecture Map: T00X node → :::inprogress (orange)              ┃
┃ [ ] Flight Plan § Stages: matching stage [ ] → [~]                    ┃
┃ [ ] Flight Plan § Flight Status Mermaid: SN class pending → active    ┃
┃ [ ] Flight Plan § Checklist: matching task [ ] → [~]                  ┃
┃                                                                       ┃
┃ COMPLETING T00X:                                                      ┃
┃ [ ] Tasks Table: [~] → [x]                                           ┃
┃ [ ] Architecture Map: T00X node → :::completed (green)                ┃
┃ [ ] Architecture Map: File nodes touched → :::completed               ┃
┃ [ ] Flight Plan § Stages: matching stage [~] → [x]                   ┃
┃ [ ] Flight Plan § Flight Status Mermaid: SN class active → done       ┃
┃ [ ] Flight Plan § Checklist: matching task [~] → [x]                  ┃
┃ [ ] Execution Log: append task entry with evidence                    ┃
┃ [ ] Discoveries table: add any gotchas/insights found                 ┃
┃                                                                       ┃
┃ IF BLOCKED (something OTHER than companion latency):                  ┃
┃ [ ] Flight Plan § Flight Status Mermaid: SN class → blocked (red)     ┃
┃ [ ] (When unblocked: change back to active and continue)              ┃
┃ [ ] Note: companion latency NEVER counts as blocked in Power On mode. ┃
┃                                                                       ┃
┃ ALL TASKS COMPLETE:                                                   ┃
┃ [ ] Flight Plan § Status: "Ready for takeoff" → "Landed"             ┃
┃ [ ] Plan-Level Flight Plan: update Journey Map, Phases table,         ┃
┃     and append Flight Log entry (see plan-5b-flightplan § Plan-Level) ┃
┃                                                                       ┃
┃ ✓ ALL UPDATES DONE → Proceed to next task                            ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

DO NOT start the next task until ALL updates above are done.

---

```md
User input:

$ARGUMENTS
# Expected flags:
# --plan "<abs path to plan.md>"  (required)

1) Resolve paths:
   PLAN = provided --plan
   PLAN_DIR = dirname(PLAN)
   EXEC_LOG = ${PLAN_DIR}/execution.log.md

   **Mode Detection**: Read PLAN for `**Mode**: Simple` or `**Mode**: Full`. Plan 011 is Simple.

   **Simple Mode**:
   - PHASE_DOC = PLAN itself (inline tasks from § Implementation)

2) Load context:
   - Read Testing Strategy from spec § Testing Strategy + plan § Implementation header
   - Read task table from PHASE_DOC
   - Read Validation Record (HIGH/MEDIUM fixes already applied — these are NOT new findings, treat as locked decisions)
   - Read § Notes for /plan-6 implementation for commit-boundary guidance
   - **Load domain context**:
     * `docs/domains/cli/domain.md` and `docs/domains/runner/domain.md` (the only two touched)
   - **Pin companion run id** for outside-send: `ls -t agents/code-review-companion/runs/ | head -1`. If multiple are active, pass `--run` explicitly.

3) Execute tasks in order. Apply Hybrid testing per task annotation:
   - **TDD RED → GREEN** for: T005, T006, T010, T011 (test files written first, must FAIL before implementation lands)
   - **Lightweight assertion-style** for: T009, T012, parts of T001/T013
   - **Doc-only** for: T002 (preamble), T003 (READMEs), T007 (template scaffolding)

4) Commit boundaries (per plan § Notes):
   - Bundle 1 — HF-A: T001 + T002 + T003 + T004 → ONE commit "feat: retro harvest HF-A teaching surface"
   - Bundle 2 — HF-B: T005 + T006 + T007 + T008 + T009 → ONE commit "feat(cli+runner): minih harvest verb + bundled retros template"
   - Bundle 3 — HF-C: T010 + T011 → ONE commit "feat(runner): auto-append retros at terminal condition"
   - Bundle 4 — HF-D: T012 → ONE commit "feat(cli): doctor reports unharvested retros + ledger size warn"
   - Final — T013: domain.md updates + final fft → ONE commit "docs: plan 011 retro harvest closeout"

5) Per Power On Mode protocol above:
   - Fire ONE companion ping after EACH commit lands (5 pings total)
   - Drain phase mandatory before T013 final gate (60 s wait cap)
   - Continue regardless of companion latency or death

6) After ALL tasks complete — update domain files:
   For each domain (cli, runner):
   a) **Update domain.md § History** with plan 011 entry
   b) **Update § Concepts** if new concepts introduced (cli gets `harvest`)
   c) Update § Composition / Contracts / Source Location as needed

7) Output:
   - Execution Log with per-task entries
   - Per-tier evidence (test output, commit shas)
   - Run file at `${PLAN_DIR}/prompts/option-c/runs/001-power-on.md` with experiment summary
   - Final status mapped to acceptance criteria

8) Auto-run plan-6a-v2-update-progress for each completed task is OPTIONAL in Simple Mode.

STOP: Report phase complete. Suggest next step.
```

**Next step**: Run `/plan-7-v2-code-review --plan "${PLAN_PATH}"` for an independent review pass (the companion has been doing live review during implementation; plan-7 is the "second-pair-of-eyes" wrap-up).
