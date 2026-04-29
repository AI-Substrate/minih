# Peer Activity Telemetry

**Mode**: Simple

📚 *This specification incorporates findings from `research-dossier.md` and is derived from the authoritative design in [`docs/plans/011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md`](../011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md). The workshop is the canonical design source; this spec captures user-visible WHAT/WHY and the acceptance contract.*

## Research Context

- **Lived motivation**: Plan 011's Power On Mode lost ~30 minutes to a silent failure where the companion agent was alive and polling but its `inbox_list waitForAny` filter excluded the message types the orchestrator was sending. State (self-reported) said `idle`; behaviour (observed via `events.ndjson`) showed structural deafness. Nothing surfaced the mismatch until a 60s drain timeout. (See run-file `runs/001-power-on.md` MH-009 HIGH.)
- **Code-side feasibility**: confirmed. Event shape is byte-for-byte what the workshop assumed (verified against a real run). All five target commands live in one file (`src/cli/commands/outside.ts`) with consistent shape. New code is essentially one new pure-function module + small additive envelope fields.
- **No external research needed.**

## Summary

When an orchestrator (human or LLM) writes to a coordinated agent's inbox or state, the response should make it **structurally impossible** to be unaware that the message will land somewhere it can't be processed. We derive ground-truth peer activity from the agent's `events.ndjson` (which records every MCP tool call) and surface it as an additive `peer` block — including a single-word `verdict` like `listening`, `deaf`, `silent`, or `dead` — in the response of every transactional outside-lane command.

## Goals

- **Catch deafness at send-time**, not at timeout. If the agent's poll filter excludes the message type just sent, say so in the response.
- **Trust behaviour over self-report.** State can be stale, missing, or wrong; tool-call telemetry is objective. Verdict comes from telemetry; state is included as informational cross-check.
- **Single-word `verdict` is the contract.** Tooling, scripts, and LLM orchestrators key off `verdict` (`listening` / `between-polls` / `deaf` / `silent` / `dead` / `n/a`). Full peer block is for humans and rich tooling.
- **Make it cheap and additive.** Sub-millisecond cost per command; envelope changes are purely additive (no breaking changes for existing consumers).
- **Apply uniformly to every transactional outside command** (send, state set/transition, retro add, list-with-wait). Reads (state get, inspect) skip it.
- **Optional strict mode** (`--strict-peer`) for protocols that want to refuse a send when the verdict is `deaf`.

## Non-Goals

- **Not** modifying the agent's behaviour, state semantics, or filter rules. Telemetry observes; it doesn't change what agents do.
- **Not** adding inside-side reverse symmetry (inside agent observing outside). Workshop Q6 — defer.
- **Not** auto-coercing message types based on filters (Workshop §"Policy C"). Risky; defer.
- **Not** caching derived peer activity. Workshop Q3 — sub-ms cost; defer.
- **Not** changing how `events.ndjson` is written. Reader-only consumer.
- **Not** persisting derived peer state. Snapshot-at-call-time only.
- **Not** introducing real-time push notifications about peer activity. Read-on-demand only.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|---|---|---|---|
| `runner` | existing | **modify** | Add `src/runner/peer-activity.ts` (pure-function derivation primitive); export from `src/runner/index.ts` |
| `cli` | existing | **modify** | Inject `peer` block into 5 outside-lane envelope sites; render verdict on stderr in TTY mode; add `--strict-peer` flag on `outside inbox send`; surface deaf agents in `minih doctor` |
| `mcp` | existing | **consume** | No changes — coordinated tool names (`minih-coordination-*`) are observed indirectly via recorded events |
| `adapter` | existing | **consume** | No changes — `tool_call` event shape (`src/adapter/events.ts:107-114`) is the read-side contract |

No new domains. The work fits cleanly inside existing `runner` + `cli` boundaries; `mcp` and `adapter` are observed-only.

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=2, I=0, D=0, N=0, F=0, T=1 (total P=3)
  - **S=2** — cross-cutting through 5 outside commands plus a new module, but concentrated in 2 files
  - **I=0** — internal only; no external deps
  - **D=0** — no schema/migration; envelope addition is purely additive
  - **N=0** — workshop locks the design; verdict rules + envelope shape are predetermined
  - **F=0** — standard performance; no security/compliance gates
  - **T=1** — needs unit tests for derivation + integration tests for envelope shape across multiple commands
- **Confidence**: 0.85 — workshop and dossier converge cleanly; main uncertainty is the verdict rule edge cases (which the workshop already enumerates, just need encoding).
- **Assumptions**:
  - `events.ndjson` `tool_call` shape will not change during plan 012 (verified stable)
  - Coordinated MCP tool names retain the `minih-coordination-*` prefix (stable in `src/mcp/types.ts`)
  - Existing `formatSuccess` envelopes accept additive fields without breaking consumers (verified — current tests don't whole-envelope snapshot)
- **Dependencies**: None blocking. Plan 011 shipped; no in-flight work touches `outside.ts` or events writing.
- **Risks**:
  - TTY rendering must not leak into piped stdout (existing convention — easy to honour)
  - `outside inbox list --wait` long-poll: `peer` block must reflect resolution time, not call start
  - Reverse-tail of `events.ndjson` must filter for `type === 'tool_call'` only (resume events, session_start, etc. are interleaved)
- **Phases**: Single-phase plan (Simple Mode). 8 tasks: (T000) widen `code-review-companion` `waitForAny` filter — Phase 0 hotfix; (T001) `derivePeerVerdict` pure verdict ladder + types + 12-row TDD matrix; (T002) `derivePeerActivity` I/O wrapper + reverse-tail + edge-case tests; (T003) wire `outside inbox send` + `--strict-peer` flag + integration test; (T004) wire remaining 4 commands; (T005) `minih doctor` integration; (T006) docs (AGENTS_README + scaffolded note + preamble §) + domain history; (T007) closeout (run `just fft`, mark plan complete, run-file).

## Acceptance Criteria

1. **AC-01 — Envelope contains `peer` block on `outside inbox send`.** When invoked against a coordinated run with an existing `events.ndjson`, the JSON envelope's `data` includes a `peer` object with at minimum `{ verdict, reason, willMatchType, lastPollAt, lastPollFilter, currentlyPolling, currentlyRunningTool, selfReportedState }`.

2. **AC-02 — Verdict is `deaf` when filter excludes the sent type.** Given a recent `inbox_list` call with `waitForAny: ['task','question']` and a send with `--type review-request`, the response must include `peer.verdict === 'deaf'`, `peer.willMatchType === false`, and a `peer.reason` string that includes a `try one of: <comma-separated filter types>` hint.

3. **AC-03 — Verdict is `listening` when currently polling AND filter matches.** Given an `inbox_list` call within the last `waitMs` window whose `waitForAny` includes the sent type (or is null/empty = open filter), the verdict must be `listening`.

4. **AC-04 — Verdict is `between-polls` when filter matches but no active poll window AND cadence is recent.** When the agent's typical poll cadence is < 60s and the last poll was within 2× that, with a matching filter, verdict is `between-polls`.

5. **AC-05 — Verdict is `silent` when no `inbox_list` call in last 5 minutes.** Even if the run is otherwise healthy, prolonged absence of poll activity yields `silent` with a reason field.

6. **AC-06 — Verdict is `dead` when `run.json.status` is `completed`, `failed`, or `stale`.** The `dead` verdict overrides telemetry-derived states.

7. **AC-07 — Verdict is `n/a` (or `peer` block omitted) for non-coordinated agents.** When the run dir has no `state/inside.json` (i.e. the agent is not coordination-enabled), the command does not include a `peer` block (or includes one with `verdict: 'n/a'`).

8. **AC-08 — `peer` block is additive.** Existing fields in `data` (e.g. `messageId`, `timestamp`, `target`, `message`) remain unchanged. Existing tests that assert on those fields continue to pass without modification.

9. **AC-09 — TTY mode renders verdict on stderr.** When `process.stderr.isTTY` is truthy, a human-readable line indicating the verdict (and a hint when `deaf`) is written to stderr. When stderr is piped, no verdict line is rendered.

10. **AC-10 — `--strict-peer` flag exits non-zero on deaf.** `outside inbox send --strict-peer` exits with a documented error code (e.g. `E15X DEAF_PEER`) when verdict is `deaf`. Without `--strict-peer`, the send always proceeds and exits 0 regardless of verdict.

11. **AC-11 — `peer` block on every transactional outside command.** `outside inbox send`, `outside inbox list --wait`, `outside state set`, `outside state transition`, and `outside retro add` all include a `peer` block in success envelopes. Pure reads (`state get`, `inspect`) do not.

12. **AC-12 — `minih doctor` lists deaf coordinated runs.** Running `minih doctor` produces a section that names each active coordinated run whose current verdict is `deaf` or `silent` past the default thresholds (silent=5min, dead=30min). Healthy runs are not noised. Thresholds are not user-configurable in v1.

13. **AC-13 — Derivation is a pure function with bounded cost.** `derivePeerActivity({ runDir, messageType, now, tailLines })` reads at most `tailLines` lines from `events.ndjson` (default 1000) plus `state/inside.json` and `run.json`. No writes. No process state. Repeatable and deterministic given inputs.

14. **AC-14 — Reverse-tail tolerates torn / empty / missing files.** When `events.ndjson` is missing, empty, or partially written (last line incomplete), `derivePeerActivity` returns a sensible verdict (`silent` or `n/a`) and never throws.

## Risks & Assumptions

- **Risk: `outside inbox list --wait` snapshot timing.** The peer block read at the start of a 30s long-poll is stale by the time the poll resolves. *Mitigation*: derive the block right before constructing the response envelope, not at call entry.
- **Risk: Verdict rule edge cases drift.** The workshop's verdict table has 5 states with several "OR" / "AND" composites. *Mitigation*: encode the rule table as a single decision function with comprehensive unit tests covering each state's entry conditions.
- **Risk: `--strict-peer` could mask real issues by giving operators a hammer.** A hurried operator might `--force` past `deaf` rather than fix the agent. *Mitigation*: make `--strict-peer` opt-in (default off); the visible-but-non-blocking default surfaces the signal without forcing action.
- **Assumption: Verdict rule is stable.** We commit to the 6-state vocabulary (`listening` / `between-polls` / `deaf` / `silent` / `dead` / `n/a`) for v1. Adding states later is non-breaking; renaming/removing would be.
- **Assumption: 1000 tail-lines is sufficient.** Most coordinated agents poll at least every 30s, so 1000 lines covers 30+ minutes. Workshop Q2 recommends this.
- **Assumption: Doctor's "extended period" threshold.** Default 5 minutes for `silent` to surface in doctor; tunable later if needed.

## Open Questions

> *All resolved during `/plan-2-clarify` Session 2026-04-29 — see § Clarifications below.*

## Testing Strategy

**Approach**: **Hybrid** — Full TDD for `derivePeerVerdict` (the verdict ladder) and the reverse-tail helper; Lightweight for the CLI envelope wiring (mechanical inserts validated by integration tests).

**Rationale**: The verdict rules are pure logic with explicit precedence — workshop 001's 12-row test matrix begs for TDD and makes regressions instantly obvious. CLI wiring is parallel mechanical edits; one integration test per envelope-using command catches drift cheaper than per-line unit tests.

**Focus areas**:
- Verdict-rule precedence (every rule path + boundary cases — 12+ tests)
- Reverse-tail of `events.ndjson` (torn last line, missing file, empty file, file rotation behaviour, type filtering)
- Cadence math (median over 0/1/2/many polls, `lastPollWaitMs` absent)
- `willMatchType` defensive cases (null filter = open, empty filter = open)
- Envelope additivity (existing fields unchanged on each command)
- TTY rendering (verdict line on stderr only when `process.stderr.isTTY`)
- `--strict-peer` flag (exits non-zero on `deaf`, no-op on other verdicts)
- Doctor lists deaf/silent active runs (with healthy-run quietness)

**Excluded**:
- Multi-process race tests (the file is append-only; OS handles atomicity per AC-14)
- Performance benchmarks (sub-millisecond cost; not a NFR)
- E2E with a real coordinated agent (T000 hotfix + plan 011 Power On Mode evidence covers this)

**Mock policy**: **Avoid mocks**. `derivePeerVerdict` is pure (inputs → output, zero I/O). `derivePeerActivity` and the reverse-tail use real fixture `.ndjson` files in tmpdir, mirroring `state.test.ts`/`run-manifest.test.ts`/`inbox-poll.test.ts` patterns.

## Documentation Strategy

**Approach**: **Hybrid** — three short surfaces:

1. **AGENTS_README.md** — new short § "Coordination visibility" describing what `peer.verdict` means, the 7 values, and how scripts/operators use it.
2. **Scaffolded README note** — `minih init` for coordinated agents already creates outside.md and retros/README.md (plan 011); add a one-line pointer to the verdict vocabulary so new agents inherit awareness.
3. **Preamble operator-side §** — extend the existing "For Operators" block in `agents/_shared/preamble.md` (and `src/templates/shared-preamble.md`) with a one-paragraph mention of how to read the `peer` block.

No new docs/how/ files. Workshop 001 + this spec are the deep reference; the public-facing docs stay light.

## Open Questions

> *All resolved during `/plan-2-clarify` Session 2026-04-29 — see § Clarifications below.*

## Workshop Opportunities

> *The authoritative design workshop exists at [`docs/plans/011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md`](../011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md) — it locks derived facts, verdict rules, surface design, and naming. The opportunities below are **adjacent** topics that the spec exposed; resolving any of them produces clearer plan-3 architecture.*

| # | Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|---|
| 1 | **Verdict decision rules as a state machine** | State Machine | Workshop 001 lists 5 verdict states with `OR`/`AND` composite conditions; rule precedence (e.g. does `dead` always override `deaf`?) is implicit. Encoding as an explicit transition table prevents subtle bugs and makes the unit-test matrix obvious. | Precedence ordering? Tie-breakers? Empty-history initial state? Cadence-window definitions? Whole rule table as one pure function vs. layered guards? |
| 2 | **Doctor surface design for deaf-agent audit** | CLI Flow | AC-12 says doctor lists deaf/silent runs but doesn't specify the output shape, noise threshold, or interaction with existing doctor sections. Many runs across many agents could create wall-of-text. Worth designing the output before implementing. | Per-agent or per-run rows? `silent` threshold (5 min? configurable?)? Suppress healthy agents entirely or show `✓ N healthy`? Group by status? Exit-code semantics? |
| 3 | **Coordination filter vocabulary contract** | Integration Pattern | The plan 011 bug was a vocabulary mismatch (`briefing`/`review-request` not in `task`/`question`/...`). Plan 012's `verdict: deaf` exposes the symptom but the structural fix is a contract: how do orchestrators and agents agree on filter vocabulary? Could be a doc convention, a registry, or runtime negotiation. Worth scoping before plan 013. | Shared registry of message types? Discoverable filter via state? `outside.md` enumerates types? Doctor warns on filter divergence? Default open filter? |
| 4 | **Reverse-tail of `events.ndjson` as a reusable primitive** | Storage Design | Plan 012 needs bounded reverse-line reading. Other consumers (status, doctor, future debug tools) could benefit. Worth designing the small utility once with edge cases (torn last line, rotation, resume markers, empty file) so it's reusable. | Where does it live (runner vs shared utility)? Buffer size? File-rotation behaviour? Type filter at read or post-read? Stream vs collect? |
| 5 | **Inside-side reverse peer visibility** | API Contract | Workshop 001 Q6 is deferred but flagged as "probably useful for symmetry". Worth a small workshop to scope the v2 design now so plan 012's surface doesn't accidentally close that door. | Peer block in `inbox_list` MCP response? Outside-side telemetry available to inside agent? Same verdict vocabulary or different? Cost? |

**Recommendation**: Workshop **#1 (verdict state machine)** is the highest-leverage — it directly affects implementation correctness and test design for plan 012. The others are adjacent and can be deferred. **#3 (filter vocabulary)** is the most strategically important but is a separate plan candidate (plan 013-ish), not a blocker for 012.

> **Status update (2026-04-29 clarify)**: Workshop #1 created as [`workshops/001-verdict-derivation-rules.md`](workshops/001-verdict-derivation-rules.md) — reframed as a **decision table** (not a state machine) per "minih is the messenger, not the police". Workshops #2-#5 remain deferred.

---

## Clarifications

### Session 2026-04-29

**Q1 — Workflow Mode**: **Simple**.
Rationale: CS-2, single phase, ~6-8 tasks, workshop locks the heart of the design. Full Mode would impose more gates than the work warrants.
*Spec impact*: Added `**Mode**: Simple` header.

**Q2 — Testing Strategy**: **Hybrid** — TDD for `derivePeerVerdict` and the reverse-tail; Lightweight for CLI envelope wiring.
Rationale: Verdict rules are pure logic with explicit precedence (12-row test matrix in workshop 001 begs for TDD). Envelope wiring is mechanical; integration tests per command suffice.
*Spec impact*: Added `## Testing Strategy` section.

**Q3 — Mock Policy**: **Avoid mocks** — fixture `.ndjson` files + tmpdir.
Rationale: Pure derivation needs no mocks; outer fs reads mirror existing minih test patterns (`state.test.ts`, `run-manifest.test.ts`, `inbox-poll.test.ts`).
*Spec impact*: Captured in Testing Strategy.

**Q4 — Documentation Strategy**: **Hybrid** — short § in `AGENTS_README.md`, scaffolded note via `minih init`, brief operator-side § in shared preamble.
Rationale: Plan 011 set the precedent of a light three-surface teaching footprint for new operator-facing concepts. `peer.verdict` warrants the same.
*Spec impact*: Added `## Documentation Strategy` section.

**Q5 — Domain Review**: **Confirmed as-is** — `runner` (modify), `cli` (modify), `mcp` (consume), `adapter` (consume); no new domain; no contract-breaking changes.
*Spec impact*: No change to Target Domains table.

**Q6 — Companion-prompt vocabulary fix scope**: **Phase 0 hotfix as T000** in this plan.
Rationale: One-line edit to `agents/code-review-companion/outside.md` (or wherever its `waitForAny` filter is sourced) to widen the filter to include `briefing` + `review-request`. Validates the `verdict` end-to-end during plan 012 implementation. The systemic filter-vocabulary contract is workshop opp #3 (separate future plan).
*Spec impact*: Added implicit T000 to phase plan; updated Goals to acknowledge.

**Q7 — `currentlyRunningTool` field in v1**: **Yes**.
Rationale: ~5 LOC of derivation; valuable hint for explaining `silent` verdicts ("agent is in a `bash` call"). Workshop 001 §F4 RESOLVED.
*Spec impact*: AC-01 updated to include `currentlyRunningTool` in the minimum peer block.

**Q8 — `deaf` reason hint about which types WOULD work**: **Yes**.
Rationale: Append `"— try one of: [filter types]"` to the deaf reason (workshop 001 Q6 OPEN → RESOLVED). Trivial cost, high actionability for operators.
*Spec impact*: AC-02 updated to require the `try one of:` hint in the reason string.

**Q9 — Threshold tunability** (Q8 was actually 9th in flow but counted as "8 total" since they were batched logically): **Defaults only — no flag exposure in v1**.
Rationale: silent=5min, dead=30min, newRunGracePeriod=60s as fixed defaults inside `derivePeerVerdict`. Tune later if data warrants.
*Spec impact*: Risks updated; AC-12 simplified (no threshold flags).

---

**Next**: Run **`/plan-2-v2-clarify`** to resolve the 6 Open Questions above (≤8 questions), then `/plan-3-v2-architect` to produce the implementation plan.
