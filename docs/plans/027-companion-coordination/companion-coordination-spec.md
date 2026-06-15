# Companion & Coordination Reliability

**Mode**: Full
**Spec Version**: 1.0.0
**Created**: 2026-06-14
**Plan Folder**: `docs/plans/027-companion-coordination/`

📚 Specification incorporates findings from `research-dossier.md` (8-scout pass; critical findings CF-01…CF-07).

## Research Context

minih's coordination layer connects an **outside peer** (human/orchestrator via `minih outside …`) to an **inside agent** (a long-running companion) through file-backed lanes surfaced as a per-run MCP server (8 tools). Across many dogfood runs — and now plan 026's own companion debrief — the same reliability gaps recur: the companion misses queued work, its self-reported state vocabulary is rejected by the schema, its lifecycle counters live in fragile prompt memory, and it can't discover its own idle budget. This plan reconciles **one coordination contract** and makes it reliable and observable. Eight GitHub issues seed the work: #40, #32, #35, #36, #25, #29, #31, #27.

Key research anchors:
- **CF-01 / #40 (root cause confirmed in code)**: `wait_for_any` snapshots inbox message IDs at call entry and only emits *post-snapshot* messages (`src/runner/event-wait.ts:76-80, 191-197`). Work queued while the companion is busy is invisible to its next wait. `inbox_list` reads the full lane *before* arming its watcher (`src/runner/inbox-poll.ts:114-122`) — hence the parity gap.
- **CF-02 / #32**: findings have two delivery paths (live `inbox_send` vs end-of-session `output/report.json` from SDK structured output). Docs tell orchestrators to skim the inbox; code delivers at farewell. The contract must be made singular and documented.
- **CF-03 / #25**: appears already fixed — companion pack overrides `write: allow`; an E205 boot gate (`coord-write-precondition.ts:156-198`) refuses coordinated write-deny runs loudly. Verify-and-close, not a build.
- **CF-04 / #36**: lifecycle counters (reviewed task-ids, finding counts, ackOf chains, idle streak) live in prompt memory; a ledger-derived `companion status`/`finalize` is the **3×-near-verbatim** magicWand. Everything needed already persists in the lanes.
- **CF-05 / #35**: idle budget is prompt-only and invisible (the **single most recurrent retro entry — ≥8 sessions**); 5–15-min commit-boundary gaps trigger premature stand-down; the stop/report window has no final inbox drain (shutdown race).
- **CF-06 / #27/#31**: global state enum (`idle, in-progress, paused, reviewing, complete, error`) rejects prompt-documented `reading, reporting, stopping, blocked`. A 3-level per-agent schema override already exists; `minih doctor` already warns.
- **CF-07 / #29**: no runtime self-discovery surface for the allowed-state enum, coordination mode, or idle budget — and the retros beg for all three, not just the enum.

## Summary

Make the companion-coordination contract **reliable and self-describing**: queued messages reach the companion when they're queued (#40); findings have one declared home, derived from the durable ledger (#32, #36); the companion's lifecycle state lives in files the runtime owns, not prompt memory (#36 → #35); the state vocabulary validates everywhere it is documented (#27/#31); the agent can discover its own contract — allowed states, coordination mode, idle budget — at runtime (#29); and a stranded permission/shutdown edge is closed and verified (#25, #35 shutdown race). No transport change (file lanes stay), no breaking envelope reshapes.

## Goals

- **Inbox delivery parity (#40)**: a companion that calls the wake primitive receives messages that were already queued before the call, with parity to what `inbox_list` returns for the same filter — no message class visible to one primitive but not the other.
- **Singular findings contract (#32)**: exactly one documented home for findings, consistent across AGENTS_README, companion-mode.md, the companion prompt, and the report schema. Orchestrator-facing docs match observed behaviour.
- **Ledger-derived lifecycle (#36)**: a first-class primitive that computes lifecycle state (reviewed task-ids, finding/summary counts, ackOf chains, unresolved peer requests, idle streak, last-task-id) from the inbox/state lanes, and assembles a schema-valid draft farewell envelope — so the companion edits the human retrospective on top instead of hand-reconstructing counts.
- **Idle policy owned by durable state (#35)**: idle-budget decisions read the ledger from #36 (not prompt-counted empty polls); the configured budget is discoverable; a coordination-aware posture avoids mid-phase stand-down; the stop/report window performs a final inbox drain so a late ping is never stranded.
- **State-vocabulary coherence (#27/#31)**: every status the companion prompt instructs the agent to publish is accepted by the schema it validates against; `minih doctor` proves the absence of drift.
- **Runtime self-discovery (#29)**: the inside agent can read its own coordination metadata — allowed-state enum, coordination mode, and idle budget — through a dogfood-safe surface, so prompts self-adapt instead of discovering mismatches at runtime.
- **Verified edge closure (#25)**: confirm the farewell-write block is dead, correct the doc that mis-describes the E205 signal, and close the issue.

## Non-Goals

- **No transport change** — coordination stays file-backed NDJSON lanes + per-run MCP server. No sockets, no broker.
- **No breaking reshape of the inbox message envelope or `output/report.json` required fields** — additive widening only; outside CLI, `minih last-run`, retro harvest, and external orchestrator skills consume these.
- **No Windows-specific work** — platform-neutral logic only; Windows detached behaviour stays untested (consistent with plan 026).
- **Not a redesign of the SDK/adapter boundary** — the structured-output path is consumed as-is.
- **#37 (MINIH_PROJECT_ROOT not exported to shell tools)** is out of scope — it shares the spawn-env seam but is a distinct bug; note the adjacency, don't fix it here.
- **No new coordination transport vocabulary beyond what the contract decision requires** — message `type` stays free-form; we widen wake filters, not the envelope.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| mcp | existing | **modify** | wait_for_any parity (CF-01); new self-discovery context tool (CF-07); state-schema resolution; possibly a finalize-as-tool surface (CF-04) |
| runner | existing | **modify** | event-wait + inbox-poll primitives; ledger derivation over lanes (CF-04); stop-window drain (CF-05); report assembly; permission-precondition doc |
| cli | existing | **modify** | `minih companion status` / `minih companion finalize` verbs (CF-04); new doctor check(s); outside-peer ergonomics |
| measurement | existing | **consume** | metric/vocabulary alignment only if lifecycle counters surface as metrics — no contract change expected |
| adapter | existing | **consume** | structured-output path consumed unchanged |

### Non-domain artifact (governed by convention, not the domain system)

- **`agents/code-review-companion/` pack** — **modify**: prompt vocabulary, a per-pack state schema, and the wake filter must change **in lockstep** with the schema/contract decisions. The pack sits outside the domain registry (DB-08); `minih doctor` is the coherence sensor that must enforce the lockstep.

## Testing Strategy

**Approach**: Full TDD (RED test first per code fix).

**Rationale**: The fixes are logic-heavy and several are correctness-critical (wait_for_any queued-message semantics, ledger derivation, schema validation, stop-window drain ordering). The QT scout confirmed most clusters are unit-provable on existing seams; #40's snapshot bug specifically needs a regression test that a snapshot-based primitive would fail. Plan 026's HIGH finding came precisely from a test-seam blind spot (ScriptedAdapter masked the real adapter) — TDD with the right seam is the guard.

**Focus Areas**: wait_for_any "queued-before-call" delivery; ledger-derivation correctness from lane fixtures; idle-policy decisions driven by ledger state; stop-window drain ordering (late-ping not stranded); schema acceptance of the full companion vocabulary; doctor drift detection; self-discovery surface contents.

**Excluded (inferential / live-run only)**: end-to-end behaviour of a real Copilot subprocess under real timing; multi-minute idle pacing in a live run. These are routed to manual/live verification and the code-review-companion's own dogfood, not deterministic CI.

**Mock Usage**: Targeted mocks only. Real fixtures + temp dirs for lanes/state/report; mock only the SDK boundary and timing seams (`FakeAgentAdapter`, `ScriptedAdapter`, `FakeNativeWatcher`, injected clocks). No liberal mocking — it was liberal-mock-style seam substitution that hid #40-class bugs before.

## Documentation Strategy

**Location**: Hybrid (README/AGENTS_README + `docs/how/`).

**Rationale**: #32's core complaint is docs-vs-code drift, and the drift catalogue spans **both** AGENTS_README (Companion mode, Coordination-aware agents, Output Contract, Permissions) and `docs/how/companion-mode.md` (idle budget, exit reasons). Both must be reconciled to the singular contract this plan establishes; leaving either stale reproduces the original trap. Quick-start surfaces (README CLI reference) gain the new `minih companion` verbs.

## Complexity

- **Score**: CS-4 (large) — at the high end; borderline CS-5 on breadth.
- **Breakdown**: S=2 (four domains + a pack, many files), I=2 (cross-domain MCP+CLI+runner+pack lockstep), D=2 (schema/state/ledger/lanes), N=1 (new lifecycle primitives, but patterns exist), F=2 (race conditions, idle timing, backward-compat), T=1 (strong deterministic seams; some live-run residue).
- **Confidence**: 0.70 — the wait_for_any and enum decisions have multiple defensible shapes (workshop candidates); scoping of #32/#29 breadth is a judgement call.
- **Assumptions**: #25 is already fixed (verify confirms); the per-pack state-schema override seam works as the dossier reports; ledger fields needed for #36 all already persist in the lanes.
- **Dependencies**: #36 (lifecycle primitives) must land before #35 (idle policy reads its state). The #27/#31 enum decision must land before #29 (you expose the vocabulary you chose). #40 is foundational to the contract but independently shippable.
- **Risks**: changing wait_for_any semantics could affect other consumers relying on "changes-only"; enum widening touches a globally shared schema; the stop-window drain must preserve plan-014's single-settle teardown guarantee.
- **Phases**: 6 (0–5), one per issue cluster, dependency-ordered.

## Phase Plan (sketch — architect finalizes)

| Phase | Cluster | Issues | Primary Domain | Depends On |
|-------|---------|--------|----------------|------------|
| 0 | Verify-and-close permission edge | #25 | runner + docs | None |
| 1 | Inbox delivery parity | #40 | runner (event-wait) + mcp | None |
| 2 | State-vocabulary coherence | #27, #31 | schemas + mcp + pack | None (workshop candidate) |
| 3 | Ledger-derived lifecycle primitive | #36 (+ #32 contract) | runner + cli (+ mcp) | Phase 1 (parity), Phase 2 (vocab) helpful |
| 4 | Idle-budget policy + shutdown drain | #35 | runner + pack | **Phase 3** |
| 5 | Runtime self-discovery + docs reconciliation | #29 (+ #32 docs) | mcp/runner + cli + docs | **Phase 2, Phase 4** |

> #32 is cross-cutting: its findings-home decision is realized by Phase 3 (ledger) and its docs reconciliation completes in Phase 5.

## Acceptance Criteria

**Phase 0 — #25 verify-and-close**
1. A test demonstrates the original #25 repro is dead: a coordinated companion with the release-default flow can write `output/report.json` (or the boot gate fires E205 loudly with an actionable message — whichever the current design intends), with no silent missing envelope.
2. The doc that describes E205 as an *inbox message* is corrected to state it fires at boot (before the inbox exists); the verified disposition is recorded for the #25 close comment.

**Phase 1 — #40 inbox delivery parity**
3. Given messages already queued in the outside lane before the inside agent calls the wake primitive, the primitive returns those queued matches (subject to its type filter) rather than only post-call arrivals — proven by a regression test that a snapshot-at-entry implementation fails.
4. Parity holds: for the same filter, the wake primitive and `inbox_list` surface the same message set (no class visible to one but not the other), preserving the single-settle teardown guarantee.
5. The wake filter supports a documented "any outside message" form (wildcard or equivalent) so a companion cannot go deaf when a new message `type` is introduced.

**Phase 2 — #27/#31 state vocabulary**
6. Every status the `code-review-companion` prompt instructs the agent to publish (`reading`, `reviewing`, `reporting`, `stopping`, `blocked`, plus the base set) is accepted by the schema that agent validates against — proven by a test exercising each transition.
7. `minih doctor` reports **no** prompt-vs-schema state-vocabulary drift for the companion pack, and a test pins that result.

**Phase 3 — #36 lifecycle primitive (+ #32 findings home)**
8. A primitive computes, from the inbox/state lanes alone, a lifecycle summary containing at least: reviewed/acked task-ids, findings-sent count, summaries-sent count, ackOf chains, unresolved peer requests, idle streak, and last-task-id — proven against seeded lane fixtures.
9. The primitive assembles a **schema-valid** draft farewell/report envelope from that summary (the agent need only add the human retrospective), and a test validates the draft against the report schema.
10. The findings contract is singular and documented: the chosen home for findings (live inbox vs farewell-derived) is stated once, and the companion prompt + report schema + orchestrator docs agree — verified by a drift check.

**Phase 4 — #35 idle policy + shutdown drain**
11. Idle-budget / stand-down decisions are driven by durable ledger state (from Phase 3), not prompt-counted empty polls — a test drives a mid-phase gap and shows the companion is **not** prematurely stood down when the peer is mid-phase.
12. The configured idle budget is discoverable at runtime (via the Phase 5 surface or an interim field) — a companion can read its budget rather than guess.
13. The stop/report window performs a final inbox drain: a ping arriving during the shutdown/report-write window is captured (re-entrant farewell or pre-write drain), proven by a test that injects a late message and asserts it is not stranded.

**Phase 5 — #29 self-discovery + docs reconciliation**
14. The inside agent can read its own coordination metadata — allowed-state enum, coordination mode, and idle budget — through a dogfood-safe surface (new MCP context tool and/or run-metadata block), proven by a test asserting the returned shape.
15. AGENTS_README and `docs/how/companion-mode.md` are reconciled to the singular contract: findings home, exit-reason vocabulary (incl. `no_engagement`), state vocabulary, and idle-budget behaviour match code — verified by the doc-drift check and a doctor pass.
16. Housekeeping: `docs/domains/registry.md` reflects the correct MCP tool count (8, not "six") and any new tools/verbs added by this plan.

**Whole-plan gate**
17. `just fft` exits 0 (lint, format, build, typecheck, full test suite, audit, sdk-check) with the new tests included; no regression in the existing coordination suite.

## Risks & Assumptions

| Risk / Assumption | Impact | Mitigation |
|---|---|---|
| Changing wait_for_any semantics breaks "changes-only" consumers | Other prompts/docs may rely on current behaviour | Audit consumers in Phase 1; prefer additive (immediate-pass for already-queued *unread*) over reshaping; ADR if the contract changes |
| Enum widening touches a globally shared schema | All agents share `inside-state.json` | Prefer per-pack override (seam exists) or additive widening; never remove values; doctor proves coherence |
| Stop-window drain disturbs plan-014 single-settle teardown | Regression in the hard-won race cleanup | Keep teardown invariant; add the drain as a pre-write step, not a watcher change; test the settlement paths |
| #25 is NOT actually fixed | Phase 0 becomes a real build | Phase 0 starts with the repro test; if it still fails, escalate scope and note it |
| #36 ledger needs a field not persisted in lanes | Finalize can't be purely derived | Phase 3 first enumerates required fields against actual lane contents; gap → add minimal persistence, flagged |
| Idle policy "peer mid-phase" signal is ambiguous | Could still stand down or never stop | Drive from ledger + explicit briefing-declared cadence; keep an absolute ceiling so a dead peer still terminates |

## Open Questions

- **Findings home (#32)**: is the canonical contract "findings are sent live via inbox AND mirrored into the farewell from the ledger", or "farewell-only, ledger-derived"? (Lean: live-inbox + ledger-derived farewell — self-consistent with #36. Workshop/architect to settle.)
- **#29 scope**: expose only the allowed-state enum (issue as filed), or the broader trio (enum + mode + idle budget) the retros beg for? (Lean: broader trio — marginal cost, kills the recurring class.)
- **finalize/status surface**: CLI verb (`minih companion …`), MCP tool, or both? Inside needs `finalize` pre-farewell; outside needs `status`. (Lean: CLI for outside status + MCP/inside path for finalize — confirm in workshop.)
- **wait_for_any fix shape**: immediate-pass + introduce ack/unread semantics, durable read-cursor, or a new sibling tool? (Workshop candidate.)

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| wait_for_any delivery semantics (#40) | State Machine / API Contract | Multiple defensible fixes with different blast radii; the primitive has no unread/ack concept today | Immediate-pass vs durable cursor vs new tool? Introduce ack semantics? Keep single-settle? Consumer audit. |
| State-vocabulary single-sourcing (#27/#31) | Data Model / Contract | "Schema and prompt share one generated source" is the stated ideal; three shapes (widen global / per-pack / generated) | Widen vs per-pack vs codegen? Where does the single source live? How does doctor enforce it? |
| Companion lifecycle primitive shape (#36) | CLI Flow / API Contract | New surface; inside-vs-outside consumers differ; report-envelope assembly contract | CLI verb vs MCP tool vs both? What exactly does finalize prefill? How does it map to the report schema? |

## Clarifications

### Session 2026-06-14

- **Workflow Mode** → **Full**. Rationale: four target domains plus an ungoverned pack, eight issues across dependency-ordered clusters, CS-4 (borderline CS-5). One phase per cluster.
- **Testing Strategy** → **Full TDD**. RED test first per code fix; logic-heavy, correctness-critical, strong deterministic seams; plan 026's HIGH bug came from a test-seam blind spot.
- **Mock Usage** → **Targeted mocks only**. Real fixtures/temp dirs for lanes/state/report; mock only the SDK boundary and timing seams (FakeAgentAdapter / ScriptedAdapter / FakeNativeWatcher / injected clocks).
- **Documentation Strategy** → **Hybrid (README/AGENTS_README + docs/how/)**. #32's drift spans both; both reconciled to the singular contract, plus README CLI surfaces for the new verbs.
