# Flight Plan: Fix FX002 — Phase 2 Demo Polish

**Fix**: [FX002-phase-2-demo-polish.md](./FX002-phase-2-demo-polish.md)
**Status**: Landed

## What → Why

**Problem**: Phase 2 TUI ships functional but four defects make it demo-broken — append-mode render artifacts, empty transcript rows, collapsed workbench column, and Ctrl-C that doesn't actually exit.

**Fix**: Cap layout height + use `<Static>` for completed rows; teach the reducer to include `thinking` events and fall back when text_delta/message messageIds mismatch; replace `flexGrow` with explicit `width="60%"`/`"40%"`; SIGINT must `process.exit(130)` after unmount.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| cli | modify (internal) | `app.tsx` layout, `panes/transcript.tsx` rendering, SIGINT in `commands/view.ts` + `commands/run.ts` |
| runner | extend (internal) | `human-view-model.ts` `projectTranscript` adds `thinking` event handling + text_delta/message pairing fallback; `TranscriptEntry.actorLabel` union widens (additive contract change) |

## Stages

- [x] **FX002-1**: Reducer handles `thinking` events; transcript-entry actorLabel union widens
- [x] **FX002-2**: Reducer text_delta/message pairing fallback (heuristic for mismatched messageIds)
- [x] **FX002-3**: Layout — cap height, fix workbench width, `<Static>` for finalised rows
- [x] **FX002-4**: Transcript renders thinking distinctly + empty-content fallback text
- [x] **FX002-5**: SIGINT/SIGTERM call `process.exit(130)` after unmount in `view.ts` + `run.ts`

## Acceptance

- [x] A1 — Render stable: no accumulating empty bordered panes at top
- [x] A2 — Transcript shows actual content (thinking + final messages)
- [x] A3 — Workbench column ≥ 30 chars wide
- [x] A4 — Ctrl-C exits within 2s; no zombie children
- [x] A5 — `just fft` green; new reducer tests added
