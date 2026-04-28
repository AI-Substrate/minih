# Run 002 — Plan 010 T001-T008 — Companion Retrospective

**Plan**: 010-coordination-cli-and-resume
**Tasks reviewed**: T001-T008 (HF-001 blocking inbox + HF-002 lane CLI rename)
**Companion runId**: `2026-04-28T21-15-10-836Z-9315`
**Companion sessionId**: `1898ab5e-2a5c-4565-9ba3-ecff951bbbe5`
**Started**: 2026-04-28T11:15:10Z
**Ended**: 2026-04-28T12:34:12Z (idle_budget exit, validated, exit code 0)
**Duration**: ~79 minutes
**Events**: 16,503
**Tool calls**: 242
**Tasks received**: 6 (some bundled multiple plan tasks)
**Findings sent**: 9 (2 HIGH, 3 MEDIUM, 4 LOW)
**Source farewell envelope**: `agents/code-review-companion/runs/2026-04-28T21-15-10-836Z-9315/output/report.json`

---

## Findings (verbatim from farewell envelope)

| ID | Severity | Category | File | Issue | Disposition |
|----|----------|----------|------|-------|-------------|
| F001 | MEDIUM | Testing & Evidence | test/runner/inbox-poll.test.ts | Test #7 tests clean timeout, not the timeout-vs-change boundary race from plan edge case #7. The actual race condition at the boundary is untested. | **Open** — easy follow-up: schedule a write near the timeout boundary to exercise the settled guard. |
| F002 | MEDIUM | Testing & Evidence | test/runner/inbox-poll.test.ts | Test #8 only exercises sync watchFactory throw. The existing MCP implementation has a distinct async onError callback path (inbox.ts:167) that fires after the watcher is already running. | **Open** — add a second test case with an async error factory. |
| F003 | LOW | Testing & Evidence | test/runner/inbox-poll.test.ts | No dedicated test exercises the `after` filter parameter. Only indirectly tested via nextAfter assertion in test #9. | **Open** — defer; add a small test that explicitly exercises the after filter. |
| F004 | LOW | Anti-Reinvention | src/mcp/tools/inbox.ts, src/runner/inbox-poll.ts | Five functions duplicated between inbox-poll.ts (runner) and inbox.ts (MCP): readLane(File), parseMessageLine, requireStringField, requireSender, isRecord. Minor error message drift already exists. | **Open** — defer; refactor inbox.ts:readLane to delegate to readLaneFile from inbox-poll.ts. |
| F005 | **HIGH** | Implementation Quality | test/cli/outside-inbox-wait.test.ts | Tests asserted error codes E122/E123 but output.ts defined them as E141/E142. Tests would have failed for the wrong reason. | **Fixed inline** during review (sed -i '' s/E122/E141/g, s/E123/E142/g). Companion caught this at first review. |
| F006 | LOW | Testing & Evidence | test/cli/outside-inbox-wait.test.ts | E142 (AGENT_GONE) test only exercises status-flip detection path (run.json status changed to failed), not pid-death path. Test uses process.pid which is alive. | **Open** — defer; use a dead pid (e.g., 999999) for more realistic coverage. |
| F007 | MEDIUM | Implementation Quality | src/cli/commands/outside-inbox-list.ts (now src/cli/commands/outside.ts) | Promise.race casts winner as PollInboxResult but livenessPromise resolves with void. Type-unsafe cast hides potential undefined winner. | **Open** — refactor to typed discriminated union (`kind: 'poll' | 'liveness'`). Carried over to outside.ts during T005 hard rename. |
| F008 | LOW | Domain Compliance | src/cli/commands/inside.ts, state.ts | Both inside.ts and state.ts import shared helpers from outside.ts, creating a misleading coupling where inside commands depend on the outside module. | **Open** — defer; extract shared helpers into lane-helpers.ts that both outside.ts and inside.ts import from. |
| F009 | **HIGH** | Implementation Quality | docs/domains/cli/domain.md, runner/domain.md, how/coordination-loop-validator.md | Sweep missed 18 stale references to old flat commands in current documentation (Concepts tables, Behavioral Contracts, Test Coverage tables). Domain docs reference deleted files and old command names. | **Fixed in T008/T019 sweep** — replaced all references; added 010 history rows for cli, runner, mcp domains. |

### Summary

> **Companion verdict**: All HF-001 and HF-002 tasks **APPROVED or APPROVED-WITH-NOTES**. HF-003 (T009-T018) was not reviewed because the companion's idle budget expired before the implementer started those tasks.

---

## Magic Wand 🪄

**Target**: `coordination` (i.e., minih runner enhancement, not project-specific)

> *"Add an `idleSince` field to the coordination state (automatically computed from the last outside inbox message timestamp) so long-running companions don't have to manually track idle budget. This would be a simple runner enhancement — when the inside agent calls `state_get`, the response could include `peerIdleSince: <ISO timestamp of last outside message>` alongside the existing state data. Companions could then compare against `idleBudgetMs` without any manual bookkeeping."*

**Why this matters**: long-running coordinated agents (Workshop 007 companions, Phase 2 of plan 009) need to self-manage their idle budget so they don't burn tokens forever. The current pattern is "count poll iterations × ~30s/iter and farewell when idleBudget exceeded" — fragile, manual, and easy to drift.

**Implementation sketch (for future plan)**:
- Runner already tracks the last outside message timestamp via the inbox-forwarder watermark.
- `state_get` envelope gains an optional `peerIdleSince` field at the response root (not inside the state object — different lane lifecycle).
- Default behaviour preserved when no outside message has ever arrived (`peerIdleSince: null`).

---

## Difficulties Ledger

| ID | Category | Severity | Description | Workaround |
|----|----------|----------|-------------|------------|
| **MH-004** | knowledge | degrading | Error code numbering in plan text (E121-E130) conflicted with existing output.ts codes (E121-E128). Plan-4 validation didn't catch this, and the implementation correctly renumbered to E140-E149, but the T003 test file was written against the plan's stale E122/E123 references. | Caught during review and flagged as HIGH (F005). Implementer fixed the test assertions inline. **Lesson for future plans**: plan-4 should grep `src/cli/output.ts` for existing `ErrorCodes` enum values when error codes are introduced in a plan; collisions surface at validation time, not implementation time. |
| **MH-005** | config | annoying | No built-in idle budget timer in the coordination state. Had to manually count poll iterations to estimate time since last outside message. | Used approximate counting (each poll = ~30s). Sent a heartbeat at ~20min mark to let the peer know the companion was still alive. **Resolved by**: see Magic Wand above (`peerIdleSince` field). |

---

## Coordination Notes (verbatim from companion)

> *"The ackOf correlation worked well — every finding and summary linked back to its task. The peer's fire-and-forget pattern meant I never blocked them. The main coordination gap was the long idle between HF-002 and HF-003 (~30min) where the peer was presumably implementing complex TDD work. A status update from the peer ('still working on T009, ETA 15min') would have helped me decide whether to stay alive or farewell early. Consider adding a 'busy-no-review-pending' heartbeat convention to the vocabulary."*

**Counters from envelope**:
- peerUpdatesSent: 14 (companion → operator inbox messages)
- unresolvedPeerRequests: 0
- statePublished: true

---

## Companion's "Worked Well" Notes (verbatim)

> *"The pipelined Option A' protocol is excellent — fire-and-forget task messages with no blocking between tasks lets the implementer maintain velocity while I review asynchronously. The inbox long-poll (waitMs: 30000) made idle periods efficient without busy-looping. State transitions provided good visibility. The MCP toolset worked perfectly — inbox_list, inbox_send, inbox_ack, state_transition all operated without errors. The plan 010 artifacts (spec, plan, workshop, validation record) gave me enough context to review meaningfully without asking questions."*

---

## Companion's "Confusing" Notes (verbatim)

> *"The error code renumbering (plan text said E121-E130 but implementation used E140-E149) caused the only HIGH finding that could have been caught earlier. The plan validation should have flagged the collision with existing E121-E128 codes before implementation began. Also, the idle budget boundary is fuzzy — I measured 'last outside message' manually since there's no built-in timer. A minih-provided idle-budget countdown or 'time since last peer message' field in state_get would help companions self-manage."*

---

## What the Companion Did NOT Review

HF-003 (resume-in-place — T009-T018) was not reviewed because the companion's idle budget expired before the implementer started those tasks. **Action**: spin up a fresh companion run when implementing T009-T018, briefing it on:

- Workshop 001 (resume-in-place semantics) — eligibility states, takeover protocol, manifest evolution, prefix prompt, failure modes
- Lessons from this run (especially the error code drift; verify all E140-E149 codes are present in output.ts before the test file is written)
- Pipelined Option A' protocol (fire-and-forget, drain at end)

---

## Cross-Plan Aggregation

These items should also be considered for the broader feedback aggregation:

- **MH-004 → plan-4-v2-complete-the-plan skill**: add a check that greps `src/cli/output.ts` (or wherever error codes are centralized) for collisions with codes mentioned in the plan being validated. Catch this at clarify-time rather than implementation-time.
- **MH-005 + magic wand → plan 011 candidate**: `peerIdleSince` field in coordination state. Small, additive, runner-only change.
- **Companion coordination note → coordination vocabulary**: add a `busy` or `progress` message convention so long-running peers can post heartbeats without being interpreted as findings/summaries. Workshop 007 may want to formalize this.

---

## Provenance

- **Source**: `agents/code-review-companion/runs/2026-04-28T21-15-10-836Z-9315/output/report.json` (farewell envelope, validated against `agents/code-review-companion/output-schema.json`)
- **Verifier**: completed.json shows `validated: true`, `userValidated: true`, `systemValidated: true`, exit code 0
- **Captured**: 2026-04-29T08:55Z (post-run snapshot, this file)
