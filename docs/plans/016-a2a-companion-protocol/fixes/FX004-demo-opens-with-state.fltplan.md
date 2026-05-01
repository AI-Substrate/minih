# Flight Plan: Fix FX004 — Demo opens with state movement

**Fix**: [FX004 dossier](./FX004-demo-opens-with-state.md)
**Status**: Ready

## What → Why

**Problem**: Demo's outside-state column is empty for the first 3 minutes of a 5-minute walkthrough — combined with FX002, the demo looks dead for 60% of its run.

**Fix**: Reorder `demo-companion/outside.md` so outside state moves immediately after boot, kickoff, mid-stream, and on close. Keep the workshop in sync.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| Docs / agent | Primary | walkthrough script + workshop |

## Stages

- [ ] **Stage 1: Declare presence** — Step 0.5 outside state set after boot
- [ ] **Stage 2: Kickoff** — pair briefing with outside `in-progress` flip
- [ ] **Stage 3: Closure** — final outside `done` flip before reading farewell
- [ ] **Stage 4: Workshop sync** — update `001-companion-demo.md` to match
- [ ] **Stage 5: Verify** — re-run demo, capture workbench screenshot

## Acceptance

- [ ] Outside state moves ≥ 3 times during demo
- [ ] Workshop and outside.md agree
- [ ] Both timelines populated in the workbench
