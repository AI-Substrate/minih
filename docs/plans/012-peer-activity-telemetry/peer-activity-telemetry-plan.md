# Peer Activity Telemetry Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-29
**Spec**: [`peer-activity-telemetry-spec.md`](./peer-activity-telemetry-spec.md)
**Workshop**: [`workshops/001-verdict-derivation-rules.md`](./workshops/001-verdict-derivation-rules.md)
**Research**: [`research-dossier.md`](./research-dossier.md)
**Status**: DRAFT

## Summary

Add a derived **`peer` block** (with single-word `verdict`) to every transactional outside-lane CLI envelope so orchestrators see ground-truth peer activity at send-time instead of finding out via 30-minute timeout. The verdict is computed by a pure function (`derivePeerVerdict`) reading the agent's `events.ndjson` tool-call telemetry, `state/inside.json`, and `run.json`. minih observes; minih never enforces. Includes a Phase 0 hotfix to widen the `code-review-companion`'s `waitForAny` filter (the agent that bit plan 011), which validates the verdict end-to-end. Single phase, ~7 tasks, CS-2.

## Target Domains

| Domain | Status | Relationship | Role |
|---|---|---|---|
| `runner` | existing | **modify** | Add `src/runner/peer-activity.ts` (pure-function derivation primitive); export from `src/runner/index.ts` |
| `cli` | existing | **modify** | Inject `peer` block into 5 outside-lane envelope sites; render verdict on stderr in TTY mode; add `--strict-peer` flag; surface deaf agents in `minih doctor` |
| `mcp` | existing | **consume** | No code changes — coordinated tool names (`minih-coordination-*`) observed indirectly via recorded events |
| `adapter` | existing | **consume** | No code changes — `tool_call` event shape (`src/adapter/events.ts:107-114`) is the read-side contract |

No new domains. No contract-breaking changes. `peer` block is purely additive on existing envelopes.

## Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `src/runner/peer-activity.ts` | runner | contract (re-exported) | New primitive — pure verdict + I/O wrapper |
| `src/runner/index.ts` | runner | internal | Re-export `derivePeerActivity`, types, verdict union |
| `src/cli/commands/outside.ts` | cli | internal | 5 envelope inserts + TTY verdict line per command + `--strict-peer` flag |
| `src/cli/commands/doctor.ts` | cli | internal | `auditPeerActivity()` section listing deaf/silent active runs |
| `agents/code-review-companion/prompt.md` | — (agent asset) | cross-domain | Phase 0 hotfix: widen `waitForAny` to include `briefing` + `review-request` |
| `agents/_shared/preamble.md` | — (agent asset) | cross-domain | Append "For Operators" line about reading `peer.verdict` |
| `src/templates/shared-preamble.md` | runner | internal | Mirror of `agents/_shared/preamble.md` (build copies to dist/templates) |
| `AGENTS_README.md` | — (root doc) | cross-domain | New `## Coordination Visibility` section |
| `docs/domains/runner/domain.md` | runner | contract | History row: peer-activity.ts primitive |
| `docs/domains/cli/domain.md` | cli | contract | History row: peer envelope field + `--strict-peer` flag + doctor audit |
| `test/runner/peer-activity.test.ts` | runner | internal | TDD verdict ladder (12+ matrix) + reverse-tail edge cases |
| `test/cli/outside-peer.test.ts` | cli | internal | Integration tests for envelope shape across 5 commands |
| `test/cli/doctor-peer.test.ts` | cli | internal | Doctor audit emits deaf/silent rows; healthy quiet |
| `docs/plans/012-peer-activity-telemetry/peer-activity-telemetry-plan.md` | — (plan meta) | cross-domain | T006 closeout — flip task statuses to [x] |
| `docs/plans/012-peer-activity-telemetry/prompts/option-c/runs/001-power-on.md` | — (plan meta) | cross-domain | T006 closeout — Power On Mode run-file with retro |

## Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | Workshop's event shape is byte-for-byte verified against a real coordinated run; `data.input.waitForAny` and `data.input.waitMs` are present where promised | Use workshop contract directly; no translation layer (research-dossier IA-01) |
| 02 | High | All five target commands live in **one file** (`src/cli/commands/outside.ts`); each has a single `formatSuccess(...)` site + a single `process.stderr.isTTY` block | Mechanical 5x parallel inserts; no architectural risk (research-dossier DE-06) |
| 03 | High | No bounded reverse-tail reader for `events.ndjson` exists yet; `tail.ts` is streaming-UX, `status.ts` reads forward, `inbox-poll.ts` is lane-oriented | Add ~30 LOC reverse-tail helper inside `peer-activity.ts` (research-dossier DC-03) |
| 04 | High | `runner.ts` records SDK's verbatim tool name; for inside MCP that IS `minih-coordination-*` (verified). Filter MUST use prefixed names, not normalized MCP registry names | Filter literal: `minih-coordination-{inbox_list, inbox_send, inbox_ack, state_*}` (research-dossier IA-02) |
| 05 | High | Companion's filter (`agents/code-review-companion/prompt.md:41,161`) excludes `briefing` + `review-request` — this is the bug that motivated the whole feature; widening it validates the verdict end-to-end | Phase 0 task T000 (companion-prompt edit) |
| 06 | Medium | Existing CLI tests assert specific envelope fields, not whole-envelope strict equality; additive `peer` block is safe | New tests assert on `peer.verdict` only; existing tests untouched (research-dossier IC-04) |
| 07 | Medium | `LiveRunManifest.status` enum includes `idle` as a HEALTHY value (not dead) | Verdict rule 3 deliberately excludes `idle` from the `dead` list (workshop Q2 RESOLVED) |
| 08 | Medium | Resume-in-place prepends a synthetic `{type:'resume',...}` event line; reverse-tail must filter for `type === 'tool_call'` | Test fixture covers this; reader filters explicitly (workshop PL-04) |

## Implementation

**Objective**: Surface ground-truth peer activity in outside-lane envelopes so deafness, silence, and death are visible at send-time, with a single-word `verdict` as the contract.

**Testing Approach**: **Hybrid** (per spec § Testing Strategy)
- TDD for `derivePeerVerdict` (12-row matrix from workshop), `computeWillMatch` (defensive cases), reverse-tail (edge cases)
- Lightweight integration tests for CLI envelope wiring (one test asserts envelope shape per command; doctor audit has 3 tests covering deaf/silent/quiet)
- No mocks — real `.ndjson` fixtures in tmpdir, mirroring `state.test.ts` / `run-manifest.test.ts` / `inbox-poll.test.ts` patterns
- All work must pass `just fft` (lint → format → build → typecheck → test → audit) before commit boundaries

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T000 | Widen `code-review-companion` `waitForAny` filter to include `briefing` + `review-request` | — | `/Users/jordanknight/substrate/minih/agents/code-review-companion/prompt.md` (lines 41 + 161) | Both filter occurrences include the two new types; `just fft` green | Phase 0 hotfix per spec Q6. One-line edit in two places. **Behavioural validation is deferred to T006 closeout** (a real Power On Mode run in plan-6 will exercise the widened filter end-to-end). Per finding 05. |
| [x] | T001 | `derivePeerVerdict` pure verdict ladder + types + 12-row TDD matrix | runner | `/Users/jordanknight/substrate/minih/src/runner/peer-activity.ts` (verdict logic + type exports only)<br>`/Users/jordanknight/substrate/minih/test/runner/peer-activity.test.ts` (verdict-only suite) | Module exports `derivePeerVerdict(inputs) → {verdict, reason}`, `PeerVerdict` union (7 values), `DerivePeerInputs` type, `PeerActivity` type. Verdict ladder follows workshop 001 § Decision Ladder rule-for-rule (10 rules, first-match-wins). `computeWillMatch` treats null/empty filter as open. Workshop's 12-row test matrix covered including precedence boundaries (silent over deaf, dead over silent). Pure function — no I/O, no mutation. `just fft` green. | TDD per spec. Workshop 001 § Test Matrix is the reference. The pure-function / I/O split is the workshop's own design (workshop §"The Function" lines 264-290). Per findings 01, 04, 07. |
| [x] | T002 | `derivePeerActivity` I/O wrapper + reverse-tail helper + fixture-driven edge-case tests | runner | `/Users/jordanknight/substrate/minih/src/runner/peer-activity.ts` (extend with I/O wrapper)<br>`/Users/jordanknight/substrate/minih/src/runner/index.ts` (re-exports)<br>`/Users/jordanknight/substrate/minih/test/runner/peer-activity.test.ts` (extend with I/O tests) | Module exports `derivePeerActivity({runDir, messageType, now, tailLines}) → PeerActivity`. Reads at most `tailLines` lines (default 1000) from `<runDir>/events.ndjson` via bounded reverse-tail helper. Filters `type === 'tool_call'`, ignores `resume`/`session_start` events. Reads `state/inside.json` and `run.json` via existing `readStateLazy` / `readManifest` helpers. Assembles `DerivePeerInputs` and delegates verdict to T001's pure function. `currentlyRunningTool` populated from latest non-coordination tool_call. Re-exports added to `src/runner/index.ts`. Reverse-tail tolerates: torn last line, empty file, missing file (returns `verdict: 'unknown'` for read failure), file containing only non-tool_call events. Fixture `.ndjson` files in tmpdir. `just fft` green. | TDD. Per findings 01, 03, 08. Reverse-tail helper ~30 LOC inside this module (no external utility). Edge cases per spec AC-14 + workshop §F1-F8. |
| [x] | T003 | Wire `outside inbox send` + `--strict-peer` flag + integration test | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/outside.ts`<br>`/Users/jordanknight/substrate/minih/test/cli/outside-peer.test.ts` | `formatSuccess(...)` at `outside.ts:191-200` includes `peer` field derived from runDir + `messageType: --type`. TTY block at `outside.ts:185-189` renders verdict + reason on stderr (only when `process.stderr.isTTY`). New `--strict-peer` flag (commander.option) added; when verdict is `deaf` and flag set, exits with `E160 DEAF_PEER` (next free slot — verify against existing codes). Integration test fixtures: deaf scenario, listening scenario, silent scenario, n/a scenario (non-coordinated agent). Plus one `--strict-peer` exit-code test. **Import direction: `cli → runner` only (no runner→cli coupling).** `just fft` green. | Per finding 02. Pattern reused for T004. Reason string format per spec AC-02 (includes `try one of:` hint). |
| [x] | T004 | Wire remaining 4 outside commands (list --wait, state set, state transition, retro add) + integration tests | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/outside.ts`<br>`/Users/jordanknight/substrate/minih/test/cli/outside-peer.test.ts` | Each command's success envelope and TTY block extended in parallel with T003's pattern. `outside inbox list --wait` derives peer at envelope-construction time (not call entry — see spec Risks). `state set` / `state transition` use `messageType: null` so verdict is purely behavioural (no type-match check). `retro add` uses the message type from the call. Integration tests assert `peer.verdict` shape for each command (4 minimum, can share fixtures). **Import direction: `cli → runner` only.** `just fft` green. | Per finding 02. `messageType: null` path tested in T001 (rule 9 fires; rule 8 skipped). |
| [x] | T005 | `minih doctor` peer-activity audit + tests | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts`<br>`/Users/jordanknight/substrate/minih/test/cli/doctor-peer.test.ts` | New `auditPeerActivity()` function alongside `auditRetroLedger()` (plan 011 pattern). Walks `agents/*/runs/*/` for active runs (`run.json.status === 'active'` or `idle` AND no `completed.json`). For each, calls `derivePeerActivity` with `messageType: null`. Surfaces rows for `verdict ∈ {deaf, silent}` with thresholds silent=5min/dead=30min from defaults; healthy runs not noised. Envelope adds `peer[]` array with `{slug, runId, verdict, reason, lastPollAt}`. TTY emits a section "🔇 Coordination peer activity" with rows or "✓ N active coordinated runs healthy". 3 tests: deaf-active-run surfaces, silent-active-run surfaces (past 5min), healthy-runs-quiet. `just fft` green. | Per spec AC-12. Thresholds locked per spec Q9. |
| [x] | T006 | Documentation + domain history rows | — / runner / cli | `/Users/jordanknight/substrate/minih/AGENTS_README.md`<br>`/Users/jordanknight/substrate/minih/agents/_shared/preamble.md`<br>`/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md`<br>`/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md`<br>`/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | (a) AGENTS_README new `## Coordination visibility` § (~10 lines): explains `peer.verdict`, the 7 values, that minih observes-not-enforces, link to workshop 001. (b) Both shared-preamble files: append a 2-line note in the existing `## For Operators` § about reading `peer.verdict` after sends. (c) Domain history rows in `runner/domain.md` (peer-activity.ts) and `cli/domain.md` (envelope `peer` field + `--strict-peer` + doctor audit). `just fft` green. | Per spec § Documentation Strategy (Hybrid: README + scaffolded + preamble §). Plan 011 set the precedent. |
| [x] | T007 | Closeout: `just fft` final, mark plan complete, run-file under prompts/ | — | `/Users/jordanknight/substrate/minih/docs/plans/012-peer-activity-telemetry/peer-activity-telemetry-plan.md`<br>`/Users/jordanknight/substrate/minih/docs/plans/012-peer-activity-telemetry/prompts/option-c/runs/001-power-on.md` (or similar) | All task statuses flipped to [x] in this plan file. `just fft` produces all-green output (paste summary into closeout note). Run-file captures Power On Mode retrospective + magicWand + difficulties. Verify T000 hotfix takes effect: a fresh companion run during plan-6 should produce `peer.verdict ∈ {listening, between-polls}` for `briefing` and `review-request` types, NOT `deaf`. | Pattern from plan 011 closeout. Power On Mode prompt to be regenerated for this plan. |

### Acceptance Criteria

(All 14 from spec; checking ones already covered by tasks)

- [ ] AC-01 — Envelope contains `peer` block on `outside inbox send` (T003)
- [ ] AC-02 — Verdict is `deaf` when filter excludes type, with `try one of:` hint (T001 + T003)
- [ ] AC-03 — Verdict is `listening` when polling AND filter matches (T001)
- [ ] AC-04 — Verdict is `between-polls` when filter matches AND cadence is recent (T001)
- [ ] AC-05 — Verdict is `silent` when no `inbox_list` for >5min (T001)
- [ ] AC-06 — Verdict is `dead` when run.json status is completed/failed/stale OR last poll >30min (T001)
- [ ] AC-07 — Verdict is `n/a` for non-coordinated agents (T002 + T003 fixture)
- [ ] AC-08 — `peer` block is additive (verified by T003/T004 — existing tests still pass)
- [ ] AC-09 — TTY mode renders verdict on stderr; piped mode does not (T003 + T004 use `process.stderr.isTTY`)
- [ ] AC-10 — `--strict-peer` flag exits non-zero on `deaf` (T003)
- [ ] AC-11 — `peer` block on every transactional outside command (T003 + T004)
- [ ] AC-12 — `minih doctor` lists deaf/silent active runs; healthy quiet (T005)
- [ ] AC-13 — `derivePeerActivity` is pure-function with bounded cost (T002)
- [ ] AC-14 — Reverse-tail tolerates torn / empty / missing files (T002)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `outside inbox list --wait` returns stale `peer` block (derived at call entry, not at poll resolution) | Medium | Medium | T003 done-when explicitly says "derive at envelope-construction time, not call entry"; integration test confirms the `lastPollAt` returned reflects post-poll state |
| Verdict precedence wrong (e.g. `deaf` fires instead of `silent` for long-idle agent) | Low | High | Workshop 001 § Decision Ladder is the canonical order; T001's TDD matrix tests every precedence boundary including row 11 ("silent over deaf when long-idle") |
| `--strict-peer` exit-code conflicts with existing `EXXX` slot | Low | Low | T002 done-when says "verify against existing codes"; minih has documented error codes — pick next free (E160 likely; check src/cli/exit-codes.ts or equivalent) |
| Companion-prompt hotfix breaks existing companion behaviour | Low | Medium | T000 only ADDS types to `waitForAny`; existing types remain. Existing companion-run reproductions should be unaffected |
| Reverse-tail performance on huge events.ndjson (>10MB long-running runs) | Low | Low | 1000-line bound from end of file; chunked reverse read. Profile during T001 if anything looks suspicious. Workshop Q3 says don't cache yet |
| LLM orchestrators ignore `peer.verdict` because it's a new field | Medium | Low | AGENTS_README + preamble § (T005) teach the field. `--strict-peer` available for protocols that want to enforce |

### Notes for `/plan-6`

- **Commit boundaries**: T000 → T001 → T002 → T003 → T004 → T005 → T006 → T007. Each commit must pass `just fft`. T001 (pure verdict) and T002 (I/O + reverse-tail) split the previously-bundled primitive into two natural commits per workshop §"The Function".
- **Power On Mode protocol**: Reuse `docs/plans/011-retro-harvest-loop/prompts/option-c/plan-6-plan011-option-c.md` as the template; adjust slug references, briefing message, and the type vocabulary you tell the companion to listen for. Companion's filter will be widened by T000 BEFORE you start, so the silent-failure mode from plan 011 cannot recur.
- **Validate end-to-end at the end**: After T005, manually run a fresh `outside inbox send` against a coordinated run and confirm the `peer` block looks right; visually verify `verdict: 'deaf'` reason includes `try one of:` hint.
- **Workshop 001 is the implementation reference for verdict logic.** Keep it open during T001.

---

**Plan ready for `/plan-6-v2-implement-phase`** (Simple Mode skips plan-4/plan-5 expansion).

Optional: Run `/plan-4-v2-complete-the-plan` for a readiness gate before implementation if desired.

---

## Validation Record

### `/plan-4-v2-complete-the-plan` — 2026-04-29

| Validator | Status | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| Structure | ISSUES → FIXED | 1 → 0 | 0 | 0 |
| Testing Alignment | PASS | 0 | 0 | 1 → 0 |
| Domain Completeness | ISSUES → FIXED | 1 → 0 | 0 | 0 |
| Doctrine | N/A | — | — | — |
| ADR | N/A | — | — | — |

**Findings & Fixes** (all applied inline):
- HIGH (Structure + Domain) — Domain Manifest missing T006 closeout paths (`peer-activity-telemetry-plan.md` self + `prompts/option-c/runs/001-power-on.md`). **Fix**: Added both as `cross-domain (plan meta)` rows in the Domain Manifest.
- LOW (Testing) — T000 done-when implied behavioural validation. **Fix**: Reworded T000 to describe a prompt-only edit; behavioural validation explicitly deferred to T006 closeout via real Power On Mode run.

**Verdict**: **READY** for implementation.

---

### `validate-v2` — 2026-04-29 (3 parallel agents)

| Agent | Lenses Covered | Issues | Verdict |
|---|---|---|---|
| Source-Truth | Factual Accuracy, Concept Documentation, Hidden Assumptions | 0 | ✅ |
| Forward-Compat | Forward-Compatibility, Integration & Ripple, Technical Constraints, Deployment & Ops | 0 | ✅ |
| Coherence-CS-Risk | System Behavior, Edge Cases, Hidden Assumptions, Performance, Domain Boundaries | 1 HIGH fixed, 2 MEDIUM open, 2 LOW open | ⚠️ → ✅ |

**Lens coverage**: 12/12 (full). Forward-Compatibility engaged (5 downstream consumers named in Vector).

#### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| plan-6 implementation | unambiguous task table | encapsulation lockout | ✅ | T000–T007 with paths + done-when + AC map |
| Power On Mode T007 run | T000 fixes deafness before run | contract drift | ✅ | T000 widens both `waitForAny` occurrences in `agents/code-review-companion/prompt.md:41,161` |
| Future plan 013 (filter-vocabulary) | stable verdict enum + reason format | shape mismatch | ✅ | 7-value enum locked in spec/workshop; plan mirrors |
| Future doctor consumers / scripts | stable `peer[]` shape | shape mismatch | ✅ | T005 locks rows to `{slug, runId, verdict, reason, lastPollAt}` |
| LLM orchestrators | same `verdict` enum across all 5 commands | contract drift | ✅ | T003 + T004 apply uniformly |

**Outcome alignment**: *"Catch deafness at send-time, not at timeout."* — Yes, this artifact as shipped advances it.

**Standalone?**: No — five downstream consumers named with concrete needs.

**Fixes applied (HIGH)**:
- HIGH (T001 too bundled) — Split into T001 (pure verdict ladder + 12-row matrix) and T002 (I/O wrapper + reverse-tail + fixture-driven edge-case tests). Aligns with workshop §"The Function" pure/I-O split. Renumbered T002→T003 etc. and updated AC mappings.

**Open (MEDIUM/LOW — present to user for decision before implementation)**:
- MEDIUM (Edge Cases) — Risks table missing: resume-in-place run-dir aliasing, append-during-reverse-tail race, filter-vocabulary drift between `lastPollFilter` and agent code.
- MEDIUM (Performance) — Doctor's O(runs) scan cost not acknowledged; large fleets (50 agents × 10 runs) = 500 reverse-tail reads.
- LOW (Edge Cases) — F8 "poll window closes between read and send" race not explicitly tested in T003.
- LOW (System Behavior) — T003/T004 import direction `cli → runner` now stated in done-when (LOW already addressed inline).

**Overall**: ⚠️ → ✅ **VALIDATED WITH FIXES** — ready for `/plan-6-v2-implement-phase` once user reviews open MEDIUMs.
