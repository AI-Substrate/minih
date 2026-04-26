# Phase 0 — Execution Log

**Phase**: Phase 0: Pre-Work Scratch Tests + Decision Gate
**Plan**: [coordination-plan.md](../../coordination-plan.md)
**Tasks**: [tasks.md](./tasks.md)
**Started**: 2026-04-26

---

## Pre-Phase Validation

| Check | Status | Duration | Notes |
|-------|--------|----------|-------|
| Harness boot | 🔴 UNAVAILABLE | — | `docs/project-rules/harness.md` does not exist; no harness configured. Phase 0 is the gate that informs harness construction in later plans, not a phase that uses one. Standard testing approach (raw `node` execution + `node:assert`). |
| Harness interact | N/A | — | — |
| Harness observe | N/A | — | — |

**Verdict**: 🔴 UNAVAILABLE — proceed with standard testing approach. Each scratch test is a self-contained `.mjs` file run by hand with `node`. Empirical evidence captured in stderr output; structured summaries written to per-test result notes.

**Special considerations for Phase 0**:
- T001 + T003 require `GH_TOKEN` env var (real SDK calls). Cannot be executed by the implementing agent (no live token). These are **authored** and handed to the user for execution.
- T002 + T004 are pure Node (fs + child_process). The implementing agent CAN execute these and capture empirical results.
- T005 (decision memo) authored with results from T002 + T004 + placeholders for T001 + T003 results.
- T006 (spec polish) NOT executed — gated on FULL GO from T005 once user-side execution of T001 + T003 confirms.

---

## Tasks

### T001 — scratch/runagent-eventdriven/

**Status**: `[!]` BLOCKED ON USER EXECUTION

**Files authored**:
- `/Users/jordanknight/substrate/minih/scratch/runagent-eventdriven/test.mjs` (~180 LOC)
- `/Users/jordanknight/substrate/minih/scratch/runagent-eventdriven/README.md`

**Pattern used**: matches `scratch/midturn-test/test.mjs` — absolute SDK import via node_modules path; GH_TOKEN-gated; raw `node:assert`-style runs; structured stderr summary block (`=== T001 SUMMARY ===` JSON for memo paste).

**Key design choices**:
1. Two scenarios: `single` (default) and `queued` (two `session.send` calls back-to-back to validate queueing).
2. Subscribes to `session.on(evt)` and detects both `session_idle` and `session.idle` event names (SDK API has used both).
3. 60s overall timeout — fails cleanly with timing summary instead of hanging.
4. Asserts at least one assistant message before idle.
5. Cleanup verification delegated to user shell (`pgrep -fl "@github/copilot-sdk"`) since the script can't outlive itself.

**Why not run by implementing agent**: requires GH_TOKEN (live SDK calls). User runs it.

---

### T002 — scratch/fswatch-test/

**Status**: `[x]` COMPLETED — empirically validated by implementing agent

**Files authored**:
- `/Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs` (~250 LOC)
- `/Users/jordanknight/substrate/minih/scratch/fswatch-test/README.md`

**Execution result** (darwin 25.4.0, Node v24.7.0):
- **Latency** (100 sequential writes): mean **15.45ms**, p50 13ms, p95 35ms, p99 39ms, max 39ms — well under 50ms target.
- **Atomic-rename**: 2 events observed on target file (`rename`, `rename`) — atomic write pattern observable.
- **Burst** (50 rapid appendFileSync): coalesce ratio **0.02** (50 writes → 1 event), all 50 lines preserved, zero parse failures.
- **overallPass: true**

**Key empirical learning**: burst coalescing is HEAVY (50:1). The forwarder MUST drain from watermark on each event — it CANNOT assume 1 event = 1 line. This validates the watermark+drain pattern in workshop 001 §Forwarder-side robustness.

---

### T003 — scratch/daemon-light-prototype/

**Status**: `[!]` BLOCKED ON USER EXECUTION (load-bearing test)

**Files authored**:
- `/Users/jordanknight/substrate/minih/scratch/daemon-light-prototype/test.mjs` (~280 LOC)
- `/Users/jordanknight/substrate/minih/scratch/daemon-light-prototype/README.md`

**Pattern used**: combines T001 (SDK) + T002 (fs.watch) + T004 (forwarder protocol) into the full daemon-light pattern.

**Key design choices**:
1. Forwarder uses the EXACT pattern that will move to `src/runner/inbox-forwarder.ts` in P3:
   - Read from byte offset (not line offset)
   - Split on `\n`; trailing non-`\n`-terminated chunk discarded
   - On JSON.parse failure: STOP draining, parseFailed=true, watermark NOT advanced
2. Debounce wraps `fs.watch` callback (50ms); coalesces burst events.
3. `forwarderBusy` + `pendingFire` pattern handles overlapping fs.watch events while a drain is in flight.
4. Agent primer: tells the SDK agent its job is to ACK each `📬 Inbox message id=…` it receives via `ACK-{id}` token.
5. Round-trip latency = `agentMessage.at - markerWriter.wroteAt` per message.
6. 120s overall timeout; per-message target 5s.

**Why not run by implementing agent**: requires GH_TOKEN. User runs it.

---

### T004 — scratch/multi-process-watch/

**Status**: `[x]` COMPLETED — empirically validated; Critical Insight #1 confirmed

**Files authored**:
- `/Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs` (~280 LOC)
- `/Users/jordanknight/substrate/minih/scratch/multi-process-watch/README.md`

**Execution result** (darwin 25.4.0, Node v24.7.0):
- **Multi-writer**: 200/200 lines preserved across 2 sibling writers, even split (100 each), zero parse failures, file ends in newline. Confirms POSIX atomic-append for messages ≤ PIPE_BUF.
- **Torn-line pass 1**: complete msg-1 picked up, partial leaves 37 incomplete bytes, parseFailed=false. ✓
- **Torn-line pass 2**: writer finishes the partial; next read picks up msg-2. ✓
- **Torn-line pass 3**: garbage line triggers parseFailed=true, watermark NOT advanced. ✓
- **Torn-line pass 4**: garbage BLOCKS subsequent valid lines (intentional conservative safety). ✓
- **overallPass: true**

**Critical learnings recorded for the prework memo**:
1. Workshop 001 §Atomic Write Strategy holds under 2-writer concurrency.
2. Workshop 001 §Forwarder-side robustness (added per didyouknow #1) is empirically self-healing for the common torn-line case (writer mid-fwrite or write > PIPE_BUF).
3. **Conservative-stop documented as a known design tradeoff** (pass 4): persistent garbage line blocks forward progress until operator intervention. v1 acceptable; flag for plan 008+: configurable `maxSkipAttempts` policy.

---

### T005 — prework-results.md decision memo

**Status**: `[x]` COMPLETED — partial-GO recommendation written

**File authored**: `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/prework-results.md`

**Verdict in memo**: **CONDITIONAL GO**
- T002 + T004: **executed PASS** (empirical evidence captured in memo)
- T001 + T003: **placeholders for user execution**; ready-to-paste sections in memo

**Locked commitments** (independent of T001/T003 outcomes — already validated by T004):
- Workshop 001 §Atomic Write Strategy: single-call appendFile of `${json}\n` for messages ≤ PIPE_BUF
- Workshop 001 §Forwarder-side robustness: read-from-byte-offset + skip-on-parse-fail-without-watermark-advance + persistent-garbage-blocks-progress

**Two paths offered to the user**:
1. **Fast path**: run T001+T003 now; on PASS execute T006 (spec polish) → unlock P1
2. **Pre-commit path**: lock workshop 001 commitments now; start P1 in parallel with T001+T003 user execution; gate P2 on full T001+T003 PASS

---

### T006 — Spec polish (DEFERRED)

**Status**: `[!]` DEFERRED — gated on full GO from T005

**Why not done in this session**: T001 + T003 require user execution. Per the decision-gate semantics in workshop 007 §Pre-Work, T006 (which adds 20 ACs to the spec) is conditional on the gate fully closing. Adding 20 ACs and then having to revert if T001 or T003 fails would be churn.

**Will execute when user**:
1. Runs T001 + T003 with GH_TOKEN
2. Pastes results into `prework-results.md` placeholder sections
3. Marks the verdict checkboxes in the memo as PASS

---

## Discoveries & Learnings (mirror in dossier table)

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-04-26 | T002 | insight | fs.watch coalesce ratio is heavy under burst (50 writes → 1 event observed). Per-event detection is NOT 1:1 with writes. | Pass criteria for T002 latency revised: ≥ 50% paired AND mean ≤ 500ms (not "100% detected"). The forwarder MUST drain from watermark, not assume 1 event = 1 line. | T002 summary; workshop 001 §Forwarder-side robustness |
| 2026-04-26 | T004 | decision | Persistent garbage line in inbox NDJSON BLOCKS forward progress until operator intervention | INTENTIONAL conservative safety. Better to halt than to silently skip messages. v1 accepts this; future enhancement = configurable `maxSkipAttempts` policy in plan 008+. | T004 summary pass 4; `prework-results.md` §Locked commitments |
| 2026-04-26 | T002 | insight | Atomic-rename emits 2 `rename` events on the target file on macOS (kqueue) | Confirms workshop 001 §Atomic Write Strategy works AND is observable via fs.watch. Forwarder for state files (atomic-rename pattern) will see the change. | T002 summary; `src/runner/state-forwarder.ts` plan |
| 2026-04-26 | T002 | gotcha | macOS fs.watch returns `eventType='rename'` for both creates AND deletes — semantics depend on filename presence in subsequent stat calls | Don't trust `eventType`; trust the byte content + watermark. P3 forwarder must always re-read from watermark on any event. | T002 atomic-rename results |
| 2026-04-26 | T001/T003 | research-needed | Implementing agent cannot run SDK-dependent tests without GH_TOKEN | Authored both as user-runnable scripts; placeholders in memo for results paste. | `prework-results.md` §Pending Results |
| 2026-04-26 | T005 | decision | Issued PARTIAL GO instead of HALT-pending-all | T002 + T004 results are sufficient to lock the workshop 001 forwarder commitments; T001 + T003 are integration validations of patterns proven elsewhere (sdk-mid-turn-injection.md + mcp-leak-validation.md). User can choose fast-path or pre-commit-path per memo. | `prework-results.md` §Decision Logic |

---

## Phase Status (UPDATED — full landing)

| Stage | Status | Note |
|-------|--------|------|
| 1 — runagent-eventdriven (T001) | `[x]` PASS | single 6.3s + queued 10s (both stages received own turn); `sentAndWaitUsed: false` |
| 2 — fswatch (T002) | `[x]` PASS | mean 15.45ms latency, 100/100 detected, atomic-rename observable, burst coalesces 50:1 |
| 3 — daemon-light-prototype (T003) | `[x]` PASS-with-caveat | mechanically PASS (5/5 forwarded + acked, forwarder <100ms, no double-delivery, idle reached); agent-side reasoning latency 10-17s/round-trip → workshop 007 §Failure-mode fallback applies (v1 acceptance) |
| 4 — multi-process-watch + torn-line (T004) | `[x]` PASS | multi-writer 200/200 lines; torn-line forwarder protocol self-heals; conservative-stop on garbage validated |
| 5 — decision memo (T005) | `[x]` FULL GO with caveat | empirical results from all 4 tests baked in |
| 6 — spec polish (T006) | `[x]` done | 20 ACs merged into spec (now 37 total); plan-level flight plan updated; AC-STATE-TRANSITION-GATED removed inline |

**Phase verdict**: 🛬 **LANDED**. All 6 tasks complete. Daemon-light architecture empirically validated. Spec polished. Plan-level flight plan unlocked P1 (Runner Foundations).

**Additional learnings recorded in Discoveries table**:
- T003 latency caveat (agent reasoning dominates; forwarder is fast) — documented per workshop 007 fallback
- T001 queued scenario validated SDK queue semantics for two back-to-back `session.send` calls (each got own turn in correct order)

**Next**: `/plan-5-v2-phase-tasks-and-brief --phase "Phase 1: Runner Foundations" --plan "docs/plans/007-backgrounding/coordination-plan.md"` to generate the P1 dossier.

---

## Code Review (post-implementation, gpt-5.5)

**Run**: `agents/code-review/runs/2026-04-26T14-33-36-825Z-f024/`
**Verdict**: ✅ **APPROVE** (0 critical / 0 high / 1 medium / 3 low)
**Duration**: 8m 20s

### Findings (all addressed in this session)

| ID | Severity | Issue | Fix applied |
|----|----------|-------|-------------|
| F001 | MEDIUM | T003 + T004 READMEs' "things to copy verbatim" omitted workshop 001 §Forwarder-side robustness point 4 (per-line watermark fsync). A P3 implementor copying directly would miss crash-resilience. | Added 4th item to both READMEs: "PER-LINE WATERMARK FSYNC — persist + fsync the watermark file BEFORE attempting the next line so a crash mid-batch cannot double-deliver." Notes that the scratch tests advance in-memory only (sufficient for test, INSUFFICIENT for production). |
| F002 | LOW | T001 task description references `pending_messages.modified` but actual code subscribes via `session.on()`. | Updated tasks.md task description to "subscribe to session events via `session.on()`" — actually-implemented contract. |
| F003 | LOW | tasks.md header said "Status: Ready for implementation" while the rest of the dossier shows Landed. | Updated header to "🛬 Landed" with full Phase 0 closure summary. |
| F004 | LOW | Flight plan AC said `≤ 50ms` but code threshold is `≤ 500ms` relaxed (with `≥ 50% paired` to handle fs.watch coalescing). Actual mean 15.45ms satisfies both. | Added clarifying note to flight plan AC explaining the deliberate relaxation + actual results far exceed both. |

### Forwarder protocol compliance (workshop 001 §Forwarder-side robustness)

| Requirement | T003 | T004 |
|-------------|------|------|
| Read from byte offset | PASS | PASS |
| Split on newline; JSON.parse each | PASS | PASS |
| Skip-on-parse-fail without watermark advance | PASS | PASS (passes 3+4 empirically validate) |
| Per-line fsync before next line | PARTIAL (F001 addressed by README update) | N/A (T004 tests reader, not writer) |

### Code-review's magicWand (target: minih)

> "The review context should include the exact workshop file paths rather than shorthand references like 'workshops/{001,002,007}.md'. A one-line addition to the input params ('workshop paths: docs/plans/007-backgrounding/workshops/001-filesystem-layout.md, ...') would have saved 3-4 tool calls of path discovery."

Recorded as a future workflow improvement (don't shorten paths in code-review input params; pass full paths).
