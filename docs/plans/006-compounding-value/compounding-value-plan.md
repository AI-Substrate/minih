# Compounding Value Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-14
**Spec**: [compounding-value-spec.md](./compounding-value-spec.md)
**Workshop**: [workshops/001-compounding-value-in-minih.md](./workshops/001-compounding-value-in-minih.md)
**Status**: COMPLETE

## Summary

minih has the self-improvement loop (magic wand → fix → verify) but doesn't measure or surface the compounding effect. This plan adds structured difficulty reporting, per-agent velocity tracking, retrospective data in the run envelope, and philosophy docs — making the compound curve visible and actionable. All changes are internal to minih, touching the runner and cli domains.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | **modify** | Schema updates, velocity computation, report.json parsing, SYSTEM_OUTPUT_INSTRUCTIONS |
| cli | existing | **modify** | Run envelope surfacing, history trend column, new `difficulties` command |
| adapter | existing | **consume** | No changes |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/schemas/retrospective.json` | runner | contract | Add `magicWandTarget` + `difficulties` fields |
| `src/schemas/system-output.json` | runner | contract | Mirror new retro fields in system output |
| `src/runner/types.ts` | runner | contract | Add `velocity` to CompletedMetadata, add parsed report to AgentRunResult |
| `src/runner/runner.ts` | runner | internal | Velocity computation, report.json parsing after run |
| `agents/code-review/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/convention-check/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/first-time-experience/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/feedback-digest/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/mcp-smoke-test/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/prompt-review/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/self-review/output-schema.json` | runner | internal | Update inlined retrospective |
| `agents/smoke-test/output-schema.json` | runner | internal | Update inlined retrospective |
| `src/cli/commands/run.ts` | cli | internal | Surface retro fields in stdout envelope |
| `src/cli/commands/history.ts` | cli | internal | Add trend column + velocity summary line |
| `src/cli/commands/difficulties.ts` | cli | internal | NEW — aggregation command |
| `src/cli/index.ts` | cli | internal | Register difficulties command |
| `src/runner/display.ts` | runner | internal | Show magicWand + difficulty count in stderr summary |
| `agents/_shared/preamble.md` | runner | internal | Known difficulties, gift-to-future-self, category guidance |
| `AGENTS_README.md` | — | docs | Philosophy enrichment, difficulty ledger docs, CLI reference |
| `~/github/tools/agents/v2-commands/harness-is-the-product-v2.md` | — | external | Reference minih mechanisms |
| `test/runner/velocity.test.ts` | runner | internal | NEW — velocity computation tests |
| `test/runner/schema-compat.test.ts` | runner | internal | NEW — backward compat tests |
| `docs/domains/runner/domain.md` | runner | docs | Update contracts, concepts, history |
| `docs/domains/cli/domain.md` | cli | docs | Update composition, concepts, history |
| `src/runner/index.ts` | runner | contract | Export new types if needed |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Runner doesn't parse report.json after run — `AgentRunResult` has no parsed report content, so stdout envelope and displaySummary can't access summary/magicWand/difficulties | Parse report.json after run, add parsed report to AgentRunResult (T004) |
| 02 | Critical | Retrospective schema inlined in 10 places (retrospective.json, system-output.json, 8 agent schemas) — must update all consistently | Update all 10 in a single task (T001) |
| 03 | Critical | No velocity/difficulty infrastructure exists — entirely net-new | Ground-up implementation across tasks T001-T008 |
| 04 | High | Velocity lookup scans all run folders — could be slow with hundreds of runs | Only read most recent completed.json (sort folders desc, take first valid) (T003) |
| 05 | High | displaySummary() only receives metadata, not report content — needs AgentRunResult expansion | Extend AgentRunResult with parsed report (T004), update displaySummary (T005) |
| 06 | High | CompletedMetadata is flat — no velocity block yet | Add optional `velocity` field to type and runner (T002, T003) |
| 07 | High | History table has 4 columns, no trend | Add Trend column + summary line (T006) |

## Implementation

**Objective**: Add difficulty reporting, velocity tracking, run output surfacing, and philosophy docs to make minih's compounding value loop visible and measurable.

**Testing Approach**: Lightweight — real fixture files, no mocks. Tests for schema backward compat and velocity computation. Manual verify for docs and CLI output.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Update retrospective + system-output schemas | runner | `src/schemas/retrospective.json`, `src/schemas/system-output.json`, 8 agent `output-schema.json` files | AC1, AC2, AC3, AC4 — new optional fields added, existing outputs still validate | Add `magicWandTarget` (string), `difficulties` (array of {category, description, workaround, severity}). Update all 10 schema locations (2 shared + 8 agents: code-review, convention-check, first-time-experience, feedback-digest, mcp-smoke-test, prompt-review, self-review, smoke-test). |
| [x] | T002 | Add velocity type to CompletedMetadata | runner | `src/runner/types.ts` | AC5 — velocity type defined with all 5 fields | Add optional `velocity` block: `previousDurationMs`, `changePercent`, `runNumber`, `firstDurationMs`, `overallChangePercent` |
| [x] | T003 | Compute and store velocity at run end | runner | `src/runner/runner.ts` | AC5, AC6, AC7 — velocity block written to completed.json, first run has null previous, non-completed runs skipped | After run completes, scan run folders desc for previous completed run (result === 'completed' only — skip failed AND degraded). For `previousDurationMs`/`changePercent`: read last completed run's metadata. For `runNumber`/`firstDurationMs`/`overallChangePercent`: if prior run has `velocity` block, chain from it (O(1)). If no prior velocity (legacy runs), scan back to first completed run to establish baseline, then persist so future runs are O(1). Handle edge cases: no prior completed runs (null velocity fields, runNumber=1), corrupted completed.json (skip with try/catch), all-failed history (same as no prior). |
| [x] | T004 | Parse report.json and surface in AgentRunResult | runner | `src/runner/runner.ts`, `src/runner/types.ts` | AC24 — parsed report available on AgentRunResult | Per finding 01. After validation, safely parse report.json (try/catch for missing/empty/invalid JSON, type-check nested fields before extraction). Extract summary, magicWand, magicWandTarget, difficulties into a `parsedReport` field on AgentRunResult. All extracted fields are nullable — if report.json is missing or malformed, envelope gets metadata only (graceful degradation, never throws). |
| [x] | T005 | Surface retro in run envelope + displaySummary | cli, runner | `src/cli/commands/run.ts`, `src/runner/display.ts` | AC24, AC25 — envelope has retro fields, stderr shows magicWand + difficulty count | Per finding 05. Add fields to formatSuccess call. Update displaySummary to show magicWand text and difficulty count. |
| [x] | T006 | Add trend column + velocity summary to history | cli | `src/cli/commands/history.ts` | AC8, AC9 — trend column with ▼/▲/— indicators, summary line at bottom | Per finding 07. Read velocity block from completed.json. Green ▼ = faster, Red ▲ = slower, — = first/within 5%. |
| [x] | T007 | Create `minih difficulties` command | cli | `src/cli/commands/difficulties.ts`, `src/cli/index.ts` | AC10, AC11, AC12, AC13 — aggregates across all agents, auto-assigns MH-IDs, table on stderr, JSON on stdout | Scan all agents' run folders (completed runs only, skip in-progress/malformed). Read report.json, extract difficulties arrays, flatten. Auto-assign MH-001+ IDs in encounter order. Compute frequency by exact-description grouping (counting, not deduplication — all entries shown). Status defaults to "open" (no status store — humans promote resolved items to preamble manually). Table columns: ID, category, description, agent, frequency, severity. Handle zero difficulties gracefully. Add `--agent <slug>` filter for single-agent view. |
| [x] | T008 | Update SYSTEM_OUTPUT_INSTRUCTIONS | runner | `src/runner/runner.ts` | AC14, AC15 — JSON example with difficulties + magicWandTarget, instruction text | Add difficulties array example, magicWandTarget guidance, category suggestions (freeform, not enum). |
| [x] | T009 | Update preamble | runner | `agents/_shared/preamble.md` | AC16, AC17, AC18 — Known Difficulties table, gift-to-future-self, category guidance | Add Known Difficulties section (initially populated with minih's own MH- entries). Add "every task sends a gift" framing. Add suggested categories with "use your own" note. |
| [x] | T010 | Update AGENTS_README philosophy | — | `AGENTS_README.md` | AC19, AC20, AC21, AC22 — Core Principle, Encode Don't Document, Maturity Curve, Difficulty Ledger subsections | Surgical insertions into existing Philosophy section. Add `minih difficulties` to CLI reference. |
| [x] | T011 | Update harness-is-the-product skill | — | `~/github/tools/agents/v2-commands/harness-is-the-product-v2.md` | AC23 — skill references minih mechanisms | Add minih-specific section: MH- IDs, `minih difficulties`, `retrospective.difficulties`, A→B→C pipeline. |
| [x] | T012 | Tests: schema compat + velocity + CLI | runner, cli | `test/runner/velocity.test.ts`, `test/runner/schema-compat.test.ts` | AC3, AC5, AC6, AC7 — backward compat confirmed, velocity math correct, CLI surfacing works | Test: existing output without new fields validates. Test: velocity for first run (null previous, runNumber=1), nth run (chained), skip failed, skip degraded, corrupted completed.json (skipped), no prior completed runs, legacy runs without velocity block (backfill scan). Test: report.json parsing (valid, missing, malformed, missing fields). Use real fixture folders. |
| [x] | T013 | Update domain docs + barrel export | runner, cli | `docs/domains/runner/domain.md`, `docs/domains/cli/domain.md`, `src/runner/index.ts` | Domain docs reflect new contracts/concepts, barrel exports new types | Add velocity concept + parsedReport to runner domain. Add difficulties command to cli domain. Export new types from barrel if any named types added. Update domain history tables. |

### Acceptance Criteria

- [x] AC1: Schemas include optional `magicWandTarget` field
- [x] AC2: Schemas include optional `difficulties` array
- [x] AC3: Existing outputs without new fields still validate
- [x] AC4: Inlined agent schemas updated (code-review, convention-check, first-time-experience)
- [x] AC5: `completed.json` includes velocity block
- [x] AC6: First run has null previous, runNumber=1
- [x] AC7: Failed/degraded runs skipped for velocity
- [x] AC8: `minih history` shows trend column (▼/▲/—)
- [x] AC9: `minih history` shows velocity summary line
- [x] AC10: `minih difficulties` aggregates across all agents
- [x] AC11: Auto-assigns MH-001+ IDs (raw, no dedup)
- [x] AC12: Table on stderr, JSON on stdout
- [x] AC13: Zero difficulties handled gracefully
- [x] AC14: SYSTEM_OUTPUT_INSTRUCTIONS has difficulties example
- [x] AC15: SYSTEM_OUTPUT_INSTRUCTIONS has magicWandTarget guidance
- [x] AC16: Preamble has Known Difficulties table
- [x] AC17: Preamble has "gift to future self" framing
- [x] AC18: Preamble has suggested categories
- [x] AC19: AGENTS_README has "Core Principle" subsection
- [x] AC20: AGENTS_README has "Encode, Don't Document" subsection
- [x] AC21: AGENTS_README has "Maturity Curve" named concept
- [x] AC22: AGENTS_README has "Difficulty Ledger" A→B→C subsection
- [x] AC23: harness-is-the-product skill updated
- [x] AC24: Run envelope includes summary/magicWand/magicWandTarget/difficulties
- [x] AC25: stderr summary shows magicWand + difficulty count

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Velocity scan slow with many runs | Low | Low | Sort desc, read first valid completed.json only |
| Schema changes break existing outputs | Low | High | All fields optional, backward compat test (T012) |
| Agents ignore new fields | Medium | Medium | Explicit JSON examples in SYSTEM_OUTPUT_INSTRUCTIONS (T008) |
| Report.json parsing fails (malformed JSON) | Low | Medium | Try/catch with graceful fallback — envelope gets metadata only |
| harness-is-the-product is different repo | Low | Low | Separate commit, same session |

---

## Validation Record (2026-04-14)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence (GPT-5.4) | Integration & Ripple, System Behavior, Domain Boundaries | 4 (2 HIGH, 1 MEDIUM, 1 LOW) — all fixed | ✅ |
| Risk (GPT-5.4) | Hidden Assumptions, Edge Cases, Performance, Security | 5 (3 HIGH, 2 MEDIUM) — all fixed | ✅ |
| Completeness (GPT-5.4) | User Experience, Technical Constraints, Deployment, Concept Docs | 6 (2 HIGH, 3 MEDIUM, 1 LOW) — all fixed | ✅ |

**Fixes applied**:
1. T001 expanded from 3 to 8 agent schemas (all agents with inlined retro)
2. T003 fully specified: chain velocity from prior runs, backfill for legacy, skip failed+degraded, handle edge cases
3. T004 safe parsing: try/catch, type-check, nullable fields, graceful degradation
4. T007 frequency/status clarified: exact-description grouping for frequency, status defaults "open"
5. AC4/AC12 updated in spec to match
6. T012 expanded: degraded runs, CLI tests, report parsing edge cases
7. T013 added: domain doc updates + barrel export
8. Flight plan parallelism corrected: T004 parallel with T003, T009-T011 independent

Overall: ⚠️ **VALIDATED WITH FIXES** — 15 issues found across 3 agents, all addressed
