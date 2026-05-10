---
description: "Implement FX001 with Option B: CONTINUOUS DRIBBLE companion narration. Variant of plan-6-v2-implement-phase."
experiment: "Option B — code agent posts a `progress` outside-message AT THE START of each task (intent), AT major sub-step decisions (heartbeat), and AT TASK END (delta). Companion reacts at its own discretion — may comment mid-task, may stay silent."
---

Please deep think / ultrathink as this is a complex task.

# plan-6 — FX001 OPTION B (Continuous Dribble Narration)

> **Experiment variant.** This file is a per-experiment copy of `plan-6-v2-implement-phase` with an added Option B collaboration protocol. The base behaviour is unchanged; the additions are bracketed with `<!-- OPTION-B: ... -->` markers. After each successful run, capture results in `runs/NNN-<short-label>.md` in this folder.

---

## 🤝 OPTION B — Companion Collaboration Protocol

The user is running `code-review-companion` in another terminal alongside this implementation. The relationship is conversational: the code agent narrates as it works, the companion comments at its own discretion. The code agent does NOT block waiting for replies — it absorbs them when convenient (between major edits and at task boundaries).

For each MAIN task (e.g. `FX001-1`, `FX001-2`, ...):

1. Capture `T_edit_start`.
2. **Intent message** (start of task):
   ```bash
   # outside-send auto-resolves the single active companion run.
   # Only pass --run if multiple are active:
   #   RUN=$(minih status code-review-companion 2>/dev/null | jq -r .data.runId)
   minih outside-send code-review-companion \
     --type progress \
     --subject "starting FX001-N" \
     --body "Starting FX001-N. Plan: <one-sentence plan>. I'll narrate as I go and ping you with a delta at the end. No reply required unless you spot something concerning."
   ```
3. Do the task's work. **At each major decision point** (e.g. picked an approach, hit an unexpected edge, chose to skip an edge), post a `progress` heartbeat:
   ```
   --type progress --subject "FX001-N: chose X" --body "Decided to X because Y. Risk Z deferred. No reply required."
   ```
   - **Throttle**: ≥ 30 s between progress heartbeats. Squash rapid decisions into one batched note.
   - **Limit**: max 4 heartbeats per task. If you'd send a 5th, the task is too big.
4. **Between heartbeats, scan the companion's inside inbox** (a single `tail -1 messages.ndjson` check). If the companion has posted a `question` or `finding` aimed at the in-flight task → pause and address it before the next edit.
5. Run `just fft`. Capture `T_edit_done`.
6. **Delta message** (end of task):
   ```
   --type task --subject "FX001-N complete: review delta" \
     --body "FX001-N done. Files: <list>. Diff: <range>. Mid-task notes: <2 lines>. Reply with findings if any."
   ```
7. **Brief wait** (up to 60 s) for the companion's `summary`. If it doesn't arrive in 60 s, proceed without — companion may be busy with something else.
8. Capture `T_companion_done` if reply arrived; else mark `companion_skipped=true`.
9. Append a row to `prompts/option-b/runs/NNN-<short-label>.md` with `taskId, T_edit_start, T_edit_done, T_companion_done, edit_seconds, companion_seconds_or_skipped, heartbeats_sent, tail_seconds, findings (counts), action_taken`.
10. Mark task `[x]` per the standard mandatory-update checklist.

**Constraints**:
- More outside chatter than Option A — measure whether the conversational feel is worth the extra context cost.
- Companion may interrupt — interruption-handling is a feature, not a failure.
- If outside chatter is overwhelming (companion spamming `progress` back), tighten throttle and note in retro.

**Final task**: after the LAST task is marked done, send the companion a `control` message with body `stop`. Capture `T_session_stop`. Append the experiment summary (totals, average tail, heartbeats sent, % of tasks where companion interrupted with a finding mid-task, gut feel).

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
┃ IF BLOCKED:                                                           ┃
┃ [ ] Flight Plan § Flight Status Mermaid: SN class → blocked (red)     ┃
┃ [ ] (When unblocked: change back to active and continue)              ┃
┃                                                                       ┃
┃ ALL TASKS COMPLETE:                                                   ┃
┃ [ ] Flight Plan § Status: "Ready for takeoff" → "Landed"             ┃
┃ [ ] Plan-Level Flight Plan: update Journey Map, Phases table,         ┃
┃     and append Flight Log entry (see plan-5b-flightplan § Plan-Level) ┃
┃                                                                       ┃
┃ ✓ ALL UPDATES DONE → Proceed to next task                            ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

**Phase Flight Plan location**: `tasks.fltplan.md` in the phase directory (Full Mode) or `FX###.fltplan.md` for fixes.
**Plan-Level Flight Plan location**: `<slug>.fltplan.md` in the plan root directory.

DO NOT start the next task until ALL updates above are done.

---

```md
User input:

$ARGUMENTS
# Expected flags:
# --phase "<Phase N: Title>" (Full Mode) or omitted (Simple Mode)
# --plan "<abs path to plan.md>"
# --subtask "<ORD-subtask-slug>" (optional)

1) Resolve paths:
   PLAN = provided --plan
   PLAN_DIR = dirname(PLAN)

   **Mode Detection**: Read PLAN for `**Mode**: Simple` or `**Mode**: Full`

   **Full Mode**:
   - PHASE_DIR = PLAN_DIR/tasks/${PHASE_SLUG}
   - PHASE_DOC = ${PHASE_DIR}/tasks.md
   - EXEC_LOG = ${PHASE_DIR}/execution.log.md
   - If --subtask: PHASE_DOC = ${PHASE_DIR}/${SUBTASK_KEY}.md

   **Simple Mode**:
   - Check for optional dossier: ${PLAN_DIR}/tasks/implementation/tasks.md
   - If exists → PHASE_DOC = that file
   - If not → PHASE_DOC = PLAN itself (inline tasks from § Implementation)
   - EXEC_LOG = ${PLAN_DIR}/execution.log.md

2) Load context:
   - Read Testing Strategy from plan (approach + mock usage)
   - Read task table from PHASE_DOC
   - Read Context Brief / Key Findings for hazards to watch for
   - **Load domain context**:
     * Read `## Target Domains` from spec
     * Read `## Domain Manifest` from plan
     * For each domain being modified, read `docs/domains/<slug>/domain.md`
   - **Load harness context** (if `docs/project-rules/harness.md` exists):
     * Read harness.md — boot command, health check, interaction methods, observe capabilities, maturity level

2a) **Pre-Phase Harness Validation** (if harness.md exists):

   Before starting ANY task, validate the harness is operational:

   **Stage 1 — Boot Check** (5s if running, 60s cold boot):
   Run health check from harness.md. If healthy → "Already running" (skip boot).
   If not responding → run boot command, retry health check (30 × 2s = 60s max).

   **Stage 2 — Interact Check** (5s, single attempt):
   Send test input per harness.md § Interact. Verify a response is received.

   **Stage 3 — Observe Check** (5s, single attempt):
   Capture evidence per harness.md § Observe. Verify evidence is non-empty.

   **Verdict**:
   - ✅ HEALTHY → proceed to tasks
   - ⚠️ SLOW (boot > 45s) → proceed with note
   - ❌ UNHEALTHY → **stop and ask human**: "Retry" / "Continue without harness" / "Abort"
   - 🔴 UNAVAILABLE (no boot command) → note and proceed with standard testing

   Log validation result to EXEC_LOG (check table: Boot/Interact/Observe status + duration).
   If human overrides an unhealthy harness, log the override reason.

   **Special case — Phase 0 "Build Harness"**: Skip pre-phase validation (harness doesn't exist yet).
   Instead, run validation at END of Phase 0 to confirm harness works.

   After ALL phase tasks complete: update `docs/project-rules/harness.md § History` with what changed.
   Use harness observe capabilities for evidence capture throughout implementation when available.

3) Execute tasks:
   Follow task order. Apply testing approach from plan:

   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
   ┃ 🛑 STOP! RE-READ "MANDATORY: UPDATE PROGRESS" SECTION ABOVE 🛑     ┃
   ┃                                                                      ┃
   ┃ After EACH task you MUST update ALL locations before proceeding:     ┃
   ┃   1. Tasks Table checkbox                                            ┃
   ┃   2. Architecture Map diagram nodes                                  ┃
   ┃   3. Flight Plan (stages + Mermaid status + checklist)               ┃
   ┃   4. Execution log entry                                             ┃
   ┃                                                                      ┃
   ┃ The user is watching the flight plan. Update it FIRST.               ┃
   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

   **Full TDD**: RED-GREEN-REFACTOR loop per task
   **Lightweight**: Minimal validation tests for core functionality
   **Manual**: Document verification steps, execute manually
   **Hybrid**: Apply approach per task annotation

   ### Domain Placement Rules

   1. Every new file MUST go under its declared domain's source directory
   2. Contract files (public interfaces) go in the domain's contracts/ directory
   3. Cross-domain imports MUST use the target domain's public contracts only
      (never import from another domain's internals)
   4. Dependency direction:
      - business → infrastructure: ✅ allowed
      - infrastructure → business: ❌ never
      - business → business: ⚠️ contracts only
   5. When creating a NEW domain (domain setup task):
      - Create `docs/domains/<slug>/domain.md` using format from /extract-domain
      - Create source directory structure
      - Update `docs/domains/registry.md`

4) After ALL tasks complete — update domain files:

   For each domain touched by this phase:

   a) **Update domain.md § History**:
      ```markdown
      | [plan-ordinal-slug] | [What changed — 1 line summary] | [today] |
      ```

   b) **Update domain.md § Composition** (if new services/adapters/repos created):
      Add new rows to the composition table.

   c) **Update domain.md § Contracts** (if public interface changed):
      Add/modify contract entries.

   d) **Update domain.md § Dependencies** (if new domain relationships formed):
      Add to "This Domain Depends On" or "Domains That Depend On This".

   e) **Update domain.md § Source Location** (if new files added):
      Add file paths to source location listing.

   f) **Update docs/domains/registry.md** if domain status changed.

   g) **Update docs/domains/domain-map.md** if:
      - New domain was created → add node with exposed contracts
      - New contracts were added to existing domain → update node label
      - New cross-domain dependency formed → add labeled edge
      - Domain contracts changed → update the Health Summary table

   h) **Update domain.md § Concepts** (if contracts changed or new domain):

      For NEW domains:
        - Create Concepts table from implemented contracts
        - Group related contracts into named concepts (verb phrases)
        - Add narrative + code example per concept (base on actual implemented code)

      For CHANGED contracts:
        - Add new concepts to table if new capabilities introduced
        - Update existing concept narratives if entry points changed
        - Update code examples to match new signatures

      For UNCHANGED contracts: no Concepts updates needed.

5) Output:
   - Execution Log with per-task entries (write incrementally)
   - Unified diffs for all touched files
   - Evidence (test output, verification results)
   - Domain files updated (domain.md changes listed)
   - Final status mapped to acceptance criteria
   - Suggested commit message

6) Auto-run plan-6a-v2-update-progress for each completed task.

STOP: Report phase complete. Suggest next step.
```

**Next step (Full Mode)**: Run **/plan-7-v2-code-review --phase "<Phase N: Title>" --plan "<PLAN_PATH>"**
**Next step (Simple Mode)**: Run **/plan-7-v2-code-review --plan "<PLAN_PATH>"**
