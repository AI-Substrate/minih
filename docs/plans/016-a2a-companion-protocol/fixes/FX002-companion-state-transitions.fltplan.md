# Flight Plan: Fix FX002 — Companion state transitions + wait_for_any investigation

**Fix**: [FX002 dossier](./FX002-companion-state-transitions.md)
**Status**: Ready (FX002-1 gates the rest)

## What → Why

**Problem**: Companion didn't show state transitions on briefing in the live demo. Investigation (FX002-1, ✅ done 2026-05-01) revealed the cause is **Path C — vocabulary/schema mismatch**: AJV silently rejected non-`idle` transitions because the prompt's vocabulary (`reading|reporting|blocked|stopping`) isn't in the default schema enum (`idle|in-progress|paused|reviewing|complete|error`).

**Fix**: Ship a custom inside-state schema for `demo-companion` matching the prompt's vocabulary; add a `doctor` warning for prompt↔schema enum drift; teach agents to surface schema rejections via `progress` messages.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| Agent (per-agent fix) | Primary | New `agents/demo-companion/state/inside-state.schema.json` |
| `cli` | Primary (systemic) | `doctor` adds prompt↔schema enum drift check |
| Agent prompts | Tangential | Shared preamble: surface schema errors via `progress` |

## Stages

- [x] **Stage 1: Investigate** — verdict written to `.log.md` (Path C confirmed; A and B ruled out)
- [x] **Stage 2: Per-agent schema** — ship `agents/demo-companion/state/inside-state.schema.json`
- [ ] **Stage 3: Systemic doctor warning** — `prompt-state-vocabulary-drift` check
- [ ] **Stage 4: Soft-fail preamble** — surface schema rejections via `progress`
- [ ] **Stage 5: Verify** — re-run briefing; workbench shows transitions

## Acceptance

- [x] Verdict log clear (Path C; not A or B)
- [ ] After FX002-2, briefing → visible state transitions + threaded `progress` reply
- [ ] `doctor` flags vocabulary drift before fix; clears after
- [ ] `just fft` green
