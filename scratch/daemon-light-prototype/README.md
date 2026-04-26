# T003 — daemon-light-prototype (workshop 007 §Pre-Work test #3)

## ⚠️ THIS IS THE LOAD-BEARING TEST

If T003 fails, the entire daemon-light architecture fails. T001 (event-driven `runAgent`) and T002 (native `fs.watch`) are necessary preconditions; T003 is the integration proof.

## Hypothesis

End-to-end: a child process appends an inbox NDJSON line → parent's `node:fs.watch` fires → forwarder reads the new line(s) and calls `session.send` → in-flight Copilot SDK session receives the message in a turn → agent's final message acknowledges it.

- Round-trip ≤ 5s per message
- Ordering preserved across rapid writes
- Forwarder honors workshop 001 §Forwarder-side robustness (skip-on-parse-fail, no watermark advance past torn lines)

## Why it matters

This is what `runAgent` will look like in P2-P3. The whole 007 plan stands or falls on this pattern working.

## Components under test

- Native fs.watch (validated in T002)
- Single-call atomic NDJSON append (workshop 001 §Atomic Write Strategy)
- Forwarder skip-on-parse-failure protocol (workshop 001 §Forwarder-side robustness — added per Critical Insights 2026-04-26 #1)
- Watermark advancement only on successful parse + send
- SDK `session.send` + idle subscription (validated separately by T001)

## Pass criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | Every outside writer message is acked by the agent | `roundTripsMs.length === MSG_COUNT` in summary |
| 2 | Each round-trip (file write → agent ack) ≤ 5s | every `roundTripsMs[i].latencyMs <= 5000` |
| 3 | Forwarder did not double-deliver | `forwarderState.sendCount === MSG_COUNT` (one send per message) |
| 4 | No orphan SDK process after exit | `pgrep -fl "@github/copilot-sdk"` returns empty after the process exits |

## How to run

```bash
# Default: 5 messages
GH_TOKEN=<token> node /Users/jordanknight/substrate/minih/scratch/daemon-light-prototype/test.mjs 2>&1 | tee /tmp/t003.log

# Custom message count
GH_TOKEN=<token> node /Users/jordanknight/substrate/minih/scratch/daemon-light-prototype/test.mjs 10

# After exit, verify cleanup:
pgrep -fl "@github/copilot-sdk" ; echo "exit=$?"
```

Expected runtime: ~30-45s for 5 messages (8s per message inter-write delay + agent reasoning time).

## What to record in `prework-results.md`

Copy the `=== T003 SUMMARY ===` JSON block. Specifically: `pass`, `roundTripsMs` (per-message latency), `forwarderState`, `failureReason` (if any).

## Failure-mode fallbacks (per workshop 007)

If T003 fails:
- **Round-trip > 5s consistently**: agent reasoning is the dominant cost (not our forwarder). Document and accept higher latency in v1; revisit in plan 008.
- **Missing acks**: agent ignored some messages. Investigate prompt phrasing in T003's primer; consider mandating workshop 005's pre-completion checklist pattern more strongly.
- **Forwarder double-delivered (sendCount > MSG_COUNT)**: watermark logic has a bug. Inspect; revisit workshop 001 §Forwarder-side robustness before P3 commits.
- **Forwarder dropped messages**: parse-skip-without-advance fired but next event never re-read. Inspect debounce + drain loop interaction; revisit workshop 007 §Debounce + atomic-rename.

## Implementation notes (for the curious)

The `readNewMessages(inboxPath, watermarkBytes)` function is the pattern that will move into `src/runner/inbox-forwarder.ts` in P3. Four things to copy verbatim:

1. **Read from byte offset** (not line offset) — survives partial-line torn writes
2. **Split on `\n`; the last element is the partial-line tail** — discarded; advances watermark only past `\n`-terminated lines
3. **On JSON.parse failure of any complete line: STOP draining, return `parseFailed: true`, do NOT advance watermark past the bad line** — next fs.watch event retries the same byte range
4. **PER-LINE WATERMARK FSYNC** — workshop 001 §Forwarder-side robustness point 4 (added per Critical Insights #1). Persist + fsync the watermark file BEFORE attempting the next line so a crash mid-batch cannot double-deliver. **NOTE**: this scratch test (T003) advances the in-memory watermark only after the entire batch — sufficient for the test, INSUFFICIENT for production. P3's `inbox-forwarder.ts` MUST fsync per-line. (Per code-review F001 2026-04-26.)
