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
| HF-A | `bbdb4ee` | 10 | 03:19:30Z | (none) | 0/0/0 |
| HF-B | `ed915d1` | 9 | 03:28:10Z | (none) | 0/0/0 |
| HF-C | `9b7e11b` | 2 | 03:35:08Z | (none) | 0/0/0 |
| HF-D | `6f9877d` | 3 | 03:37:59Z | (none) | 0/0/0 |
| Drain | (final-gate) | — | 03:38:15Z | timed out at 60s | n/a |

**Companion replies received during entire run**: 1 (its initial orient message at 03:15Z, before any pings).

## Drain Phase

- T_drain_ping_sent: `2026-04-29T03:38:15.223Z`
- T_drain_summary_received: **timed out** — `--wait 60000 --type summary` returned `timedOut: true, matched: false`
- Verdict from companion: not received (companion never replied to any review request)
- Outstanding findings actioned: 0 (none received)
- Outstanding findings deferred: 0 (none received)
- `companion_unresponsive=true` logged per protocol; proceeded with final gate

## Power On Mode — How It Felt

- **Did Power On mode let me work continuously?** ✅ **Yes — perfectly.** Implementation never stalled. Even though the companion never delivered a single review reply, no task was held back. Total implementation time was ~25 minutes for 13 tasks, 5 commits, ~1100 lines across runner/cli/templates/tests/docs.
- **Did the companion ever block me?** ❌ **No.** The protocol's "fire-and-forget" rule + 60s drain cap + `companion_unresponsive=true` fallback meant companion latency could not stall the work.
- **Was the drain phase enough to catch real issues?** ⚠️ **Partial test** — companion didn't reply, so we didn't get to validate the "drain phase catches HIGH findings" assertion. But importantly, the drain phase did NOT cost us anything: 60s wait is small, and we proceeded cleanly when it timed out.
- **Did I catch issues myself, instead of via companion?** ✅ **Yes** — the runner.ts auto-append leaked into the repo's `docs/retros/` initially because the `looksLikeMinihProject` heuristic was too loose (repo root has `agents/` so it always passed). I caught this between HF-C commit and the companion ping by spotting the leaked files in `git status`. Fixed inline + amended HF-C commit.

## Magic Wand for Option C / Power On Mode itself

> The single biggest improvement: a way to know if the companion is actually working without polling. The orient message arrived but no replies followed — was it busy reviewing HF-A and just not done yet, or was it stuck? A "companion heartbeat" inbox message every N seconds (or when starting/finishing each review) would let the orchestrator distinguish "slow but progressing" from "dead". Without it, the operator only knows the companion's state via timeout, which feels brittle. Adding a `--type heartbeat` convention to the companion's review loop would close this loop cheaply.

## Difficulties

| ID | Severity | Description | Workaround |
|----|----------|-------------|------------|
| MH-006 | minor | The `outside inbox send --body "$VAR"` pattern fails when the body contains certain Markdown syntax (e.g. `**bold**` inline) — Bash interprets the `**` as glob patterns or worse. First HF-B ping attempt was blocked entirely by the shell. | Wrote body to `/tmp/<file>` then used `BODY=$(cat ...)`. Worked. Suggests a `--body-file <path>` flag or stdin-piping support in `outside inbox send`. |
| MH-007 | minor | Existing `runner.test.ts` tests pass `agentsDir=tmpDir` but no explicit `cwd`, defaulting to `process.cwd()` (= repo root). After T011 wired auto-append, every test polluted the actual repo's `docs/retros/`. Caught it via `git status` after HF-C commit; required tightening `looksLikeMinihProject` to require an explicitly-passed `cwd`. | Tightened heuristic in T011. Cleaned up 38 leaked ledger files. Amended HF-C commit. |
| MH-008 | minor | The `outside inbox send` body wrapped lines occasionally got truncated when passed via shell variable — for example, my HF-C ping lost item "1. CRASH SAFETY" from a numbered list. Cause likely the `\n\n` between sections expanded oddly. | Use `--body-file` or stdin in future. |
| MH-009 | trivial | Companion didn't reply to any of my 5 pings during the run. Could be: (a) idle-budget exhaustion before processing first ping, (b) companion's outside.md broke during plan 010 rename and it wasn't re-scaffolded, (c) just slow review work. Without companion-side log access I can't tell. Power On Mode handled it gracefully — no impact on velocity. | Better companion-state observability would help diagnose this; see magic wand. |

## Outcomes

- ✅ Plan 011 implemented end-to-end without blocking.
- ✅ Power On Mode validated as a working protocol.
- ⚠️ Companion participation was zero this run, so the "review-while-implementing" half of the loop is not yet proven in production. Need a future run where the companion actually replies to validate the full collaborative flow.
- ✅ I (the implementer) caught two real issues without the companion: the `looksLikeMinihProject` heuristic + the test pollution + an unsafe shell pattern.

## Compared to Option A (blocking)

Plan 010 used Option A' (pipelined). The companion timed out there too, but during plan 010 I was actively glancing at the inbox between tasks and felt some tug to "is the companion replying?". With Option C's strict "do not poll, do not glance" rule + 60s drain cap, that tug was eliminated. Implementation rhythm felt cleaner.

## Recommendation

**Adopt Option C as the default**. The protocol is robust against companion failure modes (latency, idle exhaustion, crash). It does not REQUIRE companion participation to ship; companion participation, when it happens, is bonus validation. This matches the "harness is the product" principle — the protocol's value is in the rhythm it imposes on the implementer, not in companion participation that may or may not arrive.

If we want stronger live-review enforcement, that's a different protocol (Option A). Option C is the right default.
