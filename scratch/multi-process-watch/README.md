# T004 — multi-process-watch + torn-line (workshop 007 §Pre-Work test #4)

## ⚠️ ELEVATED FROM OPTIONAL TO REQUIRED

This test was originally optional in workshop 007. It was elevated to REQUIRED on 2026-04-26 per **didyouknow #1** (Critical Insights table in `coordination-plan.md`). The reason: the daemon-light forwarder reads while writers append; the parse-skip-without-advance protocol in workshop 001 §Forwarder-side robustness needs empirical proof before P3 commits.

## Hypotheses

**(A) Multi-writer atomic-append safety**: Multiple sibling processes appending to the same NDJSON inbox file (single-call `appendFile` per write) do NOT corrupt the file. POSIX guarantees `write(2)` ≤ PIPE_BUF (4KB) is atomic. Concurrent appends interleave at line granularity, never within a line.

**(B) Torn-line forwarder resilience**: A reader that reads the file while a writer is mid-append either gets a complete line or a `JSON.parse` failure that's safely skipped without advancing the watermark. The next read attempt sees the now-complete line.

## Why it matters

Workshop 001 §Forwarder-side robustness specifies the protocol; T004 proves it self-heals under adversarial conditions. This blocks **AC-FORWARD-IDEMPOTENT** in the spec.

## Scenarios

| ID | Scenario | What it validates |
|----|----------|-------------------|
| A | `multi-writer` | 2 child writers each append 100 lines in parallel; assert all 200 lines present, all parseable, no truncation, even per-writer count |
| B | `torn-line` | Four passes:<br>1. Writer appends complete line + partial line; forwarder reads → gets complete, leaves partial alone (incompleteTailBytes > 0)<br>2. Writer finishes the partial; forwarder reads → gets the now-complete msg-2<br>3. Writer appends a malformed-but-newline-terminated line; forwarder reads → parseFailed=true, watermark NOT advanced<br>4. Writer appends a valid line AFTER the bad one; forwarder still parseFailed=true (garbage blocks; intentional safety)<br>**Documents a known design tradeoff**: persistent garbage requires operator intervention. v1 accepts this; future enhancement = configurable max-skip-attempts |

## Pass criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | Multi-writer: all expected lines present (200/200), zero parse failures, even per-writer counts (100/100) | Summary `multi-writer.pass: true` |
| 2 | Torn-line pass 1: complete line picked up, partial leaves `incompleteTailBytes > 0`, parseFailed=false | `torn-line.pass1_completeFollowedByPartial.ok: true` |
| 3 | Torn-line pass 2: completed partial parses, msg-2 returned | `torn-line.pass2_partialNowComplete.ok: true` |
| 4 | Torn-line pass 3: garbage line triggers parseFailed=true, watermark NOT advanced | `torn-line.pass3_garbageLine.ok: true` |
| 5 | Torn-line pass 4: garbage blocks subsequent valid lines (intentional conservative safety) | `torn-line.pass4_garbageBlocksFollowing.ok: true` |

## How to run

```bash
node /Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs all 2>&1 | tee /tmp/t004.log

# Individual scenarios
node /Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs multi-writer
node /Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs torn-line
```

NO `GH_TOKEN` required.

## What to record in `prework-results.md`

Copy the `=== T004 SUMMARY ===` JSON block. Specifically: `overallPass`, multi-writer's `observedLines` vs `expectedLines`, torn-line's pass1/2/3/4 ok flags.

## Notes for future implementation (P3)

The `readNewMessages(inboxPath, watermarkBytes)` function in this scratch test is the production pattern. Things it does that P3's `src/runner/inbox-forwarder.ts` MUST replicate verbatim:

1. **Read from byte offset** (not line offset) — survives partial-line torn writes
2. **Split on `\n`; the last element (no trailing `\n`) is the partial-line tail** — discarded; advances watermark only past `\n`-terminated lines
3. **On `JSON.parse` failure of any complete line: STOP draining, return `parseFailed: true`, do NOT advance watermark past the bad line** — next `fs.watch` event retries the same byte range
4. **PER-LINE WATERMARK FSYNC** (NOT in this scratch test, but REQUIRED in P3) — workshop 001 §Forwarder-side robustness point 4: persist + fsync the watermark file BEFORE attempting the next line so a crash mid-batch cannot double-deliver. T004 only validates the read protocol, not the writer-side fsync ordering. (Per code-review F001 2026-04-26.)
5. **Logging** (NOT in this scratch test, but required in P3): when parseFailed fires, log warn-level so the operator notices a stuck forwarder
