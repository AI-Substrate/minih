# Run 001 — Option B — FX001 Baseline

**Date**: _pending_
**Plan-6 prompt variant**: `prompts/option-b/plan-6-fx001-option-b.md`
**Companion prompt version**: as committed at start of this run
**Companion runId**: _pending_
**Code-agent session model**: _pending_

---

## Setup

- `cd /Users/jordanknight/substrate/minih`
- Terminal A: `node dist/cli/index.js run code-review-companion`
  - Capture `T_session_start`: _pending_
  - Capture companion `runId`: _pending_
- Terminal B: invoke `/plan-6` using the prompt at `prompts/option-b/plan-6-fx001-option-b.md` for FX001.

## Per-task timings

| Task | Files changed | T_edit_start | T_edit_done | T_companion_done | edit_sec | companion_sec | tail_sec | heartbeats | findings (CRIT/HIGH/MED/LOW) | Companion interrupted mid-task? | Action |
|------|---------------|--------------|-------------|-------------------|---------|---------------|---------|-----------|-------------------------------|--------------------------------|--------|
| FX001-1 | `test/mcp/coordination-contract.test.ts` (new) | _pending_ | _pending_ | _pending_ | — | — | — | — | —/—/—/— | — | — |
| FX001-2 | `src/mcp/tools/state.ts` | | | | | | | | | | |
| FX001-3 | `src/mcp/types.ts`, `src/mcp/tools/inbox.ts` | | | | | | | | | | |
| FX001-4 | `test/mcp/types.test.ts`, `workshops/007-...md` | | | | | | | | | | |
| FX001-5 | (manual) | | | | | | | | | | |
| FX001-6 | (gate only) | | | | | | | | | | |
| FX001-7 | `agents/coordination-smoke-test/prompt.md` | | | | | | | | | | |
| FX001-8 | `agents/coordination-smoke-test/output-schema.json` | | | | | | | | | | |
| FX001-9 | (manual) | | | | | | | | | | |

## Wrap-up

- `T_session_stop`: _pending_
- `T_session_total`: _pending_
- Total `edit_sec`: —
- Total `tail_sec`: —
- Total heartbeats sent: —
- Total outside messages sent (count): —
- Companion findings: total —, HIGH/CRIT —
- Tasks where companion interrupted mid-task: —

## Companion artifacts

- Final `farewell` envelope: `agents/code-review-companion/runs/<runId>/output/report.json`
- Inside inbox (full thread): `agents/code-review-companion/runs/<runId>/inbox/inside/messages.ndjson`
- State history: `agents/code-review-companion/runs/<runId>/state/history.ndjson`

## Subjective scoring (1-5)

| Dimension | Score | Evidence |
|-----------|-------|----------|
| Quality | — | — |
| Edit-speed | — | — |
| Tail | — | — |
| Cost feel | — | — |
| Subjective | — | — |
| **Average** | — | |

## Findings the companion caught vs we caught later

| When | Severity | Finding | Caught by |
|------|----------|---------|-----------|

## What I'd change for run 002

_Populated post-run._

## Notes / surprises

_Populated post-run._
