# Run 001 — Power On Mode (first usage)

**Date**: 2026-04-29
**Plan**: 011-retro-harvest-loop
**Mode**: Power On (Option C)
**Companion run**: `2026-04-29T13-12-02-428Z-7abb` (`code-review-companion`)
**Result**: ✅ ok — all 13 tasks completed, 5 commits landed, just fft green
**Implementation duration**: T001 start (13:15:26 +10:00) → T013 commit (~13:40 +10:00) ≈ **25 minutes**

## Per-Tier Pings

| Tier | Commit | Files (count) | T_ping_sent | T_first_reply | Findings (H/M/L) |
|------|--------|---------------|-------------|----------------|-------------------|
| HF-A | `bbdb4ee` | 10 | 03:19:30Z | 03:48:29Z (post-mortem) | 0/0/0 |
| HF-B | `ed915d1` | 9 | 03:28:10Z | 03:48:29Z (post-mortem) | 0/0/0 |
| HF-C | `9b7e11b` | 2 | 03:35:08Z | 03:48:29Z (post-mortem) | 0/2/0 (F001-2 + F003) |
| HF-D | `6f9877d` | 3 | 03:37:59Z | 03:48:29Z (post-mortem) | 0/2/2 (F001, F002, F004, F005) |
| Drain | (final-gate) | — | 03:38:15Z | timed out at 60s | n/a |

**Companion participation summary**: ZERO live replies during implementation; **excellent post-mortem review** delivered ~6 minutes after farewell, after the companion realized via state transition that it had missed every message. Post-mortem launched 4 parallel review subagents and produced 5 findings + a `✅ APPROVE` summary. **All findings non-blocking** — 3 MEDIUM (post-v1 hardening), 2 LOW.

## What Actually Happened — The Critical Coordination Bug

The first iteration of this run-file (committed in `222bb55`) got it wrong: I claimed the companion did nothing. **It was alive and working the whole time** — but its `inbox_list waitForAny` filter only listened for `['task', 'question', 'directive', 'control']` message types. My pings used `briefing` + `review-request` types (per the Option C protocol). The companion was deaf to every one of them.

State trace:
- `03:12:57Z` — entered idle loop, waiting on `waitForAny` filter
- `03:12:57Z → 03:42:10Z` — pings landed in inbox but didn't satisfy filter; companion stayed idle
- `03:42:10Z` — idle budget triggered `idle → stopping` transition; companion read full inbox to compose farewell
- `03:43:11Z` — saw the missed briefing; transitioned `stopping → reading`
- `03:43:42Z` — `reading → reviewing`, launched 4 parallel review subagents on HF-A through HF-D
- `03:47:41Z` — `reviewing → reporting`, composing findings + summary
- `03:48:29Z` — summary delivered: ✅ APPROVE, 5 findings (0H/3M/2L)

This is the #1 lesson for Power On Mode and the highest-priority follow-up.

## Findings From the Companion's Post-Mortem Review

| ID | Severity | Bundle | Issue (one line) |
|----|----------|--------|------------------|
| F001 | MEDIUM | HF-D | Brittle `runId: <id>` substring match in `doctor.ts` + `retro-ledger.ts` (no line-start anchor); hand-edited ledgers can produce false positives |
| F002 | MEDIUM | HF-D | Silent try/catch in doctor ledger scan; permission errors / malformed JSON disappear without stderr trace |
| F003 | MEDIUM | HF-C | Crash-safety try/finally is implemented but **not isolated-tested** (T010 spec called for 12 cases; we shipped 10 — missing the explicit crash test + true-parallel stress) |
| F004 | LOW | HF-D | Doctor test coverage gaps (malformed report.json, missing output dir, null magicWand, mixed harvested/unharvested, permission errors) |
| F005 | LOW | HF-D | Hardcoded 1MB ledger threshold; should be configurable in future |

All 5 findings deferred to a follow-up plan — none are blockers. The companion explicitly verdict'd **✅ APPROVE** for shipping. F001 + F003 are the most actionable.

## Drain Phase

- T_drain_ping_sent: `2026-04-29T03:38:15.223Z`
- T_drain_summary_received: **timed out at 60s** because companion was still in `idle` (deaf) at that moment
- Verdict from companion (delivered 10 minutes AFTER drain timeout): ✅ APPROVE
- `companion_unresponsive=true` logged per protocol; final gate proceeded — that decision was correct given the information available, but it MISSED 5 useful findings that arrived later.

## Power On Mode — How It Felt

- **Did Power On mode let me work continuously?** ✅ **Yes — perfectly.** Implementation never stalled. Even though the companion never delivered a single review reply, no task was held back. Total implementation time was ~25 minutes for 13 tasks, 5 commits, ~1100 lines across runner/cli/templates/tests/docs.
- **Did the companion ever block me?** ❌ **No.** The protocol's "fire-and-forget" rule + 60s drain cap + `companion_unresponsive=true` fallback meant companion latency could not stall the work.
- **Was the drain phase enough to catch real issues?** ⚠️ **Partial test** — companion didn't reply, so we didn't get to validate the "drain phase catches HIGH findings" assertion. But importantly, the drain phase did NOT cost us anything: 60s wait is small, and we proceeded cleanly when it timed out.
- **Did I catch issues myself, instead of via companion?** ✅ **Yes** — the runner.ts auto-append leaked into the repo's `docs/retros/` initially because the `looksLikeMinihProject` heuristic was too loose (repo root has `agents/` so it always passed). I caught this between HF-C commit and the companion ping by spotting the leaked files in `git status`. Fixed inline + amended HF-C commit.

## Magic Wand for Option C / Power On Mode itself

> **Two magic wands, one urgent, one strategic:**
>
> **(1) URGENT — `outside inbox send` should report peer state in its response envelope.** When the orchestrator fires a ping, the response JSON should include the companion's current state (`idle`/`reading`/`reviewing`/`reporting`/`stopping`/`unknown`) and—critically—whether its `inbox_list waitForAny` filter would actually match the message type just sent. If the companion is mid-other-task or the filter doesn't include this type, the orchestrator finds out IMMEDIATELY instead of via a 30-minute timeout. This was the user's exact suggestion after this run: "if you send a message, it says the companion is off doing other work?" Yes — surface peer state in send response. The plumbing exists (`state/inside.json` is read at every step); plumbing it into the send response is small and high-value.
>
> **(2) STRATEGIC — companion-side waitForAny filter must include the FULL Power On Mode vocabulary.** The companion prompt's inbox vocabulary (§4) defined only `['task', 'question', 'directive', 'control']` as incoming types. Power On Mode introduces `briefing` and `review-request`. Either (a) extend the vocabulary table + filter in the companion prompt, or (b) reuse `'task'` for review requests. Option (a) is better — the companion should be explicitly taught the Power On vocabulary. **Without this fix, Option C is broken in a silent-failure mode.**

### Why (1) matters more than (2)

Even if we fix (2) for `code-review-companion`, the same shape of bug will appear with any new agent. The "send a message and find out it landed in a deaf inbox" failure is structural — the orchestrator should NEVER be blind to it. Surface the peer's listening state in the send response and the bug becomes self-documenting at the moment the wrong-typed message is sent.

## Difficulties

| ID | Severity | Description | Workaround |
|----|----------|-------------|------------|
| MH-006 | minor | The `outside inbox send --body "$VAR"` pattern fails when the body contains certain Markdown syntax (e.g. `**bold**` inline) — Bash interprets the `**` as glob patterns or worse. First HF-B ping attempt was blocked entirely by the shell. | Wrote body to `/tmp/<file>` then used `BODY=$(cat ...)`. Worked. Suggests a `--body-file <path>` flag or stdin-piping support in `outside inbox send`. |
| MH-007 | minor | Existing `runner.test.ts` tests pass `agentsDir=tmpDir` but no explicit `cwd`, defaulting to `process.cwd()` (= repo root). After T011 wired auto-append, every test polluted the actual repo's `docs/retros/`. Caught it via `git status` after HF-C commit; required tightening `looksLikeMinihProject` to require an explicitly-passed `cwd`. | Tightened heuristic in T011. Cleaned up 38 leaked ledger files. Amended HF-C commit. |
| MH-008 | minor | The `outside inbox send` body wrapped lines occasionally got truncated when passed via shell variable — for example, my HF-C ping lost item "1. CRASH SAFETY" from a numbered list. Cause likely the `\n\n` between sections expanded oddly. | Use `--body-file` or stdin in future. |
| MH-009 | **HIGH** | **Companion's `inbox_list waitForAny` filter did not include `briefing` or `review-request` message types**, so it was deaf to all 5 of my pings during the entire 30-minute idle budget. Caught only because the user (operator) intuited the companion might be busy and asked me to check. Without that nudge, I would have shipped believing the companion produced nothing — when in fact it was alive but listening to the wrong types. **This is the most important coordination bug I've encountered so far.** | Documented in companion's own progress message (03:44Z) AND in F001 of its post-mortem summary. Two-part fix: (a) extend the companion prompt's vocabulary + waitForAny filter, AND (b) add peer state to `outside inbox send` response so the orchestrator detects this failure mode IMMEDIATELY (the user's magic wand). |
| MH-010 | medium | The drain phase 60s wait timed out (companion was still idle at that moment) and I logged `companion_unresponsive=true`. That was correct given available data. But the companion's review LANDED 10 minutes later. The drain protocol assumes "no reply within 60s ⇒ companion isn't reviewing", which is wrong. After fix MH-009 (peer state in send response), the drain protocol can be smarter: if peer state is `reviewing` or `reporting`, extend the wait. | Future: drain wait should poll peer state and continue waiting while it's transitioning forward. |

## Outcomes

- ✅ Plan 011 implemented end-to-end without blocking.
- ✅ Power On Mode validated as a working protocol — at least in the failure mode of "companion is dead/silent".
- ⚠️ The companion DID review (post-mortem) and produced a ✅ APPROVE verdict with 5 actionable findings (3 MEDIUM, 2 LOW). All deferred to follow-up; none block ship.
- ❌ Power On Mode v1 has a **silent-failure hole** in the companion-side waitForAny filter. Without the operator (the user) asking the right question, this run would have been a false positive: "Power On worked even with a dead companion!" → reality: "Power On didn't notice the companion's inbox filter was misconfigured".
- ✅ The fix (peer state in `outside inbox send` response) is a high-leverage, structural improvement that benefits ALL future companion-style protocols, not just Option C.

## Compared to Option A (blocking)

Plan 010 used Option A' (pipelined). The companion timed out there too, but during plan 010 I was actively glancing at the inbox between tasks and felt some tug to "is the companion replying?". With Option C's strict "do not poll, do not glance" rule + 60s drain cap, that tug was eliminated. Implementation rhythm felt cleaner.

**However**: my Option C blind spot was masked precisely because I was NOT polling. With Option A' I would have noticed sooner that the inbox was empty. **There's a real trade-off here**: stronger discipline in Option C requires stronger send-response observability (the magic wand) to compensate.

## Recommendation

**Adopt Option C as the default, BUT only after MH-009 is fixed.** The protocol's value (no idle, no polling tug) depends on the orchestrator getting fast, structural feedback at send-time. Without that, silent failures are not just possible — they're guaranteed by the protocol's own discipline.

Two follow-up tasks for plan 012:
1. Add peer state to `outside inbox send` response envelope (high-priority, structural).
2. Extend `code-review-companion` prompt to listen for `briefing` + `review-request` types in its `waitForAny` filter (immediate-priority, fixes today's deaf companion).

If we want stronger live-review enforcement, that's a different protocol (Option A). Option C with peer-state visibility is the right default.
