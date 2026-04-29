# Message Reply Chains Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-29
**Spec**: [message-reply-chains-spec.md](./message-reply-chains-spec.md)
**Dossier**: [research-dossier.md](./research-dossier.md)
**Status**: DRAFT

## Summary

Promote the existing `ackOf` field from "ack-only correlation" to "general parent pointer" so agents (and outside operators) can reply to a specific inbox message regardless of `type`. The data model, JSON schema, JSONL on-disk format, and MCP `inbox_send` tool already accept `ackOf` for any type — only the outside CLI gate, the forwarder render label, and the agent-facing documentation need to change. Chains form naturally because each reply's id is itself a valid parent for the next reply. Zero schema changes, zero on-disk changes, fully backward compatible.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | **modify** | Switch inbox-forwarder render label from "Acknowledges:" to "In reply to:" for non-ack messages; add reply-chain teaching to shared preamble. |
| cli | existing | **modify** | Remove the `outside inbox send` gate that rejects `--ack-of` for non-ack types. Keep the inverse check (`--type ack` requires `--ack-of`). |
| mcp | existing | **modify** | Rewrite the `inbox_send` tool description in `mcp/types.ts` so agents reading the tool list discover the field is for general replies. |

No new domain. No new contract. No domain registry changes. Domain map unchanged.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside.ts` | cli | internal | Gate removal at lines 209-216. |
| `/Users/jordanknight/substrate/minih/src/runner/inbox-forwarder.ts` | runner | internal | Render label switch in `renderInboxMessageForAgent`. |
| `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` | runner | internal | Add reply-chain teaching paragraph. |
| `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md` | runner (dogfood) | internal | Mirror preamble change. |
| `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md` | runner (template) | internal | Mirror preamble change (shipped template). |
| `/Users/jordanknight/substrate/minih/src/mcp/types.ts` | mcp | contract | Rewrite `inbox_send` tool description (text-only, no schema change). |
| `/Users/jordanknight/substrate/minih/AGENTS_README.md` | docs | internal | Add `### Reply chains` subsection. |
| `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | runner | internal | History row. |
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | cli | internal | History row. |
| `/Users/jordanknight/substrate/minih/docs/domains/mcp/domain.md` | mcp | internal | History row. |
| `/Users/jordanknight/substrate/minih/test/cli/outside-inbox-send.test.ts` (or equivalent) | cli (test) | internal | Flip negative test → positive test for non-ack `ackOf`. |
| `/Users/jordanknight/substrate/minih/test/runner/inbox-forwarder.test.ts` | runner (test) | internal | Add label-switch tests. |
| `/Users/jordanknight/substrate/minih/test/mcp/server.test.ts` (or `tools/inbox.test.ts`) | mcp (test) | internal | Add positive test for `inbox_send` with non-ack `ackOf` round-trip. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | High | `ackOf` infrastructure is already complete end-to-end (schema, types, MCP handler, JSONL store, forwarder, human-view, peer-activity). Only the outside CLI gate and the forwarder label and the docs are missing. (Dossier IA-01.) | Reuse everything. Don't rebuild. |
| 02 | High | The outside CLI gate at `outside.ts:209-216` is the **single blocker** for general replies on the outside lane. (Dossier IA-02.) | Remove only the `type !== 'ack' && opts.ackOf` rejection; keep the inverse `type === 'ack' && !ackOf` requirement. |
| 03 | Medium | MCP-side already supports `ackOf` for any type — inside agents can chain today but are never told. (Dossier IA-03.) | Teach via preamble + AGENTS_README. No code change needed for inside lane. |
| 04 | Medium | `unread` filter and `peer-activity.lastAckOf` are intentionally ack-only — they measure peer-health acknowledgements, not generic replies. (Dossier IA-07, IA-10.) | DO NOT touch these. AC #11 + #12 lock the no-regression behaviour. |
| 05 | Medium | Snapshot-style tests asserting the literal string "Acknowledges:" may break under the label switch. (Dossier DC-01.) | Grep `Acknowledges:` in `test/`; update affected snapshots. |
| 06 | Low | "messenger not police" philosophy (Plan 012 PL-01) → don't validate `ackOf` referent existence. The schema already enforces ULID shape; that's enough. | No referent validation. Stale ids are the agent's bug to surface. |
| 07 | Low | Plan 012's F002 (`msgId` vs `messageId`) lesson: multiple adjacent id fields invite typo bugs. | During implementation, double-check field names: `id`, `msgId`, `ackOf` are all distinct. |

## Harness Strategy

Existing minih harness (npm-scripts based; `just fft` quality gate). Sufficient for this plan. No harness work required. Per-phase validation = `just fft` plus the target test files added/updated in this plan.

## Implementation

**Objective**: Unlock `ackOf` for any-typed messages on the outside lane, switch the forwarder label, and teach agents the capability — without changing schemas, on-disk formats, or peer-activity semantics.

**Testing Approach**: Lightweight (per spec).
- Real `FakeAgentAdapter` and tmpdir fixtures, no mocks.
- Positive integration test for the unblocked CLI path.
- Unit tests for the render label switch.
- Round-trip MCP test for non-ack `ackOf`.
- Grep-based regression sweep to catch snapshot drift.
- `just fft` is the gate.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Remove the outside-CLI `ackOf` gate for non-ack types. Delete the `if (type !== 'ack' && opts.ackOf)` rejection block; keep `if (type === 'ack' && !opts.ackOf)`. Verify the existing build of the outgoing message struct still spreads `ackOf` correctly. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/outside.ts` | `outside inbox send <slug> --type note --ack-of <id> --subject ... --body ...` succeeds and the appended JSONL line contains `"ackOf":"<id>"`. The `--type ack` without `--ack-of` path still errors via `invalidArgs`. | Per finding 02. |
| [x] | T002 | Update the inbox-forwarder render label. In `renderInboxMessageForAgent`, when `message.ackOf` is set, push `In reply to: <id>` if `message.type !== 'ack'`, otherwise push `Acknowledges: <id>` (preserving today's ack rendering). | runner | `/Users/jordanknight/substrate/minih/src/runner/inbox-forwarder.ts` | Render output shows `In reply to: <id>` for `{ type: 'note', ackOf: <id> }` and `Acknowledges: <id>` for `{ type: 'ack', ackOf: <id> }`. | AC #5 + #6. |
| [x] | T003 | Sweep snapshot/regression tests for the literal string `Acknowledges:` and update any affected fixtures or assertions to reflect the new conditional rendering. | runner (test) | `/Users/jordanknight/substrate/minih/test/` (grep -rn) | `grep -rn "Acknowledges:" test/` returns zero unintentional matches; only intentional ack-typed assertions remain. | Per finding 05. |
| [x] | T004 | Rewrite the `inbox_send` tool description in `mcp/types.ts`. Replace `'Optional inbox message id this reply acknowledges (drives Phase 2 workbench correlation).'` with `'Optional id of the message this is a reply to. Used to form reply chains; renders as "In reply to:" in the next agent's prompt. For acknowledgement specifically, prefer inbox_ack.'`. No schema change. | mcp | `/Users/jordanknight/substrate/minih/src/mcp/types.ts` (~line 233-239) | Description string updated; `inbox_send` schema unchanged otherwise; `npm run build` passes. | AC #9. |
| [x] | T005 | Add reply-chain teaching to the shared preamble. Insert a one-paragraph callout under the existing inbox tool list explaining: any `inbox_send` may set `ackOf` to a prior message id to make the new message a reply; replies can themselves be replied to, forming chains; `inbox_ack` is the right tool for "I have processed this message." Mirror the change in **all three** preamble copies. | runner | `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` AND `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md` AND `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md` | All three files contain matching reply-chain language. (Project convention: preamble.md and shared-preamble.md must stay in sync.) | AC #7. |
| [x] | T006 | Add `### Reply chains` subsection to AGENTS_README.md under the existing `## Coordination` area. Include a 3-message worked example (outside → inside reply → outside reply-to-the-reply) showing how the chain forms via `ackOf` only. | docs | `/Users/jordanknight/substrate/minih/AGENTS_README.md` | New subsection present near line ~442 (existing Coordination area); worked example renders cleanly in markdown. | AC #8. |
| [x] | T007 | Write the positive integration test AND the negative-path assertion: (a) `outside inbox send --type note --ack-of <id>` succeeds and the inbox JSONL contains `ackOf` populated; (b) `outside inbox send --type ack` without `--ack-of` errors with `invalidArgs`; (c) `outside inbox send --type ack --ack-of <id>` still succeeds. Add as new test cases inside `test/cli/outside-peer.test.ts` (existing home for outside CLI tests) — do NOT create a new file. | cli (test) | `/Users/jordanknight/substrate/minih/test/cli/outside-peer.test.ts` | All three test cases pass locally with `npx vitest run test/cli/outside-peer.test.ts`; covers AC #1, AC #2, AC #3. | Per spec Testing Strategy. AC-2 was not previously covered (no `--ack-of` tests existed). |
| [x] | T008 | Write the renderer test: assert `renderInboxMessageForAgent` produces `In reply to: <id>` for non-ack `ackOf` and `Acknowledges: <id>` for ack-typed `ackOf`. Place beside existing forwarder tests. | runner (test) | `/Users/jordanknight/substrate/minih/test/runner/inbox-forwarder.test.ts` | Two assertions pass; AC #5 + #6 covered. | |
| [x] | T009 | Write the MCP round-trip test: `inbox_send({ type: 'note', subject, body, ackOf: <id> })` succeeds and the read-back message has `ackOf` set. Place in the existing inbox/server test file. | mcp (test) | `/Users/jordanknight/substrate/minih/test/mcp/` | Test passes; AC #4 covered. | |
| [x] | T010 | Verify no-regression behaviours: (a) `inbox_ack` still idempotent (existing test), (b) `unread` filter still ack-only (existing test in `test/runner/inbox-poll.test.ts`), (c) `peer-activity.lastAckOf` still ack-only (existing test in `test/runner/peer-activity.test.ts`), (d) JSONL round-trip of pre-existing fixture messages still works. Run full suite with `npm test`. | all | (test runs) | All tests green; no regressions; ACs #10, #11, #12, #13 covered. AC-2 + AC-3 covered by T007. | Per finding 04. |
| [x] | T011 | Append history rows to the three domain.md files referencing plan 013. One-line summary per file per `## Composition`/`## History` convention. | runner / cli / mcp | `/Users/jordanknight/substrate/minih/docs/domains/{runner,cli,mcp}/domain.md` | All three domain.md files have a 013-message-reply-chains row in their History table. | AC #15. |
| [x] | T012 | Run `just fft` and confirm green. Fix any lint/format/typecheck/audit findings as ours, no deferrals. | all | repo root | `just fft` passes end-to-end. | AC #14. Project rule: own every finding. |

### Acceptance Criteria

Direct mapping from spec § Acceptance Criteria:

- [x] AC-1: `outside inbox send --type note --ack-of <id>` succeeds; stored message has `ackOf=<id>` (T001, T007)
- [x] AC-2: `outside inbox send --type ack` without `--ack-of` still fails (T007)
- [x] AC-3: `outside inbox send --type ack --ack-of <id>` continues to succeed (T007)
- [x] AC-4: Inside agent `inbox_send({ type: 'note', ackOf: <id> })` produces stored message with `ackOf` set (T009)
- [x] AC-5: Forwarder renders `In reply to: <id>` for non-ack message with `ackOf` (T002, T008)
- [x] AC-6: Forwarder renders `Acknowledges: <id>` for ack-typed message with `ackOf` (T002, T008)
- [x] AC-7: Shared preamble (all three copies) teaches reply chains (T005)
- [x] AC-8: `AGENTS_README.md` documents reply chains with worked example (T006)
- [x] AC-9: `inbox_send` MCP tool description rewritten (T004)
- [x] AC-10: `inbox_ack` continues to behave as before (T010)
- [x] AC-11: `peer-activity.lastAckOf` still ack-only (T010)
- [x] AC-12: `unread` filter still ack-only (T010)
- [x] AC-13: Pre-existing inbox JSONL files load and render correctly (T010 — covered by existing fixture tests)
- [x] AC-14: `just fft` passes (T012)
- [x] AC-15: Domain history rows added (T011)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Snapshot tests assert literal `Acknowledges:` and silently break | Medium | Low | T003 explicit grep sweep; T012 `just fft` is the safety net. |
| Three preamble files drift out of sync | Low | Medium | T005 explicitly lists all three; companion review pings should catch drift via plan 012's § 6a clause. |
| Field-name typo (`ackOf` vs `messageId` vs `msgId`) introduced during edits | Low | Medium | Per finding 07; double-check at T001/T002/T004; companion review. |
| `inbox_send` description change inadvertently changes the schema (e.g. via accidental `additionalProperties` flip) | Very low | High | T004 is text-only; verify with `git diff` showing only string change before commit. |
| Agents over-use `ackOf` for chitchat, polluting the chain visualisation | Low | Low | Out of scope. Messenger not police (finding 06). |

### Implementation Order Notes

T001-T006 are largely independent and can be done in any order. Tests T007-T010 should follow their corresponding source changes (TDD-friendly but not strictly required for Lightweight strategy). T011 and T012 are end-of-phase. **Suggested order**: T001 → T007 (positive CLI test) → T002 → T008 (renderer test) → T003 (snapshot sweep) → T004 → T009 (MCP round-trip) → T005 → T006 → T010 (regression sweep) → T011 → T012 (fft gate).

---

**Validation Record**

### plan-4-v2-complete-the-plan — 2026-04-29

| Validator | Status | HIGH | MED | LOW |
|---|---|---|---|---|
| Structure | PASS | 0 | 0 | 0 |
| Testing Alignment | FIXED | 0 (was 1) | 0 (was 1) | 0 |
| Domain Completeness | PASS | 0 | 0 | 0 |
| Doctrine | PASS | 0 | 0 | 0 |
| ADR | N/A | — | — | — |

**HIGH (fixed)**: T010 claimed AC-2 was covered by existing tests; grep showed zero `--ack-of` test references. Fix: T007 expanded to assert all three positive/negative paths (AC-1, AC-2, AC-3); T010 reduced to genuine regression coverage (idempotency, unread filter, peer-activity, JSONL round-trip).

**MEDIUM (fixed)**: T007 specified vague path "`outside-inbox-send.test.ts` or equivalent" — file does not exist. Fix: T007 now pinned to existing `test/cli/outside-peer.test.ts`.

**Verdict**: READY (after fixes).

---

## Validation Record (2026-04-29) — validate-v2 (narrow inline)

| Agent | Lenses Covered | Issues | Verdict |
|---|---|---|---|
| Source Truth (inline) | Accuracy, Concept Documentation | 0 | ✅ |
| Cross-Reference (inline) | Cross-Reference, Hidden Assumptions | 0 | ✅ |
| Forward-Compatibility (inline) | Forward-Compatibility, System Behavior, Integration & Ripple | 0 | ✅ |

**Lens coverage**: 8/12 — above the 8-floor for narrow scope on CS-1 Simple plan.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| `/plan-6` implementor | Unambiguous file paths + line numbers | encapsulation lockout | ✅ | All 12 tasks list absolute paths; T001/T004 cite exact line ranges (verified outside.ts:201,209 and mcp/types.ts:238) |
| `/plan-6` implementor | Exact done-when criteria | shape mismatch | ✅ | Each task has explicit Done-when column; 15 ACs cross-mapped with task ids |
| Plan 012 peer-activity | `lastAckOf` semantics preserved | contract drift | ✅ | T010 + AC-11 explicitly lock no-regression on ack-only verdict ladder |
| Plan 011 retro-harvest | Auto-harvest still works | lifecycle ownership | ✅ | No coordination/retro/forwarder lifecycle path touched |
| Companion review (Power On Mode) | Reviewable in commit-sized chunks | test boundary | ✅ | T001-T012 each map cleanly to one logical commit; § 6a anti-capture clause already shipped in plan 012 |

**Outcome alignment**: The plan, as shipped, advances the Outcome — tasks T001 (gate removal), T002 (label switch), T005 (preamble teaching) are precisely the three changes that flip `ackOf` from ack-only to general-reply pointer; chains form structurally because each reply id is a normal id reusable as a future `ackOf` target.

**Standalone?**: No — `/plan-6` implementor is a named downstream consumer with concrete shape requirements.

### Issues
| Sev | Lens | Issue | Action |
|---|---|---|---|
| LOW | Concept Documentation | No `§ Concepts` entry for "reply chains" in `runner/domain.md`; only history row planned (T011). Defensible since `ackOf` field already existed and no new contract is introduced. | Decide at implementation time; not a blocker. |

**Overall**: ✅ VALIDATED — no fixes needed beyond plan-4 corrections already applied. Ready for `/plan-6-v2-implement-phase`.

---

**Next steps**:
- Optional: `/plan-4-complete-the-plan` for validation
- Implement: `/plan-6-v2-implement-phase --plan "/Users/jordanknight/substrate/minih/docs/plans/013-message-reply-chains/message-reply-chains-plan.md"`
