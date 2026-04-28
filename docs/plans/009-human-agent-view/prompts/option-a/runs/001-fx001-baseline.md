# Run 001 — Option A — FX001 Baseline

**Date**: 2026-04-28
**Plan-6 prompt variant**: `prompts/option-a/plan-6-fx001-option-a.md`
**Companion prompt version**: HEAD (uncommitted edits from FX001 subtask)
**Companion runId**: `2026-04-28T19-26-31-074Z-0527`
**Code-agent session model**: claude-opus-4.7-1m-internal

---

## Setup

- `cd /Users/jordanknight/substrate/minih`
- Terminal A: `minih run code-review-companion`
  - `T_session_start`: 2026-04-28T09:26:31.074Z
  - Companion `runId`: 2026-04-28T19-26-31-074Z-0527
- Terminal B: invoking Option A protocol from this prompt.

## Per-task timings

| Task | Files changed | T_edit_start | T_edit_done | T_companion_done | edit_sec | companion_sec | tail_sec | findings (CRIT/HIGH/MED/LOW) | Action |
|------|---------------|--------------|-------------|-------------------|---------|---------------|---------|-------------------------------|--------|
| FX001-1 | `test/mcp/coordination-contract.test.ts` (new) | 09:27:41Z | 09:29:23Z | 09:33:34Z | 102 | 251 | 251 | 0/0/0/2 | APPROVE — both LOW (cosmetic) logged; continue |
| FX001-2 | `src/mcp/tools/state.ts` | 09:35:01Z | 09:35:31Z | 09:37:10Z | 30 | 99 | 99 | 0/0/0/1 | APPROVE — F003 doc-precision LOW fixed inline (coordination-smoke-test has no custom schema, only coordination-loop-validator does) |
| FX001-3 | `src/mcp/types.ts`, `src/mcp/tools/inbox.ts` | 09:37:55Z | 09:38:44Z | 09:39:52Z | 49 | 68 | 68 | 0/0/0/0 | APPROVE — 0 findings, clean fix |
| FX001-4 | `test/mcp/types.test.ts`, `workshops/007-...md` | 09:40:10Z | 09:40:58Z | 09:41:46Z | 48 | 48 | 48 | 0/0/0/0 | APPROVE — 0 findings |
| FX001-5 | (manual) | 09:51:57Z | 09:52:00Z | n/a | 3 | n/a | n/a | n/a | Manual evidence: state files + history exist; 11 ackOf-bearing messages (note: ackOf came from inbox_ack pre-fix, not from new inbox_send param — companion was running stale dist) |
| FX001-6 | (gate only) | 09:52:00Z | 09:52:30Z | n/a | 30 | n/a | n/a | n/a | `just fft` exit 0; 472 passed, 9 skipped (481), 0 vulns |
| FX001-7 | `agents/coordination-smoke-test/prompt.md`, `outside.md` | 10:14:01Z | 10:14:35Z | 10:18 (drained later) | 34 | n/a (parallel) | n/a (Option A' switch) | 0/0/1/1 | APPROVE — F004 false positive (env var resolution verified in src/runner/runner.ts:389), F005 LOW noted |
| FX001-8 | `agents/coordination-smoke-test/output-schema.json` | 10:14:53Z | 10:15:30Z | 10:18 (drained later) | 37 | n/a (parallel) | n/a | 0/0/0/0 | APPROVE — 0 findings |
| FX001-9 | (manual) | 10:15:50Z | 10:21:50Z | n/a | 360 | n/a | n/a | n/a | Live smoke `verdict: all-pass`, all 3 artifact flags true, all 6 toolChecks pass with 248-382-char evidence quoting real disk artifacts |

## Wrap-up

- `T_session_stop`: 2026-04-28T10:22:46Z (companion runId 2026-04-28T20-13-09-545Z-ea71 — *resumed* mid-run after dist rebuild; original runId 2026-04-28T19-26-31-074Z-0527)
- `T_session_total`: ~56 min wall-clock across both companion runs
- Total `edit_sec`: ~700 (approx — task 9 dominated at 360s due to live smoke completion wait)
- Total `tail_sec`: 466 (sum of FX001-1..4 strict-Option-A tails: 251 + 99 + 68 + 48; FX001-7/-8 ran in pipelined Option A', tail ≈ 0)
- Outside messages sent: 11 (8 task review requests + 1 control:stop on first companion + 1 control:stop on resumed companion + smoke trigger)
- Companion findings: 4 total (1 LOW + 3 LOW). 0 HIGH/CRIT. 0 mid-run blocks.

## Companion artifacts

- Final `farewell` envelope: `agents/code-review-companion/runs/2026-04-28T20-13-09-545Z-ea71/output/report.json` (after stop drains)
- Inside inbox (full thread): `agents/code-review-companion/runs/2026-04-28T20-13-09-545Z-ea71/inbox/inside/messages.ndjson`
- State history: `agents/code-review-companion/runs/2026-04-28T20-13-09-545Z-ea71/state/history.ndjson`
- Smoke run that proved FX001 end-to-end: `agents/coordination-smoke-test/runs/2026-04-28T20-17-20-863Z-cc2b/`

## Subjective scoring (1-5)

| Dimension | Score | Evidence |
|-----------|-------|----------|
| Quality | 4 | 4 LOW findings caught (1 was a false positive on env var). 0 HIGH/CRIT missed. Companion's APPROVE/REQUEST_CHANGES verdicts matched my own gut after-the-fact reviews. |
| Edit-speed | 3 | Strict Option A (FX001-1..4) felt slowing — measured tail of 251+99+68+48s = 7.7 min spent waiting. Pipelined Option A' (FX001-7..8) felt much better, and the drained findings still arrived in time to act on. |
| Tail | 2 | Strict Option A tail accumulates linearly with task count. Worst: FX001-1 had companion_sec(251) > edit_sec(102) — i.e. tail > edit. Pipelined improves this dramatically. |
| Cost feel | 4 | Companion idle long-poll = ~0 token cost between tasks. Per-task review is bounded constant work (didn't grow with N). 11 outside messages total over 56 min is light. |
| Subjective | 4 | Genuinely useful — companion caught the silent contract failures that tightened the smoke-test agent. Strict Option A is too slow as designed; pipelined Option A' is the right pattern. The blocking inbox (HF-001) and CLI restructure (HF-002) and resume-in-place (HF-003) are real harness gaps surfaced by living the workflow. |
| **Average** | **3.4** | Strong baseline; pipelined+blocking-inbox would push this to 4+. |

## Findings the companion caught vs we caught later

| When | Severity | Finding | Caught by |
|------|----------|---------|-----------|
| FX001-1 | LOW | F001 redundant type cast in case (c) | Companion |
| FX001-1 | LOW | F002 RED-bar uses exception path not assertion | Companion |
| FX001-2 | LOW | F003 doc comment overclaimed legacy back-compat scope (smoke-test has no custom schema) | Companion (fixed inline before next task) |
| FX001-7 | LOW | F004 MINIH_INBOX_DIR section could clarify (false positive — env actually does point to inbox/) | Companion (verified false, no action) |
| FX001-7 | LOW | F005 hardcoded statuses assume default schema | Companion (acceptable — smoke-test uses default) |
| HF-001 | — | outside-inbox-list has no --wait; operator polls every 15s with sleep | Self (during the run) |
| HF-002 | — | outside-* prefix means "called from outside" but reads inside lane — misleading | Self (during the run) |
| HF-003 | — | resume creates new run dir instead of resuming in place | User (during the dist-rebuild restart) |
| Mid-run | — | Companion was running stale dist for FX001-1..4 reviews; F001 errors visible in events.ndjson | User (caught by asking to inspect the companion's MCP errors) |

## What I'd change for run 002

1. **Switch to pipelined Option A'** by default. The strict block-and-wait pattern is dominated by tail. Make the next baseline use the workflow proven on FX001-7..8 (fire review, immediately start next task, drain findings before final task / before any irreversible change).
2. **Build HF-001 first** (outside-inbox-list `--wait`) so polling is replaced by a single blocking call that returns when the next summary lands.
3. **Build HF-003 (resume-in-place)** before the next experiment — losing the inbox/state continuity on restart is real friction.
4. **Make the experiment harness aware of the dist-rebuild trap**: if any code-edit task touches `src/mcp/`, prompt for a companion restart explicitly.
5. **Don't include the companion's own F004-style false positives in the count** — score by HIGH/CRIT signal rate, not finding count. Companion's instinct to flag is worth more than its accuracy on micro-issues.

## Notes / surprises

- The companion's per-task review time stabilized at ~50-100s for warm tasks (FX001-2/3/4). Cold first task was 251s. So tail is 1× cold + (N-1)× warm — predictable budget.
- The companion's chat-context retention through `resume` is the killer feature for long-running coordinated agents. Even with a fresh run dir, knowing FX001-1..4 happened let the FX001-7/-8 reviews stay focused.
- The dogfood directly produced the workshop (008-cli-lane-semantics-and-blocking-inbox) — the experiment surfaced a design problem that would have shipped silently.
- Verdict on Option A as a strict pattern: **not the right default**, but pipelined Option A' is. Worth a Run 002 with the harness improvements landed.
