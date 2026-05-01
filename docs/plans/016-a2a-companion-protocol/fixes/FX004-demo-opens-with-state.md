# Fix FX004: `demo-companion` walkthrough opens with state movement

**Created**: 2026-05-01
**Status**: Proposed
**Plan**: [Companion Experience](../companion-experience-plan.md)
**Source**: Live demo F3 — workbench's outside-state row stayed empty for the first 3 minutes; demo felt visually dead until step 4
**Domain(s)**: docs + agent prompt (no code domain)

---

## Problem

The current `agents/demo-companion/outside.md` script doesn't touch outside state until Step 6 (the explicit "flip outside state" demo). For the first three steps — boot, briefing, first task — the workbench's outside-state column is empty. Combined with FX002 (companion not showing inside state transitions on briefing), the demo's whole left side appears dead for the first ~3 minutes of a 5-minute walkthrough.

The demo is supposed to *advertise* coordination richness. Empty rails for the first 60% of the demo undersells it badly.

## Proposed Fix

Re-order the `demo-companion` outside.md walkthrough so outside state moves immediately after boot, and continues moving as the conversation progresses:

1. **Step 0.5 (NEW)**: After boot, set outside state to `idle` with `data.label='briefing-incoming'` so the workbench shows operator presence.
2. **Step 1 (briefing)**: simultaneously flip outside to `in-progress` with `data.label='topic: TUI rendering'` — operator declaring "I'm engaged".
3. **Step 4 (existing flip)**: keep the explicit `state set` step but rephrase its `data.label` to demonstrate label evolution (e.g., `'thinking-out-loud-mode'`).
4. **Step 7 (stop)**: flip outside to `done` with `data.label='demo complete'` after the stop signal.

Update the matching workshop (`workshops/001-companion-demo.md`) so the demo design doc reflects the new opening.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| Docs / agent | Primary | `outside.md` walkthrough; workshop |

**Risk**: very low — this only changes the operator's script. No code change. No companion behaviour change.

**Sequencing**: FX004 MUST be applied AFTER FX003-4 (both fixes touch `agents/demo-companion/outside.md`; FX003-4 fixes `sleep+cat` patterns first, then FX004 reorders steps). Implementing FX004 first will collide with FX003-4's edits.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX004-1 | Insert "Step 0.5 — declare presence" in `agents/demo-companion/outside.md` between boot and briefing: `outside state set` to `idle` + `data.label='briefing-incoming'`. Update step numbering downstream. | agent | `agents/demo-companion/outside.md` | New step exists; numbering consistent | Renumber subsequent steps |
| [ ] | FX004-2 | Pair the briefing step with an outside-state flip to `in-progress` + `data.label='topic: TUI rendering'`. Make it a single "kickoff" block in the walkthrough. | agent | `agents/demo-companion/outside.md` | Step shows both `inbox send --type briefing` AND `state set --status in-progress` together | Ensures the workbench has two simultaneous events to render |
| [ ] | FX004-3 | Add a final state flip after stop: `outside state set --status done --data-json '{"label":"demo complete"}'` BEFORE reading the farewell envelope. | agent | `agents/demo-companion/outside.md` | Walkthrough ends with `done` outside-state visible alongside the farewell | Closes the visual loop |
| [ ] | FX004-4 | Update `docs/plans/016-a2a-companion-protocol/workshops/001-companion-demo.md` to reflect the new step ordering. Update the §4 step table and the §5 reference card. | docs | `docs/plans/016-a2a-companion-protocol/workshops/001-companion-demo.md` | Workshop matches the agent's outside.md | Drift between workshop and agent's outside.md is a known foot-gun |
| [ ] | FX004-5 | Re-run the demo end-to-end (depends on FX001 + FX002) and capture a screenshot of the workbench at peak conversation showing both inside and outside timelines populated. | verification | (live run) | Screenshot saved or referenced | This is the user-acceptance evidence |

## Workshops Consumed

- `workshops/001-companion-demo.md` — being updated by FX004-4

## Acceptance

- [ ] Outside state moves before the first inside response.
- [ ] Outside state moves at least 3 times during the demo (kickoff, mid-stream label flip, done).
- [ ] Workshop and `outside.md` script agree on step numbering and content.
- [ ] Demo's workbench timeline shows continuous activity in BOTH columns (depends on FX002 also being green).

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
