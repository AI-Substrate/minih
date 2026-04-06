# Fix FX002: Agent UX Improvements

**Created**: 2026-04-06T08:52:00Z
**Status**: Proposed
**Plan**: [resume-prompt-plan.md](../resume-prompt-plan.md)
**Source**: Dogfood agent feedback (FTE ×2, code-review, external agent)
**Domain(s)**: cli (F1), runner (F2, F3, F4)

---

## Problem

Four UX friction points reported consistently by dogfood agents and an external agent:
1. SQLite `ExperimentalWarning` appears on every run — looks like an error
2. Agents must waste a tool call on `cd $MINIH_PROJECT_ROOT` before doing real work
3. Long tool calls (60s+) show no progress indicator
4. Validation errors say "missing property 'health'" but don't suggest the nearby `healthStatus`

## Proposed Fix

Four independent improvements. Each is small and self-contained.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| cli | **modify** | `sdk-runtime.ts`: suppress Node warnings in subprocess |
| runner | **modify** | `pretty.ts`: tool elapsed timer. `validator.ts`: fuzzy suggestions |
| agents | **modify** | `_shared/preamble.md`: rewrite cd instruction to be unmissable |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX002-1 | Suppress SQLite ExperimentalWarning | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/sdk-runtime.ts` | No `[CLI subprocess] ExperimentalWarning` in run output | Set `NODE_NO_WARNINGS=1` before CopilotClient creation, clean up in cleanup() |
| [x] | FX002-2 | Rewrite preamble cd instruction | agents | `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md`, `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts` | First line of preamble is bold cd instruction, not buried after env vars | Also update PREAMBLE_TEMPLATE in init.ts |
| [x] | FX002-3 | Tool call elapsed timer in pretty mode | runner | `/Users/jordanknight/substrate/minih/src/runner/pretty.ts` | Long-running tools show `12s...` elapsed indicator, updated every 5s | Use `setInterval` + `\r` carriage return. Clear in handleToolResult and cleanup. |
| [x] | FX002-4 | Fuzzy property name suggestions in validation errors | runner | `/Users/jordanknight/substrate/minih/src/runner/validator.ts` | "missing property 'health' — did you mean 'healthStatus'?" | Substring match first, then Levenshtein ≤3. Apply to both system and user validation. Hand-roll levenshtein (~10 LOC). |

## Workshops Consumed

- [002-agent-ux-fixes.md](../workshops/002-agent-ux-fixes.md) — full design for all 4 fixes

## Acceptance

- [ ] `minih run hello-world` shows no SQLite ExperimentalWarning
- [ ] Preamble first line is `cd {{REPO_ROOT}}` instruction
- [ ] Tool calls running > 5s show elapsed timer (`12s...`)
- [ ] Validation error for missing `health` when `healthStatus` exists shows suggestion
- [ ] All 103 existing tests pass
- [ ] `just fft` passes

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
