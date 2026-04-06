# Flight Plan: Fix FX001 — Quickstart Command

**Fix**: [FX001-quickstart.md](FX001-quickstart.md)
**Status**: Landed

## What → Why

**Problem**: New users need 5 steps and manual file editing before seeing their first successful agent run.
**Fix**: `minih quickstart` — scaffold + run hello-world in one command. Zero-to-success in 60 seconds.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| cli | modify | New `quickstart.ts` command, register in `index.ts` |
| runner | consumed | No changes — uses existing `resolveAgent()`, `runAgent()` |

## Stages

- [x] FX001-1/2: Create quickstart command + register
- [x] FX001-3/4: Edge cases + celebration output
- [x] FX001-5/6: README + domain docs

## Acceptance

- [ ] `minih quickstart` from fresh dir → scaffold + run + celebrate
- [ ] Idempotent — second run skips scaffold
- [ ] Missing GH_TOKEN → scaffold only + actionable error
- [ ] README leads with quickstart
