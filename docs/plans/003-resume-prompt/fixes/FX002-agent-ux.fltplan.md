# Flight Plan: Fix FX002 — Agent UX Improvements

**Fix**: [FX002-agent-ux.md](FX002-agent-ux.md)
**Status**: Landed

## What → Why

**Problem**: Four UX friction points flagged by dogfood agents — warning noise, wasted cd call, no progress indicator, unhelpful validation errors.
**Fix**: Suppress warning, rewrite preamble, add elapsed timer, add fuzzy suggestions.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| cli | modify | `sdk-runtime.ts` — NODE_NO_WARNINGS |
| runner | modify | `pretty.ts` — elapsed timer. `validator.ts` — fuzzy match |
| agents | modify | `preamble.md` — cd instruction first |

## Stages

- [x] FX002-1: Suppress SQLite warning (1 line)
- [x] FX002-2: Rewrite preamble cd instruction
- [x] FX002-3: Tool call elapsed timer (~30 LOC)
- [x] FX002-4: Fuzzy validation suggestions (~40 LOC)

## Acceptance

- [ ] No ExperimentalWarning in output
- [ ] Preamble leads with cd instruction
- [ ] Long tool calls show elapsed timer
- [ ] Validation suggests near-miss property names
