# T002 — fswatch-test (workshop 007 §Pre-Work test #2)

## Hypothesis

Native `node:fs.watch` reliably detects writes from a sibling subprocess on small directories (the inbox/state lanes are always small). Mean detection latency is well under 50ms; zero events are missed; atomic-rename and burst patterns are observable and documentable.

## Why it matters

Workshop 007's daemon-light pivot picks `node:fs.watch` over chokidar — chainglass evidence: chokidar v5 opens 1 FD per file via kqueue → `spawn EBADF` at >5K files. For small dirs (`agents/<slug>/inbox/`, `agents/<slug>/state/`) native `fs.watch` should be sufficient. T002 proves it.

## Scenarios

| ID | Scenario | What it validates |
|----|----------|-------------------|
| A | `latency` | 100 sequential appends from a child subprocess; measure detection latency distribution. Pairs each child-side write timestamp with the next observed event. **Note**: fs.watch coalesces, so per-write detection isn't 1:1 — pass = mean ≤ 500ms AND ≥ 50% paired |
| B | `rename` | Atomic write pattern (write tmp + rename) per workshop 001 §Atomic Write Strategy. Verifies rename event is observable on the target file (not just the tmp file) |
| C | `burst` | 50 rapid `appendFileSync` calls; documents the coalesce ratio (events / writes). Confirms file content integrity (no torn lines under POSIX atomic-write) |

## Pass criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | Latency: ≥ 50% of writes paired with an event AND mean detection ≤ 500ms | Summary block `latencyStats.meanMs` + `detectedCount` |
| 2 | Atomic-rename: ≥ 1 event observed on the target file (not just tmp) | Summary block `eventsOnTarget.length >= 1` |
| 3 | Burst: file content integrity preserved (`parseFailures === 0`) and all lines accounted for (`linesObserved === BURST_WRITE_COUNT`) | Summary block `pass: true` |

## How to run

```bash
# Run all three scenarios (recommended)
node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs all 2>&1 | tee /tmp/t002.log

# Individual scenarios
node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs latency
node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs rename
node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs burst
```

NO `GH_TOKEN` required — pure Node + child_process + fs.

## What to record in `prework-results.md`

Copy the `=== T002 SUMMARY ===` JSON block. Specifically: per-scenario `pass`, latencyStats, coalesceRatio, eventsOnTarget pattern.

## Failure-mode fallbacks (per workshop 007)

If T002 fails:
- **High latency / missed events**: fall back to a 1s polling loop on the inbox/state dirs (degrades latency but ships v1). Document in `prework-results.md`.
- **Atomic-rename invisible**: workshop 001 §Atomic Write Strategy stays correct (writers' atomicity holds), but the parent must polling-check state files instead of fs.watch-ing them. Forwarder still works for inbox lane.
