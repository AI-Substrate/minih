# T001 — runagent-eventdriven (workshop 007 §Pre-Work test #1)

## Hypothesis

A `runAgent`-shaped flow can run a Copilot SDK session to completion using ONLY `session.send` + subscribe-to-`session.idle`. No `sendAndWait` anywhere.

## Why it matters

Workshop 007's daemon-light pivot requires `runAgent` to be **event-driven** so that cross-process forwarders (workshop 007 §Cross-Process Delivery) can interleave additional `session.send` calls while the agent is mid-turn. `sendAndWait` blocks until the entire queue drains — it's a footgun for the daemon-light pattern (already documented in `external-research/sdk-mid-turn-injection.md`).

T001 is the load-bearing scratch test: if this fails, Phase 2 (the `runAgent` event-driven refactor) cannot land as designed.

## Pass criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | Reaches a `session.idle` event ≤ 60s | Look for `marker: "IDLE-REACHED"` in stderr |
| 2 | ≥ 1 assistant `message` event observed before idle | `messageCount > 0` in summary block |
| 3 | `client.stop()` cleans up — no orphan SDK CLI process after exit | After exit, run `pgrep -f "@github/copilot-sdk"` from your shell — should return empty |
| 4 | (queued scenario) Both queued sends are processed | Both `STAGE-ONE-DONE` and `STAGE-TWO-DONE` appear in `messagesPreview` |

## How to run

```bash
# Single-message scenario (default)
GH_TOKEN=<your-token> node /Users/jordanknight/substrate/minih/scratch/runagent-eventdriven/test.mjs 2>&1 | tee /tmp/t001-single.log

# Queued-message scenario (two session.send calls back to back)
GH_TOKEN=<your-token> node /Users/jordanknight/substrate/minih/scratch/runagent-eventdriven/test.mjs queued 2>&1 | tee /tmp/t001-queued.log

# After exit, verify no orphan SDK process:
pgrep -fl "@github/copilot-sdk" ; echo "exit=$?"   # should print nothing + exit=1
```

## What to record in `prework-results.md`

Copy the `=== T001 SUMMARY ===` JSON block from each run. Specifically: `pass`, `idleAfterMs`, `messageCount`, `failureReason` (if any).

## Failure-mode fallbacks (per workshop 007 §"Failure-mode fallback table")

If T001 fails:
- Keep `sendAndWait` for the FIRST message (preserves current behavior); layer event-driven only for SUBSEQUENT messages from the forwarder. Adds one branch in `runAgent` but unblocks the rest of the design.
- Document in `prework-results.md` and revisit workshop 007 §"How the live-push path actually works inside `runAgent`" before P2 starts.
