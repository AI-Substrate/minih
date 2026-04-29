# Plan 012 — Power On Mode Run 001

**Date**: 2026-04-29
**Branch**: 007-backgrounding
**Companion run**: `agents/code-review-companion/runs/2026-04-29T18-22-45-108Z-b488`
**Companion verdict trail**: T000 APPROVE, T001 APPROVE (1 deferred MEDIUM), T002 APPROVE_WITH_NOTES (F002 HIGH), T003 APPROVE clean, T004 APPROVE clean, T005 APPROVE_WITH_NOTES (F003 MEDIUM), T006 (review in flight at writing).

## What got built

All 8 tasks T000-T007 completed in a single live Power On Mode session:

- **T000** — Widened `code-review-companion/prompt.md` `waitForAny` filter at lines 41+161 to include `briefing` + `review-request`.
- **T001** — Pure `derivePeerVerdict` ladder + types + 21 TDD tests in `src/runner/peer-activity.ts` (decision-table, not state machine — minih is messenger, not police).
- **T002** — `derivePeerActivity` I/O wrapper + bounded reverse-tail (1MB cap) + `parseToolCall` (silently drops malformed) + `computeCadenceMs` (median delta) + 12 fixture-driven edge-case tests.
- **T003** — Wired `outside inbox send` peer block + `--strict-peer` flag → `E150 DEAF_PEER` + 5 integration tests. **Peer block goes live in real CLI envelopes.**
- **T004** — Wired remaining 4 outside commands (`list --wait`, `state set`, `state transition`, `retro add`) + 5 more integration tests. Plain `list` (no --wait) does NOT include peer per workshop.
- **T005** — `minih doctor auditPeerActivity()` walks active coordinated runs; surfaces deaf/silent/dead rows; healthy runs quiet. + 4 doctor tests.
- **T006** — Three teaching surfaces: AGENTS_README `## Coordination Visibility` § + preamble `### Coordination visibility (plan 012)` subsection (in both source + dist template) + domain history rows in `runner/domain.md` and `cli/domain.md`.
- **T007** (this closeout) — Companion-review fixes (F002, F003), final `just fft` baseline, run-file.

**Companion review fixes applied during T007**:
- **F002 HIGH** — `lastAckOf` was reading `input.messageId` but the MCP `inbox_ack` tool's parameter is `msgId`. Fixed to read `input.msgId`. Field-name typo silently broke ack correlation. Caught by companion via cross-reference to `src/mcp/tools/inbox.ts:40` and `src/mcp/types.ts:140`. Added regression test.
- **F003 MEDIUM** — Doctor's surface filter was `verdict === 'deaf' || verdict === 'silent'`. The `deaf` branch was unreachable dead code (doctor calls `derivePeerActivity` with `messageType:null`, which makes rule 8 unable to fire), and `dead` (the most actionable signal — stuck-active-but-dead-by-telemetry) was not surfaced. Changed to `silent || dead`. Added regression test.

## Final test count

```
Test Files  58 passed | 5 skipped (63)
     Tests  605 passed | 10 skipped (615)
audit       0 vulnerabilities
```

Plan 011 baseline was 556. Plan 012 added 49 tests (+33 runner verdict/I-O, +10 outside-peer integration, +4 doctor-peer integration, +2 F002/F003 regressions, minus 1 dead-code-removal lint cleanup).

## Live evidence — the verdict goes wide

A real `outside inbox send` against companion `b488` mid-session produced:

```jsonc
"peer": {
  "verdict": "listening",
  "willMatchType": true,
  "lastPollFilter": ["task","question","directive","control","briefing","review-request"],
  "currentlyRunningTool": "bash",
  "lastPollWaitMs": 30000,
  "currentlyPolling": true
}
```

The companion's `waitForAny` was widened mid-session via the briefing message (because the running session was launched with the OLD prompt before T000 widened the source). Plan 012 made this recovery visible: the `lastPollFilter` field shows the agent IS now listening for the message types we're sending. **30 minutes of plan 011 silent failure is now a 0-millisecond visible signal.**

## Power On Mode protocol — companion behaviour this run

After plan 011's catastrophic communication failure, T000 (filter widen) + the new `peer.verdict` surface meant this run had a different problem: the companion was actively engaged the whole time. Reviews came back at every commit boundary:

- T000 → APPROVE (clean)
- T001 → APPROVE + 1 MEDIUM deferred to T002 review (F001 about strict null vs undefined at I/O boundary)
- T002 → APPROVE_WITH_NOTES (F001 was correctly mitigated by Array.isArray normalization in T002; new F002 HIGH about `lastAckOf` field name)
- T003 → APPROVE clean (0 findings)
- T004 → APPROVE clean (mechanical wiring)
- T005 → APPROVE_WITH_NOTES (F003 about doctor dead-code + missing dead surface)
- T006 → (review pending at closeout time, doc-only commit)

The companion caught **two real bugs** plan 011 wouldn't have caught (F002 was a silently-wrong field reference; F003 was unreachable code masking a missing actionable case). Both fixed inline during T007. Power On Mode + a competent reviewer + plan 012's own verdict surface = a feedback loop that compounds.

## Magic Wand

`peer.reason` should expose **the agent's actual recent behaviour as a one-line summary** when the verdict is `listening` or `between-polls` — not just for the failure cases. Right now operators see `"inside active poll window (ends ..."` for healthy verdicts, which is correct but boring. They could also see things like `"poll cadence 30s, last sent 12s ago, last ack 45s ago"` to confirm the agent is working in a useful pattern. Today's silence-on-success is missing an opportunity to teach what "healthy" looks like.

## Difficulties

1. **(MH-001, severity: medium)** — `outside-state.json` schema enforces a fixed status enum (`idle`, `in-progress`, `paused`, `done`, `error`) which I didn't notice in the test fixtures. I picked semantic-but-invalid values like `'reviewing'` and got E108 schema violations from my own integration tests, costing one fix-and-retry cycle in T004. Fix candidate: surface the allowed enum in a CLI hint (`error.details.allowed: [idle, in-progress, ...]`) when state validation fails. (Workshop opp #3 in plan 011 — filter vocabulary contract — would address the systemic version of this.)

2. **(MH-002, severity: medium)** — Pre-existing lint warning (`const def = makeAgent('demo')` unused at `test/runner/runner-auto-harvest.test.ts:152`) blocked `just fft` after my biome auto-fix. Per project rule "we own every finding", I deleted the dead code. The lint config flags `noUnusedVariables` as fixable-but-unsafe, so biome refused to auto-fix it for me. Fix candidate: add a CI-only exclusion or upgrade the rule to `error` so future plans can't ship past it silently.

3. **(MH-003, severity: low)** — `withStateErrors` is a sync wrapper that calls `exitWithEnvelope` (which `process.exit`s) on caught errors. To call `await derivePeerOrNull` AFTER the write, I had to flow control variables (`transitioned`, `from`, `nextState`) out of `withStateErrors` to access them in the async post-write code. The pattern works but is mildly ugly. Fix candidate: refactor `withStateErrors` to return the inner result (`<T>(cmd, fn: () => T) => T`), then async callers can `await` outside.

4. **(MH-004, severity: low)** — Companion's first review (F001) flagged a strict `=== null` check that COULD be brittle if I/O ever returned `undefined`. Turned out T002's I/O wrapper already normalized via `Array.isArray()` and `typeof === 'string'` checks — but the companion couldn't know that until T002 was committed. The cross-task review boundary creates this kind of "carried-over finding". Probably fine; the protocol works as designed.

5. **(MH-005, severity: low)** — Power On Mode worked beautifully this run. No drain timeout, no deafness, companion reviewed every commit boundary within seconds. Hard to reproduce plan 011's failure mode now that T000 + the verdict surface are in place — which is exactly the point. Future plans should keep this pattern.

## What's next

Workshop 003 from plan 011 (filter vocabulary contract — the structural fix to vocabulary mismatches between sender and receiver) is now the natural follow-up. Plan 012 fixes visibility; plan 013 (when scoped) would fix the underlying coupling.
