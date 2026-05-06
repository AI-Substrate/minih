# Companion Idle Check-In Protocol — Inside-Asks-Outside

**Mode**: Simple
**Status**: Specifying — Design v3 (Inside-Asks-Outside)
**Slug**: `019-runner-idle-nudge` (slug retained from v1/v2; the runner-nudge framing is retired but the slug is in URLs and SQL rows)

📚 **This specification incorporates findings from**:
- [`docs/plans/019-runner-idle-nudge/workshops/001-idle-nudge-use-cases.md`](workshops/001-idle-nudge-use-cases.md) — **authoritative** for the protocol shape, the empirical baseline (60/30/10 distribution), and the prompt diff sketch.
- [`docs/plans/007-backgrounding/workshops/010-runner-soft-signals.md`](../007-backgrounding/workshops/010-runner-soft-signals.md) — retired for the idle-budget case but **still authoritative** for Phase 2 runner-side signals (peer-died, file-changed, git-conflict, etc.).

ℹ️ Considered running `/plan-1a-explore` — skipped because workshop 001 already documents the empirical baseline by surveying actual companion runs and the prompt structure is fully readable in `agents/code-review-companion/prompt.md`.

---

## Summary

Three earlier framings of the "idle budget visibility" magic wand were tried and retired:

| Framing | What it proposed | Why it was wrong |
|---|---|---|
| **v1 (runner-nudges)** | Runner posts `control:idle-warning` to inside before exit | Inside isn't where the pathology is — idle is healthy |
| **v2 (outside-nudges)** | Outside agent posts `control:idle-warning` to inside | Inside isn't the source of the problem; in Scenario B the outside is gone and can't post |
| **v3 — current (inside-asks-outside)** | Inside companion sends a single `still-needed?` question after a configurable empty-poll streak; exits if no reply | Matches actual pathology distribution; simple prompt rule; bidirectional protocol exercised concretely |

**The empirical evidence** (workshop 001, surveying 10 recent canonical companion runs):
- 60% happy path (`stop_requested`)
- 30% orchestrator never engaged (`tasksReceived: 0`, `idle_budget` after 30 min)
- 10% orchestrator engaged but forgot to release (`tasksReceived > 0`, `idle_budget` after 30 min)

**The protocol**: the inside companion runs a single check-in heuristic with two thresholds:
1. **First-contact** — after orientation, if no outside message arrives within ~10 minutes (20 long-poll cycles), the companion sends ONE `question:'still-needed'` to the orchestrator. After ~2 min wait without reply (4 polls), exits with new `exitReason: 'no_engagement'`.
2. **Post-task** — after a task completes, if no outside message arrives within ~5 minutes (10 long-poll cycles), the companion sends the same check-in. After ~2 min wait, exits with the existing `exitReason: 'idle_budget'`.

The check-in itself is the canonical example of the **inside-asks-outside request capability** — making the bidirectional protocol concrete instead of an under-documented convention.

**No runner changes. No CLI changes. No new MCP surface. No new domain modifications.** Prompt-only — `agents/code-review-companion/{prompt.md, instructions.md, input-schema.json, output-schema.json}` plus docs.

## Goals

- Reduce wasted compute for the 30% of runs where the orchestrator never engages — exit clean at ~12 min instead of ~30 min.
- Reduce wasted compute for the 10% of runs where the orchestrator forgets to stop — exit clean at ~7 min after last task instead of ~30 min.
- Make "orchestrator forgot to engage / forgot to stop" a **discoverable** event — orchestrators see `exitReason: 'no_engagement'` and a closed run, generating retro entries that compound system learning.
- Eliminate the "compare against `idleBudgetMs` you can't see" prompt branch that 4+ companion retros flagged as confusing.
- Establish the inside→outside request channel as a documented, expected pattern (the check-in is the canonical example) — not a separate protocol but a documented convention.
- Preserve the existing `idleBudgetMs` as a final safety net (rarely fires under normal protocol).
- Be reversible — companions can be configured back to the old behaviour by setting `firstContactPollThreshold: 0` and `postTaskPollThreshold: 0` (which disables the check-ins).

## Non-Goals

- **Any runner-side changes** — no `idle-watch.ts`, no manifest field, no lifecycle hook, no CLI flag. The runner is unchanged in this plan.
- **Any new CLI flag** — `--idle-budget-ms`, `--idle-grace-ms`, `--idle-backstop-ms` from earlier drafts are all retired.
- **Any new MCP tool** — `inbox_send`, `inbox_list`, `state_transition` already cover everything.
- **Any new env-var kill-switch** — the protocol is reversible via input-schema config (set thresholds to 0 to disable), so a kill-switch is overkill.
- **Phase 2 runner-side soft-signal protocol** — workshop 010 Phase 2 (peer-died, file-changed, git-conflict, disk-quota, etc.) remains valid and is the right target for those signals, but is out of scope for this plan.
- **Orchestrator-side enforcement** ("refuse to report done if companion is alive") — this is a coding-agent harness-level check, not a minih change. Captured as a separate followup.
- **Cross-companion generalisation** — this plan updates only the canonical `code-review-companion`. Other companions adopt the pattern when they're updated. We do NOT modify `agents/_shared/preamble.md` to enforce the protocol globally.
- **Changing existing `idleBudgetMs` semantics or default** — `idleBudgetMs` keeps its existing meaning ("absolute upper bound on idle time"); the check-in heuristic operates *within* that budget and short-circuits it well before it fires.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| `agents` (canonical companion config) | existing | **modify** | All work lands here. `agents/code-review-companion/prompt.md` rewrites § 2 (Coordination Loop) to use the unified check-in heuristic. `input-schema.json` gains optional `firstContactPollThreshold`, `postTaskPollThreshold`, `replyWaitPolls` fields. `output-schema.json` `exitReason` enum gains `no_engagement`. `instructions.md` gains a brief Lifecycle Heuristic section cross-linking companion-mode.md. |
| `runner` | existing | **consume** | Zero code changes. The runner already supports the inbox/state primitives the new prompt uses. |
| `cli` | existing | **consume** | Zero code changes. Existing `outside-send`, `outside-inbox-list`, `state get`, `status`, `view`, `attach` cover everything. |
| `mcp` | existing | **consume** | Zero code changes. |
| `adapter` | existing | **consume** | Zero code changes. |

### New Domain Sketches

None.

## Complexity

- **Score**: CS-1 (trivial)
- **Breakdown**: S=0, I=0, D=0, N=0, F=0, T=1 — total P=1
  - S=0 — single agent's config files, single doc rewrite. No code modules touched.
  - I=0 — no external dependencies; pure prompt + schema work.
  - D=0 — additive optional fields in input-schema, additive enum value in output-schema. No migrations.
  - N=0 — design pinned by workshop 001 with empirical baseline + prompt-diff sketch validated against LLM-friendliness checklist.
  - F=0 — no perf, security, or compliance concerns.
  - T=1 — light testing: prompt-content regression (new branches present), schema regression (new enum/fields accepted), one prompt smoke test against deterministic outside harness.
- **Confidence**: 0.90 — uncertainty concentrates entirely on LLM behaviour (does `gpt-5.5` reliably follow the integer-counter heuristic in the new prompt across many runs?) — mitigated by dogfood verification.
- **Assumptions**:
  - LLMs handle integer-counter logic in prompts reliably (validated by existing minih agents that already use counters elsewhere — e.g., the existing companion's `tasksReceived` tracking).
  - The `code-review-companion` is the only canonical companion that needs the update in this plan; out-of-tree companions adopt when they upgrade.
  - The 60/30/10 distribution from workshop 001's 10-run sample is representative; we'll validate this with a follow-up survey after dogfood week.
  - Default thresholds (`firstContactPollThreshold: 20`, `postTaskPollThreshold: 10`, `replyWaitPolls: 4`) are conservative starting points biased toward safety against slow orchestrators; tuning happens via dogfood retros.
- **Dependencies**:
  - `code-review-companion` agent infrastructure (already in tree).
- **Risks**:
  - **LLM doesn't follow the integer-counter heuristic reliably**: companion sends check-ins at wrong intervals, fails to reset counters, or skips them entirely. Mitigation: prompt-content regression test, dogfood week with auto-harvested retros, and the safety net of `idleBudgetMs` (worst case: companion exits at the old timeout — no regression).
  - **Check-in spam**: companion misinterprets reset rules and sends multiple check-ins per idle streak. Mitigation: `sentCheckInThisStreak` flag is explicit; smoke test verifies single-shot.
  - **Scenario B's tail**: orchestrator dead AND `replyWaitPolls` window is too short — companion exits with `no_engagement` even though orchestrator was just slow. Mitigation: tunable thresholds + the worst-case is still the same 30 min `idleBudgetMs` exit (graceful degradation).
  - **Retro confusion**: existing retros mention `idleBudgetMs`; new retros will use different vocabulary (`firstContactPollThreshold`, `postTaskPollThreshold`). Mitigation: cross-reference in retro-harvest doc; update `docs/how/companion-mode.md` glossary.
  - **Default thresholds wrong**: 5 min may be too short for slow human orchestrators; 2.5 min may be too short for thinking-LLM orchestrators. Mitigation: configurable; baseline tuning on dogfood data.

- **Phases**: Single phase (per user direction). Implementation order:
  1. Schema updates: `agents/code-review-companion/input-schema.json` (add 3 optional fields), `output-schema.json` (extend `exitReason` enum).
  2. Prompt rewrite: `agents/code-review-companion/prompt.md` § 2 (Coordination Loop) → unified check-in heuristic per workshop 001's prompt diff. Drop the clock-comparison branch.
  3. Instructions update: `agents/code-review-companion/instructions.md` — brief lifecycle-heuristic section cross-linking docs/how/companion-mode.md.
  4. Docs: rewrite `docs/how/companion-mode.md` "Idle budget" section to describe the check-in protocol; cross-link workshop 001 for design rationale; add brief mention in top-level AGENTS.md companion-mode block.
  5. Tests:
     - Schema regression: `input-schema.json` accepts new optional fields with defaults; `output-schema.json` accepts `no_engagement` exit reason.
     - Prompt-content regression: grep prompt for new branches and absence of old clock-arithmetic branch.
     - Smoke test (deterministic outside harness): boot companion, observe `still-needed` check-in fires after expected poll count, verify single-shot behaviour, verify exit reasons match scenarios.
  6. Dogfood: run canonical companion 5+ times across normal sessions; collect retros; verify `idleBudgetMs` visibility wand stops appearing.

## Acceptance Criteria

1. **AC1 — First-contact check-in fires after threshold**: A canonical `code-review-companion` started with default config and zero outside messages sends exactly ONE `inbox_send({type:'question', subject:'still-needed', body:<orientation-aware text>})` to the outside inbox after approximately 20 consecutive empty long-polls (~10 min) since orient completed. **Verification**: dogfood (real companion runs); the 20+ poll latency makes synthetic timer-based unit tests unreasonably slow. AC8 (configurable thresholds) supports tight-threshold manual repros via `--input` for ad-hoc validation.

2. **AC2 — `no_engagement` exit follows unanswered first-contact check-in**: From the same scenario, if no reply arrives within `replyWaitPolls` (default 4 polls ≈2 min), the companion farewells with `exitReason: 'no_engagement'`. The output report's `session.exitReason` matches; the new value is accepted by `output-schema.json` validation. **Verification**: schema validation is mechanical (T005 covers); behavioural exit-reason mapping is dogfood-validated.

3. **AC3 — Engagement during first-contact wait window resets streak**: Same scenario, but a `task` arrives during the post-check-in wait window. Companion processes the task normally; `awaitingFirstContact` flips false; `sentCheckInThisStreak` resets to false; `emptyPollStreak` resets to 0. Companion does NOT exit with `no_engagement`. **Verification**: pseudocode reset-block contiguity is mechanically enforced by T005 anti-split regex; LLM faithful execution is dogfood-validated.

4. **AC4 — Post-task check-in fires after threshold**: A companion that has completed at least one task sends exactly ONE `inbox_send({type:'question', subject:'still-needed', body:<post-task text>, ackOf:<last task's id>})` after approximately 10 consecutive empty long-polls (~5 min) since the task completed. Single-shot per idle streak. The post-task branch is gated on `hasCompletedTask` (NOT just `not awaitingFirstContact`) so briefing/question/directive engagement does NOT enable the post-task branch with `ackOf: null`. **Verification**: T005 mechanical assertions for the gating; behavioural firing dogfood-validated.

5. **AC5 — `idle_budget` exit follows unanswered post-task check-in**: From the same scenario, if no reply arrives within `replyWaitPolls`, the companion farewells with `exitReason: 'idle_budget'` (existing value, unchanged). Total post-task lifetime ≈ 14 polls × 30s ≈ 7 min — substantial improvement over today's 30 min. **Verification**: schema mechanical; behaviour dogfood.

6. **AC6 — Stop-precedence preserved**: A `control:stop` from outside that arrives at any point — before, during, or after a check-in — wins over the check-in flow. Companion farewells with `exitReason: 'stop_requested'` regardless of where the check-in state is. **Verification**: T005 prose-content assertion for stop-precedence rule; behavioural enforcement dogfood-validated.

7. **AC7 — Single check-in per idle streak**: A companion that has fired a first-contact check-in does NOT fire a second one in the same streak even if many more empty polls accumulate. Engagement (any non-empty inbox result) resets the flag and re-enables future check-ins. **Verification**: T005 anti-split regex protects the engagement-reset block contiguity; behavioural single-shot dogfood-validated.

8. **AC8 — Configurable thresholds work**: A companion run with `--input '{"firstContactPollThreshold": 3, "postTaskPollThreshold": 2, "replyWaitPolls": 1}'` fires its check-ins at the configured intervals (3 polls, 2 polls) and exits after 1 poll without reply. **Verification**: schema accepts tight values (T005); behavioural firing-on-tight-thresholds is the recommended **dogfood manual repro recipe** for AC1/AC4 — boot the canonical companion with these tight thresholds and observe the lifecycle without waiting 10+ min.

9. **AC9 — Disable via threshold=0**: A companion run with `firstContactPollThreshold: 0` does NOT fire the first-contact check-in at all (legacy behaviour). Same for `postTaskPollThreshold: 0`. The companion falls back to the existing `idleBudgetMs` safety-net exit. This is the "revert to old behaviour" escape hatch.

10. **AC10 — Schema validation**:
    - `input-schema.json` accepts `firstContactPollThreshold` and `postTaskPollThreshold` as optional non-negative integers (minimum 0; threshold=0 disables that check-in branch). `replyWaitPolls` is an optional **positive** integer (minimum 1; setting it to 0 makes no sense — if you fire a check-in you must wait at least one cycle). Defaults: 20, 10, 4.
    - `output-schema.json` `exitReason` enum includes `no_engagement` alongside existing values (`stop_requested`, `idle_budget`, `timeout`, `error`).
    - `minih validate code-review-companion --file <output>` passes for outputs with `exitReason: 'no_engagement'`.

11. **AC11 — Prompt content regression**: The new `prompt.md` § 2:
    - Contains the three loop-state variables (`emptyPollStreak`, `sentCheckInThisStreak`, `awaitingFirstContact`).
    - Contains both check-in branches (first-contact + post-task) with distinct body text.
    - Does NOT contain `elapsed_since_last_outside_message` or any equivalent clock-arithmetic branch.
    - Preserves all existing dispatch branches (control/stop, task, question, directive).
    Verified by greppable assertions in a prompt-content regression test.

12. **AC12 — `docs/how/companion-mode.md` rewritten**:
    - "Idle budget" section replaced with "Lifecycle and check-in protocol" describing both thresholds and the `still-needed` request pattern.
    - Cross-link to workshop 001 for empirical rationale.
    - Brief subsection on the inside-asks-outside request capability with the check-in as canonical example.
    - `AGENTS.md` "Companion-mode" block gains a one-line cross-reference.
    Auto-harvested retros after one dogfood week contain no `idleBudgetMs` visibility magic-wand entries.

## Risks & Assumptions

- **Risk**: LLM behaviour drift across model versions. The current canonical model is `gpt-5.5`; if a future model handles integer-counter logic differently, the protocol may degrade. Mitigation: dogfood retros catch this; safety net is `idleBudgetMs` (graceful degradation).
- **Risk**: Default thresholds wrong for some workflows. Mitigation: per-run override via `--input`; tunable schema fields.
- **Risk**: Other companions in the wild reuse fragments of the canonical prompt and develop drift. Mitigation: this plan documents the pattern in `companion-mode.md` so future companions can copy the convention; it does NOT enforce the pattern globally.
- **Assumption**: 60/30/10 distribution is representative. Mitigation: post-dogfood survey will validate.
- **Assumption**: Outside agents (especially LLM orchestrators) WILL respond to the `still-needed` check-in when alive and engaged. The prompt should make replying obvious; coding agents like me already handle `question`-type messages via existing patterns. If a class of orchestrators ignores check-ins, those runs degrade gracefully to the `idleBudgetMs` exit.
- **Assumption**: The check-in question is harmless even when ignored — it's a single low-priority message, no state change beyond the existing `idle` status, no resource consumption beyond the message append.

## Open Questions

> All v1/v2 questions resolved by the v3 reframe. Workshop 001 surfaced 5 candidate v3 questions; clarify session 2026-05-05 resolved all of them. See `## Clarifications` for answers. No remaining open questions for plan-3 architecture.

## Workshop Opportunities

The two design workshops already exist:
- [`workshops/001-idle-nudge-use-cases.md`](workshops/001-idle-nudge-use-cases.md) — primary, includes prompt diff sketch
- [`../007-backgrounding/workshops/010-runner-soft-signals.md`](../007-backgrounding/workshops/010-runner-soft-signals.md) — Phase 2 runner-side framework (out of scope here, but referenced)

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Outside-agent response patterns | Integration Pattern | The check-in expects a reply; documenting the orchestrator-side conventions for handling it tightens the bidirectional contract | What should the orchestrator do? Is there a "best-response" template? Does this need to land in AGENTS.md as orchestrator guidance? |

If clarify reveals other workshop-shaped topics, run `/plan-2c-workshop` against this plan.

---

## Research Context

Workshop 001 of this plan IS the research dossier. It surveys the empirical baseline (10 recent runs of the canonical companion), traces the lifecycle in detail, identifies where pathology actually lives (outside, not inside), retires two earlier framings, derives the unified protocol, and validates the prompt-diff for LLM-friendliness. Treating workshop 001 as authoritative for design rationale; this spec encodes WHAT will ship and WHY.

---

## Clarifications

### Session 2026-05-05 (carried forward from v1/v2 clarify)

These answers were captured during the v1 spec's clarify session and remain valid for v3:

**Q1 — Workflow Mode**: **Simple**. Single phase, lean gates, plan-4/plan-5 optional.

**Q2 — Testing Strategy**: **Lightweight** (Approach A). Unit-style schema regression + prompt-content regression + 1 smoke test with deterministic outside-agent harness; dogfood verification with canonical companion. Excluded: full TDD on prompt content (LLM-driven, validated via retro analysis instead).

**Q3 — Mock Usage**: **Targeted** (Option B). Real fakes for runner-side (none needed in v3, since v3 has no runner changes). Deterministic outside-agent harness for the smoke test (canned message schedule).

**Q4 — Documentation Strategy**: **Hybrid** (Option C). Rewrite `docs/how/companion-mode.md` "Idle budget" section as source-of-truth + brief mention in main `AGENTS.md` companion-mode block.

**Q5 — Domain Review**: **Confirmed**. Only `agents` modify (canonical companion's config files); `runner`, `cli`, `mcp`, `adapter` all consume only. Putting prompt/schema updates under `agents` is consistent — the canonical companion's source files ARE the contract surface.

### Session 2026-05-05 — v3 design questions

**Q6 — Default threshold values**: **More generous (Option B)**. `firstContactPollThreshold: 20` (~10 min), `postTaskPollThreshold: 10` (~5 min), `replyWaitPolls: 4` (~2 min). Rationale: prefers safer-against-slow-orchestrators over faster-cleanup. The 30% never-engaged case still gets cleaned up at ~12 min instead of 30 min (substantial improvement); the 10% forgot-stop case at ~7 min instead of 30 min. Conservative defaults reduce the risk of false-positive `no_engagement` exits during the dogfood period; these are tunable per-run via `--input` if needed.

**Q7 — Check-in body text**: **Workshop tentatives (Option A)**. First-contact: *"I've been oriented and idle since boot — do you have a task for me, or shall I stand down?"* Post-task: *"I'm idle since my last task completed — do you need more, or shall I stand down?"* Natural-language phrasing works for both human and agent orchestrators; explicit reply hints felt over-prescriptive.

**Q8 — `ackOf` on the check-in**: **Set when applicable (Option A)**. Post-task check-ins SET `ackOf` to the most recent task's id (consistent with finding/summary rules; lets the human-view workbench draw correlation lines). First-contact check-ins have no last-task-id to reference, so `ackOf` is unset (consistent with spontaneous progress/farewell messages that lack `ackOf`). The two variants are conditionally distinguished in the prompt.

**Q9 — Heuristic placement**: **Pseudocode in prompt.md, brief explainer in instructions.md (Option A)**. The unified pseudocode lives in `prompt.md` § 2 (Coordination Loop) where the LLM reads it on every iteration. `instructions.md` gains a short narrative section ("Lifecycle Heuristic") that explains WHY the check-in protocol exists, references the workshop, and cross-links `docs/how/companion-mode.md`. This matches existing prompt.md/instructions.md split conventions.

**Q10 — Dogfood success criterion**: **No formal criterion — iterate organically (Option D)**. Ship the v3 protocol, watch retros, tune thresholds based on observed behaviour. Rationale: the safety net of `idleBudgetMs` means worst-case degradation is "back to today's behaviour"; over-formalising the gate adds bureaucracy without proportional value. The auto-harvested retro pipeline already surfaces drift signals naturally — if `idleBudgetMs`-visibility wand-entries persist, the protocol needs adjustment; if they stop, it's working. Trust the existing retro feedback loop.
