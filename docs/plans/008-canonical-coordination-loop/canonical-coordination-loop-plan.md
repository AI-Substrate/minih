# Canonical Coordination Loop Validator Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-27T14:56:59+10:00
**Spec**: [canonical-coordination-loop-spec.md](./canonical-coordination-loop-spec.md)
**Status**: Complete

## Summary

Build `coordination-loop-validator` as a real coordinated dogfooding harness and worked example. The plan adds a leaf agent folder, documents the canonical three-milestone parallel outside/inside runbook, validates the static CLI surfaces, and records evidence from a real manual live run. It consumes the existing `cli`, `runner`, `mcp`, and `adapter` domains without adding a new runtime domain or framework-level agent type.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| cli | existing | consume | Outside peer commands, `doctor`, `outside-context`, `run --dry-run`, `validate`, and `retros` provide the user-visible harness surface. |
| runner | existing | consume | Agent discovery, coordinated prompt assembly, local state-schema selection, output validation, snapshots, and forwarders power the harness. |
| mcp | existing | consume | The inside validator uses the private six-tool inbox/state MCP surface during a real run. |
| adapter | existing | consume | The live run indirectly relies on the existing event-driven session/send seam. |

## Harness Strategy

Harness: Not applicable as a separate project-rules phase (user override - this feature itself is the dogfooding harness). Implementation uses existing repository checks plus the new real coordinated agent, static CLI validation, and documented manual live-run evidence.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md` | runner/mcp | cross-domain | New inside-agent prompt consumes coordinated prompt assembly and inside MCP tools. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/outside.md` | cli/runner | cross-domain | New outside peer contract consumes outside CLI commands and runner coordination file semantics. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/instructions.md` | runner/mcp | cross-domain | New supplemental instructions keep inside behavior aligned with real MCP/state usage. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/output-schema.json` | runner | contract | New report contract validates milestone evidence, prompt checks, verdict, and coordination retrospective. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/inside-state.schema.json` | mcp/runner | contract | New agent-local inside state schema constrains validator statuses used by MCP `state_*` tools. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/outside-state.schema.json` | cli/runner | contract | New agent-local outside state schema constrains statuses used by outside `state` commands. |
| `/Users/jordanknight/substrate/minih/test/cli/coordination-loop-validator.test.ts` | cli | internal | New static/CLI regression checks prove the worked-example assets are discoverable and command-visible. |
| `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md` | cli/runner/mcp | cross-domain | New how-to guide documents the canonical runbook, startup variation, command beats, and expected evidence. |
| `/Users/jordanknight/substrate/minih/README.md` | cli/runner/mcp | cross-domain | Existing top-level docs get a concise pointer to the richer worked example. |
| `/Users/jordanknight/substrate/minih/AGENTS_README.md` | cli/runner/mcp | cross-domain | Existing agent authoring docs distinguish the minimal smoke test from the canonical worked example. |
| `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/manual-live-run-evidence.md` | cli/runner/mcp/adapter | cross-domain | New plan evidence file records the real manual live run commands, outcomes, and observed artifacts. |
| `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/canonical-coordination-loop-plan.md` | cli/runner/mcp/adapter | cross-domain | Existing plan artifact is updated during implementation and final closeout. |
| `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/canonical-coordination-loop.fltplan.md` | cli/runner/mcp/adapter | cross-domain | Existing flight plan tracks route progress, status parity, and flight-log evidence. |
| `/Users/jordanknight/substrate/minih/src/mcp/types.ts` | mcp | contract | Updated private MCP manifest to expose backend-safe underscore tool names while keeping legacy dotted aliases in-process. |
| `/Users/jordanknight/substrate/minih/src/mcp/server.ts` | mcp | internal | Updated dispatcher to normalize legacy dotted tool calls to the backend-safe manifest names. |
| `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` | runner | internal | Updated coordinated prompt text to teach inside agents the backend-safe MCP tool names. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts` | cli | internal | Updated reserved MCP tool-prefix checks to match the underscore namespaces exposed by the inside server. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | This is a leaf dogfooding harness, not a runtime feature or new domain. | Add real agent/docs/tests only; keep core domains as consumed contracts. |
| 02 | High | Agent-local state schemas are selected by both outside CLI and inside MCP tooling. | Use harness-specific statuses only when they are present in the local schemas; keep commands, prompt, and docs synced. |
| 03 | High | The canonical-vs-minimal distinction can drift. | Preserve `coordination-smoke-test` as the minimal primitive check and document `coordination-loop-validator` as the richer worked example. |
| 04 | High | The plan forbids new mocks for the harness. | Validate with real agent files, real CLI commands, run-scoped inbox/state files, and a documented real manual live run. |
| 05 | High | The value is the product-shaped three-milestone loop, not another forwarder/unit test. | Make outside-visible evidence for all three milestones the center of the runbook and report schema. |
| 06 | High | Prompt/docs drift is likely because the same loop appears in prompt, outside contract, docs, and tests. | Pin the canonical command beats in `outside.md`, mirror them in docs, and assert the visible CLI/dry-run text. |

## Implementation

**Objective**: Add and validate the real `coordination-loop-validator` worked example as the canonical richer outside/inside coordination loop.

**Testing Approach**: Lightweight, no new mocks for the harness. Use static file/schema checks, built CLI checks, targeted CLI tests, and documented real manual live-run evidence. Automated e2e for this agent is deferred.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Create the coordinated validator agent folder | runner/mcp/cli | `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/outside.md`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/instructions.md` | The agent has `coordination: enabled`, clearly says it is a coordination harness, explains parallel outside/inside roles, gives the outside-starts-inside main path, documents exactly three milestone beats plus the already-running variation, and defines bounded waiting so missing outside signals produce explicit blocked/partial outcomes instead of indefinite hangs. | Reuse existing normal agent folder conventions; no new agent type. |
| [x] | T002 | Add schemas for harness state and report evidence | runner/mcp/cli | `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/output-schema.json`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/inside-state.schema.json`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/outside-state.schema.json` | Local state schemas define the approved side statuses used by the runbook, every prompt/runbook command uses only those approved statuses, and the output schema requires summary, verdict, three milestone evidence records, state checks, prompt checks, and coordination retrospective feedback. | Workflow-specific milestone/phase labels live in `data` fields or message bodies, not in status values; avoid default-schema drift and do not copy workshop-only phase labels into `status`. |
| [x] | T003 | Add static CLI regression coverage for the worked example | cli | `/Users/jordanknight/substrate/minih/test/cli/coordination-loop-validator.test.ts` | The test proves the agent passes `doctor`, `outside-context` exposes the canonical runbook, `run --dry-run` includes the peer contract and coordination sections, and schema files are valid JSON Schema. | Use built CLI subprocess patterns; do not add live model calls or new mocks. |
| [x] | T004 | Add the deeper worked-example guide | cli/runner/mcp | `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md` | The guide explains the minimal-vs-rich example split, outside-starts-inside main path, already-running variation, clean-slate setup/reset for run-scoped inbox/state artifacts, three milestone commands, expected outside-visible evidence, validation commands, normal inside-process shutdown, post-run cleanup, and future many-inside-agent boundary. | `docs/how/` is new if absent. |
| [x] | T005 | Add discoverability pointers in top-level docs | cli/runner/mcp | `/Users/jordanknight/substrate/minih/README.md`; `/Users/jordanknight/substrate/minih/AGENTS_README.md` | Top-level docs point readers to the rich worked example and clearly preserve `coordination-smoke-test` as the minimal primitive check. | Keep pointers concise; detailed runbook belongs in `docs/how/`. |
| [x] | T006 | Validate static and CLI surfaces | cli/runner | `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/`; `/Users/jordanknight/substrate/minih/test/cli/coordination-loop-validator.test.ts` | Build, doctor, outside-context, run dry-run, targeted tests, and schema validation pass for the new harness assets. | Use existing commands only; no new tooling. |
| [x] | T007 | Execute and document the real manual live run | cli/runner/mcp/adapter | `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/manual-live-run-evidence.md` | Evidence file records a clean-slate outside-starts-inside run, initial ready message/state before milestone 1, message IDs and acknowledgement evidence for each of the three milestone sends, inside feedback/readback, state observations, final validation, retros output, normal inside-process exit or explicit blocked/partial timeout outcome, and post-run cleanup/reset sufficient to prove the loop worked. | Requires real agent execution; no mock substitute. |
| [x] | T008 | Final quality gate and plan artifact alignment | cli/runner/mcp/adapter | `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/canonical-coordination-loop-plan.md`; `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/canonical-coordination-loop.fltplan.md` | The full repository gate passes, plan artifacts reflect implementation status, and no generated docs contradict the clarified spec. | Keep flight plan progress updated during implementation. |

### Acceptance Criteria

- [x] `coordination-loop-validator` is identifiable as the canonical dogfooding harness, concept demonstrator, and worked example.
- [x] The outside contract explains how to ensure an inside agent is running, send milestones, publish state, read feedback, and complete the run.
- [x] The inside agent's role is explicitly coordination validation, not real code review.
- [x] The worked example covers exactly three simulated milestones before completion.
- [x] Each milestone has observable outside message, state, inside handling, feedback, and outside readback evidence.
- [x] The final report distinguishes coordination validation from code-quality validation.
- [x] The final report includes coordination-focused magic-wand feedback.
- [x] The worked example uses schema-compatible side statuses, with workflow-specific milestone/phase vocabulary stored in `data` fields or message bodies.
- [x] The harness has bounded waiting behavior so missing outside signals become explicit blocked/partial outcomes rather than indefinite hangs.
- [x] Existing `coordination-smoke-test` behavior remains understandable as the minimal primitive check while this harness is documented as the richer canonical loop worked example.
- [x] The worked example can be validated from outside-facing commands, final artifacts, and documented manual live-run evidence without reading private run internals.
- [x] The feature adds no new runtime domain, public MCP server, daemon supervisor, or core dependency on dogfood assets.
- [x] The feature distinguishes the v1 single-inside worked example from future many-inside-agent orchestration.
- [x] Static/CLI checks and a documented real manual live run provide the first implementation's evidence.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Agent prompt, outside contract, docs, and tests drift from each other. | Medium | High | Put the canonical three-milestone beats in `outside.md`, mirror them in the how-to guide, and assert visible CLI/dry-run text. |
| Status vocabulary rejects real state commands. | Medium | High | Create agent-local state schemas and ensure every prompt/runbook command uses only statuses accepted by those schemas. |
| The inside agent exits before all three milestones. | Medium | High | Make bounded waiting and readiness publication explicit in prompt/instructions and verify it during the manual live run. |
| The manual live run becomes the only proof and is hard to inspect later. | Medium | Medium | Capture command sequence, outputs, state snapshots, validation result, and retros output in the evidence file. |
| Implementation expands into runtime orchestration. | Low | High | Keep runtime domains consume-only; do not add public MCP, daemon mode, source eventing, or many-inside-agent orchestration. |

### Discoveries & Learnings

| Task | Discovery | Impact | Action |
|------|-----------|--------|--------|
| T001 | `minih status <slug>` and `minih tail <slug>` exist as outside observation commands; `tail` follows `events.ndjson` and exits on `completed.json`. | The worked example can keep the outside peer in the loop using real status/tail surfaces instead of inventing observability. | Include both commands in the outside contract and how-to guide. |
| T003 | `doctor` warns when coordinated `outside.md` is over 4KB. | The outside contract must stay concise or the new canonical example teaches an unhealthy authoring pattern. | Keep `outside.md` as a quick contract and put the deeper walkthrough in `docs/how/coordination-loop-validator.md`. |
| T007 | Live coordinated runs failed with CAPI 400 when the private MCP manifest exposed dotted tool names such as `inbox.list` and `state.get`; the existing smoke agent failed the same way. | The backend accepted the MCP server connection but rejected the tool manifest before the first model turn, blocking every coordinated live run. | Expose underscore MCP tool names (`inbox_list`, `state_get`, etc.), keep dotted aliases only in the local dispatcher, and update prompts/docs/tests. |
| T007 | The live run completed after the MCP tool-name fix with run `2026-04-27T15-25-51-655Z-a767`: 5372 events, 45 tool calls, three milestone feedback cycles, `validate` success, and coordination retros. | The canonical worked example now has real outside-visible proof instead of only static checks. | Preserve the concise evidence in `manual-live-run-evidence.md` and use it as the reference transcript for future coordination work. |

## Next Step

Implementation complete. Ready for validation review and then `/plan-7-v2-code-review --plan "/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/canonical-coordination-loop-plan.md"`.

---

## Validation Record (2026-04-27)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence Validator | User Experience, System Behavior, Integration & Ripple, Domain Boundaries, Hidden Assumptions, Concept Documentation | 2 HIGH fixed, 1 MEDIUM fixed | ✅ |
| Risk Validator | Technical Constraints, Edge Cases & Failures, Performance & Scale, Security & Privacy, Deployment & Ops, Hidden Assumptions | 3 HIGH fixed, 1 MEDIUM open, 1 LOW fixed | ⚠️ |
| Completeness Validator | User Experience, Technical Constraints, Edge Cases & Failures, Deployment & Ops, Concept Documentation, Performance & Scale | 2 HIGH fixed, 1 MEDIUM fixed, 1 MEDIUM open | ⚠️ |
| Forward-Compatibility Validator | Forward-Compatibility, Integration & Ripple, Domain Boundaries, Technical Constraints, Deployment & Ops | 1 HIGH fixed, 1 MEDIUM open | ⚠️ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 implementation task T001 | Exact agent-file deliverables and behavior scope | Encapsulation lockout | ✅ | T001 names `prompt.md`, `outside.md`, `instructions.md`, parallel roles, outside-starts-inside, exactly three milestones, already-running variation, and bounded waiting. |
| plan-6 implementation task T002 | Exact schema deliverables and required state/report evidence shape | Shape mismatch | ✅ | T002 names all three schema files, report evidence categories, approved side statuses, and the rule that workflow vocabulary belongs in `data` or message bodies. |
| plan-6 implementation task T003 | Static CLI regression surfaces without live model calls/new mocks | Test boundary | ✅ | T003 specifies doctor, outside-context, dry-run, JSON Schema checks, and no live model calls or new mocks. |
| plan-6 implementation task T004 | docs/how guide scope and runbook beats | Contract drift | ✅ | T004 covers minimal-vs-rich split, startup paths, clean-slate reset, three milestone commands, outside-visible evidence, validation commands, shutdown, cleanup, and future boundary. |
| plan-6 implementation task T005 | README/AGENTS pointer scope preserving minimal-vs-rich distinction | Domain boundaries | ✅ | T005 preserves `coordination-smoke-test` as minimal and points to `coordination-loop-validator` as the richer worked example. |
| plan-6 implementation task T006 | Static/CLI validation surfaces using existing commands only | Technical Constraints | ✅ | T006 requires build, doctor, outside-context, dry-run, targeted tests, schema validation, and existing commands only. |
| plan-6 implementation task T007 | Manual live-run evidence requirements | Lifecycle ownership | ✅ | T007 requires clean-slate setup, readiness before milestone 1, message IDs, acknowledgement evidence for each milestone, readback, state observations, final validation, retros output, shutdown/timeout outcome, and cleanup/reset. |
| plan-6 implementation task T008 | Final gate and plan/flight-plan status alignment | Contract drift | ❌ | Open MEDIUM: T008 still says plan artifacts must reflect implementation status but does not enumerate exact closeout fields such as task checkboxes, stage checkboxes, flight log entry, and status parity. |
| canonical-coordination-loop.fltplan.md | Route stages/ACs/risks consistent with plan | Contract drift | ✅ | Flight plan stages 1-8 align with T001-T008 and both top-level artifacts now use `Ready` status. |

**Outcome alignment**: This artifact does advance the outcome that “This feature is about demonstrating and validating the coordination loop, not about judging real code quality,” because it commits to real agent/schema/CLI/live-evidence work; fix the plan/flight-plan status drift to keep that contract implementation-ready.

**Standalone?**: No — downstream plan-6 implementation tasks T001-T008 and `canonical-coordination-loop.fltplan.md` consume this plan.

**Fixes applied (HIGH)**:
- Aligned plan readiness status with the flight plan.
- Added missing plan and flight-plan artifacts to the Domain Manifest.
- Made bounded waiting and explicit blocked/partial outcomes a T001 and acceptance-criteria requirement.
- Tightened the state-status rule so workflow phase/milestone vocabulary must live in `data` fields or message bodies, not status strings.
- Required clean-slate setup, cleanup/reset, and normal shutdown/timeout evidence for the manual runbook.
- Required initial readiness plus message IDs and acknowledgement evidence for every milestone.
- Added missing acceptance criteria for status/data compatibility, bounded waiting, minimal-vs-rich discoverability, and outside-facing-only proof.

**Open (MEDIUM/LOW — user decision)**:
- MEDIUM: Add exact T008 closeout fields for plan status, T001-T008 checkboxes, flight Stage 1-8 checkboxes, flight-log entry, and cross-file status parity.
- MEDIUM: Split T001's Done When into file-specific responsibilities for `prompt.md`, `outside.md`, and `instructions.md`.
- MEDIUM: Add evidence hygiene/redaction rules for transcripts, screenshots, local paths, usernames, and session IDs.

Overall: VALIDATED WITH FIXES

---

## Validation Record (2026-04-27 Implementation)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Runtime Correctness | System Behavior, Technical Constraints, Edge Cases & Failures, Security & Privacy | 0 | ✅ |
| Regression Integration | Integration & Ripple, Deployment & Ops, Performance & Scale, Hidden Assumptions | 0 | ✅ |
| Domain Docs Consistency | Domain Boundaries, Concept Documentation, User Experience, Security & Privacy | 0 | ✅ |
| Forward Compatibility | Forward-Compatibility | 0 | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `coordination-loop-validator` live run assets | Real MCP tools + schemas + prompts + output schema must work end to end | Shape mismatch | ✅ | `src/mcp/types.ts`, `agents/coordination-loop-validator/prompt.md`, `agents/coordination-loop-validator/output-schema.json`, and `manual-live-run-evidence.md` show the completed live run. |
| Existing `coordination-smoke-test` | Minimal coordinated smoke agent stays understandable/runnable after tool-name changes | Contract drift | ✅ | `coordination-smoke-test` prompt/schema use underscore tool names and docs preserve it as the minimal primitive check. |
| CLI `run`/`resume` composition root | Reserved MCP namespace must prevent user tool collisions with internal server | Encapsulation lockout | ✅ | `run.ts` and `resume.ts` use `inbox_`/`state_` reserved prefixes; MCP dispatch keeps dotted aliases private. |
| Runner coordinated prompt builder | Prompt text must match exposed MCP tool names and preserve non-coordinated prompt parity | Contract drift | ✅ | `preamble-builder.ts` teaches `inbox_list`/`state_transition`; existing prompt-builder tests cover coordinated-only sections. |
| Future `/plan-7-v2-code-review` and users reading docs/how | Need validated implementation/evidence trail without depending on generated run folders | Test boundary | ✅ | `docs/how/coordination-loop-validator.md` and `manual-live-run-evidence.md` document the run; generated `inbox/state/runs` artifacts were cleaned after evidence capture. |

**Outcome alignment**: This artifact advances “This feature is about demonstrating and validating the coordination loop, not about judging real code quality.”

**Standalone?**: No — downstream consumers are the live validator assets, existing smoke test, CLI run/resume composition root, runner prompt builder, and future plan-7/users consuming the evidence trail.

Overall: VALIDATED

---

## Fixes

| ID | Created | Summary | Domain(s) | Status | Source |
|----|---------|---------|-----------|--------|--------|
| FX001 | 2026-04-27 | Run-scoped coordination state | runner, mcp, cli | Complete | Post-implementation correction from first live messaging run review |
| FX002 | 2026-04-27 | Blocking inbox list | mcp, runner, cli | Complete | Private `inbox_list.waitMs` long-poll implemented and documented before no-context two-agent eval |
