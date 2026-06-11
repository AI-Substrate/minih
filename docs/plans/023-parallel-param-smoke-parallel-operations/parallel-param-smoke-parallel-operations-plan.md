# Core Parallel Operations Convenience Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-08
**Spec**: [parallel-param-smoke-parallel-operations-spec.md](./parallel-param-smoke-parallel-operations-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Spec has no blocking open questions; workshop 001 settled ambiguous latest-run and params-summary contract. |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` exists. |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` exists; domain-map import direction is still respected. |
| G4 | ADR Compliance | N/A | No accepted ADR corpus found under `docs/adr/`. |
| G5 | Structure | PASS | Required Simple sections are present; all task file paths are covered by the Domain Manifest. |
| G6 | Testing Alignment | PASS | Full TDD is encoded first: runner/CLI tests precede implementation tasks, and each acceptance criterion maps to tests. |
| G7 | Domain Completeness | PASS | All spec domains (`cli`, `runner`, `measurement`) appear in Target Domains and all planned source/test/docs files are classified. |

## Summary

This plan adds the core visibility and safety primitives needed to operate many minih runs without adding a batch scheduler. The runner domain will persist safe run-identifying metadata (`label`, bounded/redacted `paramsSummary`) and expose reusable inventory/status projections over run manifests. The CLI domain will add `minih runs list`, `minih runs status`, `minih run --label`, and ambiguity guards that prevent latest-run defaults from silently targeting the wrong active same-slug run. Documentation and help will teach the dogfood path: use minih CLI surfaces, copy explicit run IDs, and pass `--run` for run-scoped operations.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|--------------|------|
| cli | existing | modify | Own command UX, argument parsing, JSON envelopes, help/docs copy, ambiguity error rendering, and safe run-target defaults. |
| runner | existing | modify | Own durable run metadata, manifest/completed metadata types, params-summary formatting/redaction, run inventory projections, and resolver candidate data. |
| measurement | existing | consume | Apply runner-fact authority and redaction posture: inventory rows are factual runner evidence, not agent interpretation. |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|----------------|-----------|
| `src/runner/types.ts` | runner | contract | Add `RunParamsSummary`, `label`, `paramsSummary`, inventory/status row contracts, and enriched ambiguity candidates. |
| `src/runner/run-params-summary.ts` | runner | internal | New bounded/redacted formatter for params summaries. |
| `src/runner/run-inventory.ts` | runner | contract | New helper to scan run manifests/completed metadata and project inventory/status rows without CLI imports. |
| `src/runner/run-resolver.ts` | runner | internal | Extend active-candidate ambiguity details and support explicit read-only latest override semantics. |
| `src/runner/human-view-errors.ts` | runner | contract | Keep `MultipleActiveRunsError` as the shared E170 source and widen candidate payload shape. |
| `src/runner/run-manifest.ts` | runner | internal | Persist/read forward-compatible manifest fields. |
| `src/runner/runner.ts` | runner | internal | Thread label/paramsSummary from run config into `run.json` and `completed.json`. |
| `src/runner/index.ts` | runner | contract | Export new runner helpers/types to CLI. |
| `src/cli/commands/run.ts` | cli | internal | Add `--label`, validate it, construct params summary, and pass both into runner config. |
| `src/cli/commands/runs.ts` | cli | contract | New `minih runs list` and `minih runs status` command group. |
| `src/cli/commands/status.ts` | cli | internal | Route default run resolution through ambiguity guard; add read-only `--latest`. |
| `src/cli/commands/tail.ts` | cli | internal | Route snapshot/follow target resolution through ambiguity guard; add read-only `--latest`. |
| `src/cli/commands/view.ts` | cli | internal | Preserve existing E170 guard and add read-only `--latest`. |
| `src/cli/commands/connect.ts` | cli | internal | Add an active-run ambiguity pre-scan before the existing completed-session `findRunSession` path; preserve latest completed/session behavior when no active ambiguity exists. |
| `src/cli/commands/attach.ts` | cli | internal | Preserve/write-safe guard; require explicit `--run` when ambiguous, no `--latest`. |
| `src/cli/commands/resume.ts` | cli | internal | Add an active-run ambiguity pre-scan before the existing latest-eligible/completed resume path; preserve E144 `ALREADY_ACTIVE` for a selected active run and do not add `--latest`. |
| `src/cli/coordination.ts` | cli | internal | Centralize guarded run resolution for run-scoped outside/inside/state coordination commands. |
| `src/cli/commands/outside.ts` | cli | contract | Apply write-safe ambiguity guard to outside inbox/state/retro writes. |
| `src/cli/commands/inside.ts` | cli | contract | Apply read-only guard and `--latest` where supported for lane reads. |
| `src/cli/commands/state.ts` | cli | contract | Apply read-only guard for `state get` and write-safe guard for state mutations where routed here. |
| `src/cli/index.ts` | cli | internal | Register `runs` command group. |
| `src/cli/output.ts` | cli | contract | Reuse/widen E170/E171 details; no new error family. |
| `README.md` | cli | cross-domain | Human quick-start docs for safe parallel run observation. |
| `AGENTS_README.md` | cli | cross-domain | Agent-facing safe workflow guidance. |
| `docs/how/parallel-runs.md` | cli | cross-domain | Deeper run visibility and explicit-target workflow guide. |
| `test/runner/run-params-summary.test.ts` | runner | internal | Unit tests for redaction, bounding, summarization, and label validation helper. |
| `test/runner/run-inventory.test.ts` | runner | internal | Fixture tests for active/all/slug filters and row projection from manifests. |
| `test/runner/run-resolver.test.ts` | runner | internal | Existing resolver tests extended for enriched candidates and latest override behavior. |
| `test/runner/run-manifest.test.ts` | runner | internal | Manifest compatibility tests for optional label/params summary fields. |
| `test/runner/runner.test.ts` | runner | internal | Runner-level persistence tests for live and completed metadata. |
| `test/cli/runs.test.ts` | cli | contract | Command-boundary tests for `runs list`/`runs status` envelopes, degraded rows, and filters. |
| `test/cli/run-help.test.ts` | cli | contract | Help text coverage for `--label`, `runs`, and safe `--run` guidance. |
| `test/cli/run-label.test.ts` | cli | contract | CLI validation/persistence tests for `run --label` and params summary handoff. |
| `test/cli/run-target-ambiguity.test.ts` | cli | contract | Ambiguous latest-run guard matrix across status/tail/view/connect/attach/resume/coordination commands. |
| `test/cli/view-command.test.ts` | cli | internal | Existing view tests extended for `--latest` success metadata/warning. |
| `test/cli/tail.test.ts` | cli | internal | Existing tail tests extended for E170 and read-only `--latest`. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | The existing `run-resolver.ts` already throws `MultipleActiveRunsError` for multiple active `latest-active` candidates, but only some commands use that shared path today. | Reuse E170 and converge latest-default commands on a shared guarded resolver instead of inventing another ambiguity mechanism. |
| 02 | Critical | The workshop selected write-safety as the boundary: read-only commands may opt into `--latest`, but mutating commands must require `--run` when ambiguous. | Encode command-specific guard policy in CLI helpers/tests so outside inbox/state/resume/attach cannot silently pick the newest active run. |
| 03 | High | `run.json` already exists from run-folder creation and `completed.json` is written at terminal state; both are the right factual sources for inventory rows. | Persist optional `label` and `paramsSummary` in both live manifest and completed metadata so active and historical views display consistently. |
| 04 | High | Params summaries are useful identifiers but unsafe if serialized naively. | Add runner-owned formatter with max keys, max lengths, object/array summaries, secret-ish key redaction, and tests for truncation/redaction. |
| 05 | High | Cross-agent inventory must remain bounded and dogfood-friendly; humans/agents should not inspect run dirs directly. | Implement `minih runs list/status` as the public surface, with bounded defaults and docs that explicitly route users through the CLI. |
| 06 | High | Velocity metadata can be misleading under overlapping same-slug runs because completion order and run number can race. | Do not surface velocity prominently in new inventory rows; record as a follow-up risk rather than expanding this scope. |
| 07 | High | `connect` and `resume` currently resolve through completed-session/eligible-run paths, not the active-run resolver, so a thin shared-resolver swap would miss the `N active, 0 completed` ambiguity case. | Add explicit active-run ambiguity pre-scans for these commands before their existing completed/eligible fallback paths, and test that current latest-completed compatibility remains intact when there is no active ambiguity. |

## Implementation

**Objective**: Add first-class run inventory/status, safe latest-run targeting, and human-readable run identifiers for parallel minih operations without adding batch orchestration.

**Testing Approach**: Full TDD with targeted mocks: synthetic agent/run fixtures, direct runner-unit tests for formatting/projection, and CLI command tests against built `dist/` for envelope/TTY contract boundaries.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|----|------|--------|---------|-----------|-------|
| [x] | T001 | Add runner params-summary and label contract tests before implementation. | runner | `test/runner/run-params-summary.test.ts`, `test/runner/run-manifest.test.ts`, `test/runner/runner.test.ts` | Tests cover PS-1 through PS-6 from workshop 001: valid labels, invalid labels, redaction, long strings, objects/arrays, max keys, and live/completed persistence expectations. | Per findings 03, 04. |
| [x] | T002 | Implement bounded/redacted params summary and label validation helpers. | runner | `src/runner/run-params-summary.ts`, `src/runner/types.ts`, `src/runner/index.ts` | Helper returns `RunParamsSummary {schemaVersion:1, display, truncated, redactedKeys, omittedKeys?}` and rejects invalid labels with a typed error or result that CLI can map to E108. | Secret-ish key list from workshop: password/passwd/secret/token/api_key/apikey/credential/auth. |
| [x] | T003 | Persist label and params summary through run lifecycle. | runner | `src/runner/types.ts`, `src/runner/runner.ts`, `src/runner/run-manifest.ts`, `test/runner/runner.test.ts` | `LiveRunManifest` and `CompletedMetadata` include optional `label`/`paramsSummary`; initial `run.json` and terminal `completed.json` preserve them; legacy manifests without fields still read. | Keep fields optional for compatibility. |
| [x] | T004 | Add CLI `run --label` tests before implementation. | cli | `test/cli/run-label.test.ts`, `test/cli/run-help.test.ts` | Built CLI rejects empty/too-long/newline/NUL labels with E108; help documents `--label`; valid labels reach dry-run/run config without SDK/network. | Test with targeted mocks or dry-run where possible. |
| [x] | T005 | Wire `minih run --label` and params summary creation. | cli | `src/cli/commands/run.ts`, `src/cli/output.ts` | CLI validates label, builds params summary from parsed `--param` values, and passes SDK-neutral fields to runner config; invalid labels return JSON error envelope with E108. | Keep resume unchanged; label is for fresh runs. |
| [x] | T006 | Add runner inventory projection tests before implementation. | runner | `test/runner/run-inventory.test.ts` | Synthetic fixtures prove active/all/slug/limit filters, liveness projection, event/tool counters, label/paramsSummary surfacing, missing/torn manifest tolerance, and completed metadata fallback. | Inventory helper may read minih-owned run files internally. |
| [x] | T007 | Implement runner run inventory/status helpers. | runner | `src/runner/run-inventory.ts`, `src/runner/types.ts`, `src/runner/index.ts` | Helper returns bounded rows across `agents/*/runs/*` with `slug`, `runId`, liveness/status/result, timestamps, pid, model, sessionId, counters, label, paramsSummary, diagnostics; explicit status helper returns row-level not-found/corrupt errors. | No CLI imports; keep domain direction `cli → runner`. |
| [x] | T008 | Add CLI `runs` command tests before implementation. | cli | `test/cli/runs.test.ts` | `minih runs list --active`, `runs list --all --slug <slug>`, repeated `runs status --run slug/runId`, and `runs status --from targets.txt` match JSON envelope examples; missing rows produce degraded status, invalid direct args produce E108. | Include TTY table smoke if existing test helpers support stderr capture. |
| [x] | T009 | Implement `minih runs list` and `minih runs status`. | cli | `src/cli/commands/runs.ts`, `src/cli/index.ts`, `src/cli/output.ts` | New command group is registered; JSON envelopes use stdout; human tables use stderr; list defaults are bounded; status supports repeated `--run` and `--from`; no batch/fanout command is introduced. | Public dogfood surface for cross-agent inventory. |
| [x] | T010 | Add ambiguity guard tests before implementation. | cli | `test/cli/run-target-ambiguity.test.ts`, `test/cli/view-command.test.ts`, `test/cli/tail.test.ts`, `test/runner/run-resolver.test.ts` | AG-1 through AG-7 pass: status/tail/view hard-refuse E170 by default with candidates/remedies, read-only `--latest` selects newest with warning/selection metadata, writes require explicit `--run`, single/zero active remains compatible; connect/resume fixture cases cover `N active, 0 completed` and `0 active, latest completed exists`. | Per workshop D1-D3 and finding 07. |
| [x] | T011 | Enrich resolver ambiguity candidates and centralize guarded resolution policy. | runner | `src/runner/run-resolver.ts`, `src/runner/human-view-errors.ts`, `src/runner/types.ts` | `MultipleActiveRunsError` candidates include `runId`, `startedAt`, `sessionId`, `label`, `paramsSummary`; resolver can support explicit latest selection for read-only callers without changing default safety. | Keep stale/dead PID filtering behavior; expose an active-candidate scan reusable by commands whose primary default path is completed-session based. |
| [x] | T012 | Apply ambiguity guards to single-run read-only commands. | cli | `src/cli/commands/status.ts`, `src/cli/commands/tail.ts`, `src/cli/commands/view.ts`, `src/cli/commands/connect.ts` | Without `--run`, multiple active same-slug runs return E170 and remedies; `--latest` explicitly selects newest active with TTY warning and JSON selection metadata where envelopes exist; status/tail preserve latest-any/latest-completed fallback when no active candidates exist; connect performs an active ambiguity pre-scan, then preserves its existing latest completed-session command-printing path. | `tail` may keep command-specific stderr style if not envelope-first; test for clear error. |
| [x] | T013 | Apply ambiguity guards to run-scoped mutating/writable commands. | cli | `src/cli/commands/attach.ts`, `src/cli/commands/resume.ts`, `src/cli/coordination.ts`, `src/cli/commands/outside.ts`, `src/cli/commands/state.ts` | Ambiguous active same-slug writes fail E170 with candidates/remedies and do not append/modify files; only `--run <id>` resolves ambiguity; no `--latest` escape hatch is available on mutating commands; resume performs an active ambiguity pre-scan before its existing latest eligible/completed path and preserves E144 `ALREADY_ACTIVE` for a selected active run. | Covers outside inbox send, outside state set/transition, outside retro add, attach, resume; avoids treating resume as a thin `findRunSession` edit. |
| [x] | T014 | Apply read-only guarded resolution to coordination reads. | cli | `src/cli/coordination.ts`, `src/cli/commands/inside.ts`, `src/cli/commands/state.ts` | Inside inbox list and state get use E170 by default when ambiguous, support read-only `--latest` if included in command table, and preserve explicit `--run`. | Keep inside CLI read-only constraint intact. |
| [x] | T015 | Update help and docs for discoverability. | cli | `README.md`, `AGENTS_README.md`, `docs/how/parallel-runs.md`, `test/cli/run-help.test.ts` | Docs show manual parallel launch, `minih runs list --active`, `minih runs status`, labels, params summaries, explicit `--run`, and the no-direct-run-dir dogfood rule; help mentions `runs` and `--label`. | Hybrid docs per spec. |
| [x] | T016 | Run focused gates and full quality gate. | cli/runner | `test/runner/run-params-summary.test.ts`, `test/runner/run-inventory.test.ts`, `test/runner/run-resolver.test.ts`, `test/cli/runs.test.ts`, `test/cli/run-label.test.ts`, `test/cli/run-target-ambiguity.test.ts`, `test/cli/run-help.test.ts`, `justfile` | Focused tests pass after `just build`; `just fft` passes before commit/push; any audit/test findings are surfaced and owned. | Required by AGENTS.md. |
| [x] | T017 | Record implementation evidence. | measurement | `docs/plans/023-parallel-param-smoke-parallel-operations/execution.log.md` | Execution log captures changed files, focused command output, `just fft` result, residual risks, and explicit note that batch orchestration remained out of scope. | Measurement domain consumes runner/CLI facts as evidence. |

### Acceptance Criteria

- [x] AC1 Cross-agent inventory: `minih runs list --active` returns active runs across all slugs with slug, runId, liveness/verdict/status, startedAt, updatedAt, pid, model, sessionId, event/tool counters, label, and paramsSummary where available.
- [x] AC2 History-capable inventory: `minih runs list --all --slug parallel-param-smoke` includes completed runs for that slug with bounded/default ordering and no need to know run IDs first.
- [x] AC3 Bulk explicit status: `minih runs status` accepts multiple explicit targets and returns one machine-readable row per target, with row-level not-found/errors and whole-command failure only for invalid invocation/input parsing.
- [x] AC4 Run labels: `minih run <slug> --label <label>` persists the label in live manifest and final metadata used by inventory/status.
- [x] AC5 Params summary: params are summarized into bounded, human-readable, redacted display metadata; oversized/object values are summarized rather than dumped.
- [x] AC6 Ambiguity safety: multiple active same-slug runs cause selected latest-default commands to return E170 with candidate run IDs, labels/params summaries where available, and exact `--run` remedies.
- [x] AC7 Backward compatibility: zero or one active run preserves existing latest-default behavior.
- [x] AC8 Dogfood path: docs/help show `minih runs list`, `minih runs status`, and explicit `--run`; they do not instruct users to read run-dir files directly.
- [x] AC9 No batch scope creep: no batch scheduler, fanout, group stop, or multi-run tail UI command is added.
- [x] AC10 Validation: focused CLI/runner tests and `just fft` pass before commit/push.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scripts relying on latest active behavior may break under parallel active runs. | Medium | Medium | Guard only when genuinely ambiguous (>1 active same-slug candidate); preserve explicit `--run` and zero/one active behavior; provide read-only `--latest`. |
| Params summaries could leak sensitive values. | Medium | High | Redact secret-ish keys, summarize objects/arrays, bound strings/keys/total size, document that params/labels should not contain secrets. |
| Cross-agent scans could become slow/noisy on large histories. | Medium | Medium | Bound default list size; require `--all` for history-heavy views; keep filters (`--active`, `--slug`, `--limit`) cheap and test ordering. |
| Resolver policy could diverge between commands. | Medium | High | Centralize CLI guard helper and table-driven tests across read-only and mutating command families. |
| Velocity data remains misleading under overlap. | High | Low | Do not emphasize velocity in new inventory rows; record as follow-up rather than expanding scope. |
| Tail/view TUI commands may not share envelope mechanics with status/list. | Medium | Medium | Test command-specific observable behavior: clear E170 stderr/nonzero for non-envelope paths, JSON details where envelope exists. |

## Agent Harness Strategy

- **Current Maturity**: L2
- **Target Maturity**: L2 (unchanged by this feature)
- **Boot Command**: `just build`
- **Health Check**: `minih doctor`
- **Interaction Model**: Terminal CLI with JSON envelopes on stdout and human diagnostics/tables on stderr
- **Evidence Capture**: Vitest output, CLI JSON envelopes/stderr, `git --no-pager diff --check`, and the plan execution log
- **Pre-Phase Validation**: Use `just build` before CLI command-boundary tests; run focused tests during implementation; run `just fft` before commit/push

## Harness Loop

- **Backpressure Check** (`/harness-2-backpressure`, alias `/plan-2d`): not run for this plan; spec and workshop provide sufficient Implementation Ready decisions. No Phase 0 is required.
- **Boot** (`/harness-1-boot`): use `just build` before running built-CLI command tests. `UNAVAILABLE` is not expected in this CLI project but would fall back to standard testing.
- **Observe** (`harness-3-observe`): capture friction and command outputs in `execution.log.md` during implementation.
- **Retro** (`/harness-4-retro --drain`): drain session friction at the implementation seam if prompted; harvest at plan completion.
- **Best-effort**: harness steps are advisory and never block. If `docs/harness/.disabled` appears later, omit the harness loop and rely on focused tests plus `just fft`.

## Follow-ups Outside This Scope

| Follow-up | Why Deferred |
|-----------|--------------|
| Batch scheduler/fanout command | Explicit non-goal; this plan builds safer primitives first. |
| Multi-run tail/TUI streaming | Explicit non-goal; inventory/status plus explicit `--run` is enough for this phase. |
| Group stop/control | Explicit non-goal; write operations remain single-run and explicit. |
| Velocity metadata correction under overlapping completions | Real evidence gap, but not required for safe run visibility; avoid amplifying it in new surfaces. |
| SDK subprocess `MINIH_*` env propagation | Observed in smoke, but orthogonal to inventory/manifest UX unless a cheap sidecar falls naturally out of implementation. |

---

## Validation Record (2026-06-08)

### Validation Thesis

**Raison d'être**: This plan exists to turn parallel minih run smoke evidence and workshop decisions into an implementation-ready path for safer multi-run operation without adding batch orchestration.

**Value claim**: Parallel minih operation becomes safer, clearer, and more repeatable because operators/agents get first-class inventory/status, explicit target remedies, bounded labels/params summaries, and ambiguity guards.

**Artifact promise**: Implementation agents can build the feature with minimal clarification while preserving CLI/runner domain boundaries and the workshop's safety contract.

**Intended beneficiaries**: Minih operators, coding agents using minih, implementation agents, reviewers, and future batch/orchestration work.

**Proof target**: Implementation

**Evidence standard**: Source-code/domain match, concrete task paths, test-first tasks, command/error contracts, redaction rules, and explicit acceptance mapping.

**Thesis source**: Spec goals/non-goals/acceptance criteria, workshop 001 D1-D6, and `initial-evidence.md` smoke findings.

**Thesis verdict**: Advanced

**Main thesis risk**: Inventory rows may expose absolute `runDir` paths, quietly undercutting the dogfood "no run-dir file access" safety contract unless the implementation explicitly excludes/justifies the field.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|----------------|---------------------|--------|---------|
| Plan Coherence + Risk | Thesis Alignment, Evidence Sufficiency, Hidden Assumptions, Edge Cases & Failures, Performance & Scale, Deployment & Ops | Safety to Change, Operational Reliability, Evidence Sufficiency | 1 HIGH fixed; 4 MEDIUM/LOW open | VALIDATED WITH FIXES |
| Completeness + Testing Alignment | Evidence Sufficiency, Proof-Level Fit, System Behavior, Technical Constraints, Integration & Ripple, Test Boundary, Domain Boundaries | Implementation Readiness, Review Compression, Agent Readiness | 1 MAJOR/HIGH fixed; 3 MINOR/MEDIUM open | VALIDATED WITH FIXES |
| Thesis Alignment | Thesis Alignment, User/Product Value Preservation, Review Compression, Agent Readiness, Attention Reduction, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment, User/Product Value Preservation, Review Compression | 0 HIGH; 2 MEDIUM/LOW open | VALIDATED |
| Forward Compatibility + Domain/Contract Integrity | Forward-Compatibility, Domain Boundaries, Integration & Ripple, Contract Integrity, Security & Privacy, Deployment & Ops, Concept Documentation | Downstream Usefulness, Contract Integrity, Safety to Change | 0 HIGH; 4 MEDIUM/LOW open | VALIDATED WITH CAVEATS |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 implementation skill | Concrete ordered tasks, file paths, tests, constraints, TDD ordering | N/A | ✅ | T001-T017 include paths, done-when clauses, and test-first sequencing; validation fix added finding 07 plus connect/resume fixture requirements. |
| reviewers / future maintainers | Acceptance/evidence map, risk coverage, domain-boundary clarity | test boundary | ⚠️ | AC1-AC10, findings, risks, and domain manifest are present; an explicit AC-to-test crosswalk remains recommended. |
| CLI consumers / humans / agents | Implementable, documentable public command + error contracts | contract drift | ⚠️ | E108/E170/E171 reuse is grounded; validation fixed the connect/resume active-pre-scan ambiguity, but coordination E108-to-E170 migration should be made explicit during implementation. |
| future batch/orchestration work | Primitives without premature scheduler/group-control semantics | N/A | ✅ | Non-goals, AC9, and follow-ups fence out batch/fanout/group-stop/multi-run-tail work. |

### Open Medium/Low Validation Findings

| Severity | Finding | Recommended Follow-up |
|----------|---------|-----------------------|
| Medium | Public inventory/status `runDir` exposure is undecided and could undermine the dogfood rule. | During implementation, explicitly omit `runDir` from public rows or gate it behind debug-only behavior; add a negative envelope test. |
| Medium | Inventory scan bounds are underspecified: output limits do not necessarily bound filesystem scanning. | Specify newest-first bounded scanning and add a large-history fixture/read-bound test. |
| Medium | Params redaction needs a compound-key rule (`access_token`, `client_secret`, etc.). | Use case-insensitive substring/normalized containment matching and add compound-key tests. |
| Medium | Coordination ambiguity currently uses E108 and plan moves toward E170 without a migration note. | Add/update tests documenting intentional E108-to-E170 retirement for coordination ambiguity paths. |
| Low | AC-to-task/test traceability is inferable but not explicit. | Add an AC-to-test crosswalk before or during implementation. |
| Low | Velocity omission from inventory/status rows should be asserted. | Add a projection test that rows do not copy `CompletedMetadata.velocity`. |
| Low | AC8/AC9 negative checks are prose-only. | Add docs negative assertions for no direct run-dir guidance and CLI negative assertion for no `batch` command. |
| Low | Key-name-only redaction cannot catch secrets stored under benign keys. | Document limitation: params/labels are not a secret vault. |

**Thesis alignment**: Value claim advanced = Yes; Proof level Target = Implementation and Actual = Implementation; main thesis risk is accidental `runDir` exposure undermining the dogfood safety contract.

**Outcome alignment**: This plan faithfully advances the VPO Outcome — the spec's "Add core convenience for operating multiple minih runs without introducing batch orchestration" — by specifying exactly one implementation phase of visibility/safety primitives (inventory, bulk status, ambiguity guards, labels, bounded/redacted params summaries) with verified domain boundaries and reused error contracts, with the caveats above to close before it can be claimed fully drift-free.

**Standalone?**: No — downstream consumers include the plan-6 implementation skill, reviewers/future maintainers, CLI consumers/humans/agents, and future batch/orchestration work.

Overall: VALIDATED WITH FIXES
