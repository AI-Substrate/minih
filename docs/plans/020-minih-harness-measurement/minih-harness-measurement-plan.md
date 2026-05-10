# MiniH Harness Effectiveness Measurement Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-05-10
**Spec**: [minih-harness-measurement-spec.md](./minih-harness-measurement-spec.md)
**Status**: DRAFT
**Mode**: Full
**Complexity**: CS-5 (epic) — S=2, I=2, D=2, N=2, F=2, T=2. CS-5 is the maximum tier; every dimension is intentionally saturated because the work spans runner facts, CLI surfaces, schemas, agent packs, privacy posture, benchmarks, pulse, and downstream contracts.

## Summary

MiniH needs a local-first measurement capability that shows whether the harness reduces friction, improves proof quality, and compounds learning without drifting into productivity theater. The plan builds this as layered product infrastructure: project harness contract first, measurement vocabulary and proof contracts second, runner-owned facts third, CLI operator surfaces fourth, then interpretive agents, benchmark catalogues, pulse aggregation, and optional downstream integrations. The source of truth remains deterministic MiniH evidence; agents and companions classify only with citations, and human experience remains aggregate human-provided data. The expected outcome is a trustworthy `minih measure` surface that can inspect runs, produce balanced scorecards, export redacted records, and feed improvement loops.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|--------------|------|
| runner | existing | modify | Own factual measurement records, proof summaries, metric derivation, run evidence, and learning-loop records that can be explained from evidence. |
| cli | existing | modify | Provide `minih measure` operator surfaces, JSON envelopes, scorecards, exports, benchmark commands, classification orchestration, and readiness checks. |
| adapter | existing | consume | Supply normalized runtime events through the existing `AgentEvent` contract; no metric interpretation belongs here. |
| mcp | existing | consume | Supply coordinated-agent state/inbox signals through existing runner-backed coordination files; no public measurement API belongs here. |
| measurement | new | create | Establish the conceptual contract for metric vocabulary, traceability, proof levels, benchmark semantics, pulse semantics, redaction, and reporting guardrails. |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|----------------|-----------|
| `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` | project-rules | contract | Documents MiniH's own Boot -> Interact -> Observe harness loop before measuring harness effectiveness. |
| `/Users/jordanknight/substrate/minih/docs/domains/measurement/domain.md` | measurement | contract | Defines the new conceptual domain boundary, concepts, contracts, and anti-surveillance guardrails. |
| `/Users/jordanknight/substrate/minih/docs/domains/registry.md` | measurement | cross-domain | Registers the conceptual measurement domain without changing existing import topology. |
| `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` | measurement | cross-domain | Adds measurement as a conceptual contract node and documents allowed flows to runner/cli/agents. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/types.ts` | runner | contract | Shared measurement/proof type contracts exported from runner for CLI consumption. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/authority.ts` | runner | contract | Encodes source-of-truth authority classes, redaction postures, missing-data vocabulary, and forbidden measurement views. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/proof-levels.ts` | runner | internal | Implements L0-L6 proof-level semantics and threshold helpers. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/metric-registry.ts` | runner | contract | Stores metric IDs, traceability levels, framework mappings, caveats, and reporting rules as code. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/events.ts` | runner | internal | Derives canonical measurement events from existing run metadata and adapter events. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/proof-summary.ts` | runner | internal | Builds per-run proof summaries with artifacts, supported level, limitations, and schema version. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/metrics.ts` | runner | internal | Computes deterministic metrics such as evidence time, retries, proof completeness, and interventions. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/scorecard.ts` | runner | internal | Aggregates local balanced scorecards and preserves missing-vs-zero semantics. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/redaction.ts` | runner | internal | Shapes export-safe records with redaction metadata and provenance. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/pulse.ts` | runner | internal | Reads and validates aggregate pulse records without individual productivity views. |
| `/Users/jordanknight/substrate/minih/src/runner/measurement/benchmark.ts` | runner | internal | Loads benchmark catalogue contracts and converts results to measurement records. |
| `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | runner | cross-domain | Emits measurement/proof artifacts during run finalization while preserving run lifecycle ownership. |
| `/Users/jordanknight/substrate/minih/src/runner/run-manifest.ts` | runner | cross-domain | Adds pointers to measurement/proof artifacts without turning `run.json` into the metric store. |
| `/Users/jordanknight/substrate/minih/src/runner/types.ts` | runner | contract | Exports measurement-related metadata types through existing runner contracts. |
| `/Users/jordanknight/substrate/minih/src/runner/index.ts` | runner | contract | Re-exports measurement contracts for CLI composition. |
| `/Users/jordanknight/substrate/minih/src/schemas/measurement-event.json` | runner | contract | Schema for runner-owned factual measurement events. |
| `/Users/jordanknight/substrate/minih/src/schemas/proof-summary.json` | runner | contract | Schema for proof summaries and L0-L6 support evidence. |
| `/Users/jordanknight/substrate/minih/src/schemas/measurement-scorecard.json` | runner | contract | Schema for balanced scorecard output. |
| `/Users/jordanknight/substrate/minih/src/schemas/measurement-classification.json` | cli | contract | Schema used by CLI classifier orchestration to validate cited interpretive output; measurement owns the semantics, not a runtime import layer. |
| `/Users/jordanknight/substrate/minih/src/schemas/pulse-aggregate.json` | runner | contract | Schema for runner-validated aggregate pulse records consumed by CLI surfaces; measurement owns the aggregate-pulse vocabulary. |
| `/Users/jordanknight/substrate/minih/src/schemas/benchmark-catalog.json` | runner | contract | Schema for runner-loaded benchmark catalogue definitions; measurement owns benchmark semantics and caveats. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/measure.ts` | cli | contract | Adds `minih measure` namespace and subcommands. |
| `/Users/jordanknight/substrate/minih/src/cli/index.ts` | cli | cross-domain | Registers the `measure` command group. |
| `/Users/jordanknight/substrate/minih/src/cli/output.ts` | cli | contract | Adds measurement-specific error codes and preserves JSON envelope discipline. |
| `/Users/jordanknight/substrate/minih/agents/measurement-classifier/prompt.md` | cli | contract | CLI-orchestrated agent pack prompt for evidence-cited classification; measurement supplies the authority rules. |
| `/Users/jordanknight/substrate/minih/agents/measurement-classifier/instructions.md` | cli | contract | CLI-orchestrated agent instructions for citation, confidence, caveats, and no-facts-from-prose rules. |
| `/Users/jordanknight/substrate/minih/agents/measurement-classifier/output-schema.json` | cli | contract | Validates classifier output before CLI surfaces it as interpretation. |
| `/Users/jordanknight/substrate/minih/agents/scorecard-synthesizer/prompt.md` | cli | contract | Optional CLI-orchestrated narrative synthesis agent over deterministic scorecard data. |
| `/Users/jordanknight/substrate/minih/agents/scorecard-synthesizer/output-schema.json` | cli | contract | Validates narrative scorecard interpretation before display/export. |
| `/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/benchmarks/fresh-setup.json` | runner | contract | V1 fresh setup benchmark catalogue loaded into runner-owned benchmark records. |
| `/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/benchmarks/proof-quality.json` | runner | contract | V1 proof quality benchmark catalogue loaded into runner-owned benchmark records. |
| `/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/benchmarks/failure-recovery.json` | runner | contract | V1 failure recovery benchmark catalogue loaded into runner-owned benchmark records. |
| `/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/benchmarks/coordination.json` | runner | contract | V1 coordination benchmark catalogue loaded into runner-owned benchmark records. |
| `/Users/jordanknight/substrate/minih/docs/how/measurement.md` | cli | contract | Detailed operating guide for measurement commands, proof levels, caveats, and privacy posture. |
| `/Users/jordanknight/substrate/minih/README.md` | cli | cross-domain | Adds quick-start discovery for `minih measure`. |
| `/Users/jordanknight/substrate/minih/test/runner/measurement/*.test.ts` | runner | internal | Unit and fixture coverage for measurement derivation, proof, scorecard, redaction, pulse, and benchmark helpers. |
| `/Users/jordanknight/substrate/minih/test/cli/measure.test.ts` | cli | internal | CLI command, JSON envelope, missing data, strict param, and export behavior coverage. |
| `/Users/jordanknight/substrate/minih/test/cli/measure-classify.test.ts` | cli | internal | Classifier orchestration and schema/citation validation coverage with targeted adapter mocks. |
| `/Users/jordanknight/substrate/minih/test/runner/schemas.test.ts` | runner | cross-domain | Extends existing schema coverage for measurement schemas. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | At plan discovery, the project had no `docs/project-rules/harness.md`, so measuring MiniH's harness before defining MiniH's own Boot -> Interact -> Observe loop would be circular. | Phase 0 now provides the harness contract and makes pre-phase validation explicit. |
| 02 | Critical | Runner-owned facts must remain the authority; agents can interpret but must not become the stopwatch or proof source. | Phases 1-2 define proof/measurement contracts and runner derivation before Phase 4 classifier agents. |
| 03 | High | Existing runner primitives already cover manifests, events, validation, artifacts, retro ledgers, atomic writes, and terminal drain behavior. | Extend `runner` measurement submodules and reuse atomic/ledger patterns instead of creating a parallel store. |
| 04 | High | Existing CLI surfaces already establish JSON envelopes, run lookup, validation, retros, difficulties, status, tail, and probe precedent. | Add `minih measure` as a CLI namespace that composes existing runner contracts and keeps operator reads out of raw run files. |
| 05 | High | `minih probe` already demonstrates scenario execution and truth-vs-claim aggregation. | Reuse probe-style orchestration for measurement benchmarks; create new catalogue semantics rather than a new execution engine. |
| 06 | High | Revalidating old runs can mutate `completed.json`, which would blur proof-at-run-time versus proof-under-current-schema. | Phase 2 writes immutable measurement snapshots with schema versions and avoids rewriting historical measurement semantics in-place. |
| 07 | High | Human pulse and raw event data can drift into individual telemetry if redaction and aggregation are not first-class. | Phases 1 and 6 encode redaction, aggregate pulse schemas, missing-data labels, and no individual productivity views. |
| 08 | High | Local harness metrics are literature-aligned, not framework-native DORA/SPACE/ESSP metrics. | Phase 1 creates a metric registry with traceability levels, caveats, and required "mapped to/aligned with" wording. |

## Harness Strategy

- **Current Maturity**: L2 — `docs/project-rules/harness.md` exists and defines MiniH's engineering Boot -> Interact -> Observe loop.
- **Target Maturity**: Maintain L2 for Phase 1; later phases may harden L3 evidence scripts.
- **Boot Command**: `just build`.
- **Health Check**: `minih doctor` plus the narrow test gate named in each phase dossier.
- **Interaction Model**: Terminal CLI with JSON envelopes on stdout and human-readable output on stderr.
- **Evidence Capture**: JSON envelopes, run metadata, validation output, test output, and documented proof artifacts.
- **Pre-Phase Validation**: Required at the start of every implementation phase: Boot -> Interact -> Observe.

## Phases

### Phase Index

| Phase | Title | Primary Domain | Objective | Depends On |
|-------|-------|----------------|-----------|------------|
| 0 | Build Harness Contract | project-rules | Define MiniH's own agent harness loop before measuring it. | None |
| 1 | Measurement Domain Contracts | measurement | Establish vocabulary, proof levels, metric traceability, schemas, and guardrails. | Phase 0 |
| 2 | Runner Measurement Facts | runner | Emit immutable local measurement/proof records from existing run evidence. | Phase 1 |
| 3 | CLI Measurement Surface | cli | Expose inspect, scorecard, export, and doctor flows through `minih measure`. | Phase 2 |
| 4 | Cited Interpretation Agents | measurement | Add classifier and synthesis agents that interpret only cited evidence. | Phase 3 |
| 5 | Benchmarks and Learning Loops | runner | Add benchmark catalogues and feed measurement findings into retros/difficulties/magic-wand loops. | Phase 4 |
| 6 | Human Pulse and Privacy | measurement | Support aggregate pulse capture/import with privacy-safe reporting. | Phase 3 |
| 7 | Downstream Integration Contracts | cli | Add optional DORA/ESSP integration status and caveated downstream correlation hooks. | Phases 5-6 |

---

### Phase 0: Build Harness Contract

**Objective**: Establish the project harness contract that every measurement phase can dogfood.
**Domain**: project-rules
**Delivers**:

- `docs/project-rules/harness.md` with Boot, Interact, Observe, evidence, and phase gate sections.
- Explicit MiniH dogfood paths for status, validation, retros, and run observation.
- Narrow gate matrix for CLI, runner, MCP, adapter, and measurement work.

**Depends on**: None
**Key risks**: A purely aspirational harness document would not improve execution. The document must name concrete commands and evidence surfaces already available in this repo.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 0.1 | Create harness contract | project-rules | `docs/project-rules/harness.md` exists and names Boot, Interact, Observe, evidence capture, and failure handling. | Per finding 01 |
| 0.2 | Document phase-entry validation | project-rules | Each target domain has a narrow validation gate and the full `just fft` gate remains the pre-commit/pre-push contract. | |
| 0.3 | Document dogfood read paths | project-rules | Harness contract tells agents to use MiniH CLI surfaces for run observation and retros rather than run-dir file reads. | |
| 0.4 | Verify harness loop | project-rules | A fresh agent can follow the harness doc to build, run a health check, and capture evidence without extra instructions. | |

### Phase 1: Measurement Domain Contracts

**Objective**: Define the measurement domain's language, schemas, traceability, proof levels, and guardrails before product surfaces depend on them.
**Domain**: measurement
**Delivers**:

- `docs/domains/measurement/domain.md`, registry entry, and domain-map update.
- L0-L6 proof-level contract with default thresholds from the spec.
- Metric registry with traceability levels, framework mappings, caveats, and reporting wording.
- JSON schemas for measurement events, proof summaries, scorecards, classifications, pulse aggregates, and benchmark catalogues.
- Redaction and authority-model rules.

**Depends on**: Phase 0
**Key risks**: A separate top-level source domain could violate the repo's import topology. Measurement remains a conceptual domain; implementation code lives under the owning runtime domains.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 1.1 | Refine measurement domain documentation | measurement | Domain doc, registry, and domain-map identify measurement as conceptual and preserve `cli -> {mcp, runner, adapter}`, `mcp -> runner`, `runner -> adapter`. | Ensure the domain doc keeps an explicit `## Concepts` section. |
| 1.2 | Define proof-level contract | measurement | L0-L6 levels have task-type examples, required artifacts, default thresholds, and honest lower-confidence labels. | Per findings 02, 08 |
| 1.3 | Add metric registry contract | runner | `metric-registry.ts` stores IDs, display names, traceability levels, framework mappings, source refs, and caveats. | |
| 1.4 | Add core measurement schemas | runner | All new schemas validate with existing AJV patterns and avoid MCP-incompatible schema constructs where MCP exposure could occur. | |
| 1.5 | Define authority and redaction rules | measurement | Facts, interpretation, human pulse, and downstream context each have a documented source of truth and export posture. | Per finding 07 |
| 1.6 | Add contract tests | runner | Schema and proof-level tests cover valid/invalid examples, missing citations, missing proof artifacts, and traceability wording. | |

### Phase 2: Runner Measurement Facts

**Objective**: Emit versioned, immutable per-run measurement and proof summaries from existing runner evidence.
**Domain**: runner
**Delivers**:

- Runner measurement event derivation from manifests, events, validation, artifacts, retros, and coordination snapshots.
- Per-run proof summary artifact with supported proof level, required/missing artifacts, limitations, and schema version.
- Deterministic local metrics for one run.
- Immutable measurement snapshot behavior that distinguishes proof-at-run-time from revalidation under current schemas.

**Depends on**: Phase 1
**Key risks**: Writing measurement artifacts too early could overclaim facts before validation completes. Finalization should write after existing output validation and artifact enumeration points.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 2.1 | Add measurement event derivation | runner | Runner can derive stable measurement events from run metadata and `AgentEvent` input without adapter changes. | Per findings 02, 03 |
| 2.2 | Add proof summary builder | runner | Completed runs receive a proof summary with level, artifacts, caveats, validation state, and redaction policy. | |
| 2.3 | Persist immutable measurement snapshots | runner | Measurement artifacts include schema version and do not rewrite historical proof semantics during later validation commands. | Per finding 06 |
| 2.4 | Add run-manifest pointers | runner | `run.json` can point to measurement/proof artifacts without duplicating the metric store. | |
| 2.5 | Add deterministic metric helpers | runner | Single-run metrics compute missing, zero, and unsupported values distinctly. | |
| 2.6 | Cover runner behavior with fixtures | runner | Tests cover completed, degraded, failed, timeout, coordination, and missing-data runs using local fixtures. | |

### Phase 3: CLI Measurement Surface

**Objective**: Make measurement inspectable through supported MiniH commands instead of raw artifact reads.
**Domain**: cli
**Delivers**:

- `minih measure` namespace.
- `inspect`, `scorecard`, `export`, and `doctor` subcommands.
- Strict parameter parsing and echoed resolved inputs for measurement commands.
- JSON envelopes on stdout and human-readable output on stderr.
- Missing-data and caveat rendering.

**Depends on**: Phase 2
**Key risks**: Measurement UX can accidentally create a dashboard-first or single-number product. CLI output must keep proof quality, caveats, and missing data visible beside any flow metric.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 3.1 | Register `minih measure` | cli | CLI help lists `measure`; command group returns standard envelopes and typed errors. | Per finding 04 |
| 3.2 | Implement `measure inspect` | cli | Users can inspect one run's measurement fields, proof summary, caveats, and evidence pointers without direct run-dir reads. | Covers [AC1] and [AC17]. |
| 3.3 | Implement `measure scorecard` | cli | Users can view local balanced scorecards with missing data distinct from zero and no composite productivity score. | Covers [AC2], [AC3], and [AC13]. |
| 3.4 | Implement `measure export` | cli | Exports redacted measurement records with provenance and redaction metadata. | Covers [AC9]. |
| 3.5 | Implement `measure doctor` | cli | Reports measurement readiness, missing schemas/artifacts, unsupported data, and caveats. | |
| 3.6 | Add CLI tests | cli | Tests cover envelopes, strict params, JSON output, human stderr, missing data, no raw-file UX, and error codes. | |

### Phase 4: Cited Interpretation Agents

**Objective**: Add agent and companion interpretation that can classify evidence without overriding runner-owned facts.
**Domain**: measurement
**Delivers**:

- `measurement-classifier` agent pack.
- Optional `scorecard-synthesizer` agent pack.
- `minih measure classify` orchestration through CLI.
- Schema validation requiring evidence IDs, confidence, caveats, and proof artifact references.
- Companion-mode review guidance for measurement/proof gaps.

**Depends on**: Phase 3
**Key risks**: Classifier output can appear factual. Every output must be visibly interpretive, schema-validated, and citation-gated.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 4.1 | Create measurement classifier agent | measurement | Agent pack includes prompt, instructions, schema, and examples that enforce no evidence IDs, no classification. | Covers [AC7] and [AC8]. |
| 4.2 | Add classification orchestration | cli | `measure classify` runs the classifier against exported evidence and validates output before surfacing it. | |
| 4.3 | Add scorecard synthesizer | measurement | Synthesizer consumes deterministic scorecard data and marks narrative output as interpretive with caveats. | |
| 4.4 | Add companion-mode proof guidance | measurement | Companion instructions explain live proof/friction review, review boundaries, and farewell retro measurement signal. | |
| 4.5 | Add tests with targeted mocks | cli | Tests use fake adapter/classifier fixtures and validate citation requirements, caveats, and failure modes. | |

### Phase 5: Benchmarks and Learning Loops

**Objective**: Make harness improvement comparable and connect repeated friction to reviewable mitigations.
**Domain**: runner
**Delivers**:

- Benchmark catalogue schemas and V1 catalogues for fresh setup, proof quality, failure recovery, and coordination.
- `minih measure benchmark` or equivalent composition over existing probe-style machinery.
- Difficulty/retro/magic-wand measurement links.
- False-pass candidate detection from local later evidence.
- Reviewable candidate mitigation output.

**Ownership split**:

| Concern | Owning Domain | Boundary |
|---------|---------------|----------|
| Benchmark catalogue semantics, proof requirements, and anti-gaming vocabulary | measurement | Conceptual contract only; no runtime import layer. |
| Benchmark command UX and probe-style orchestration | cli | User-facing command composition and JSON envelope behavior. |
| Benchmark outcomes, mitigation links, and false-pass candidates | runner | Runner-owned records derived from local evidence. |

**Depends on**: Phase 4
**Key risks**: Benchmarks can be gamed if scenarios are too static or shallow. Catalogues must include proof requirements and anti-gaming variants.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 5.1 | Add benchmark catalogue schemas and files | runner | Four V1 catalogues validate and declare scenarios, proof requirements, caveats, and anti-gaming variants while following measurement semantics. | Covers [AC12] and [AC18]. |
| 5.2 | Reuse probe-style orchestration | cli | Benchmark command reuses existing scenario/truth aggregation patterns where practical. | Per finding 05 |
| 5.3 | Emit benchmark measurement records | runner | Benchmark outcomes attach proof level, scenario, catalog version, and comparable metric fields. | |
| 5.4 | Link measurement to difficulties and retros | runner | Repeated friction can create evidence-backed difficulty candidates and magic-wand references. | AC11, AC16 |
| 5.5 | Add false-pass candidates | runner | Later local failures, proof reruns, review notes, or manual audits can mark reviewable false-pass candidates. | |
| 5.6 | Add benchmark and ledger tests | runner | Tests cover catalog validation, benchmark output, recurrence, mitigation candidate state, and false-pass candidate evidence. | |

### Phase 6: Human Pulse and Privacy

**Objective**: Capture team/system-level human trust and flow signals without creating individual productivity views.
**Domain**: measurement
**Delivers**:

- Aggregate pulse schema and local import/capture helpers.
- `minih measure pulse` subcommands for record/import/summary if adopted during implementation.
- Privacy and redaction docs for prompts, logs, file paths, proof artifacts, exports, and pulse data.
- Trust calibration display beside proof quality and false-pass candidates.

**Depends on**: Phase 3
**Key risks**: Soft metrics will fail if they feel surveillant or if response-rate/provenance context is missing. V1 must aggregate by default and avoid individual reporting.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 6.1 | Add pulse aggregate contract | measurement | Pulse schema supports aggregate proof trust, failure clarity, cognitive load, safer-to-change confidence, flow, and AI helpfulness. | Covers [AC10]. |
| 6.2 | Add pulse import/capture surface | cli | Users can record/import aggregate pulse data without individual productivity fields. | |
| 6.3 | Integrate pulse into scorecard | cli | Scorecard shows pulse status, missing data, source, response context, and caveats. | |
| 6.4 | Document privacy posture | cli | `docs/how/measurement.md` explains redaction, aggregation, retention posture, and forbidden reporting. | |
| 6.5 | Add privacy tests | cli | Tests prevent individual fields in pulse exports and verify redacted default output. | |

### Phase 7: Downstream Integration Contracts

**Objective**: Add optional downstream delivery context without claiming unsupported causality.
**Domain**: cli
**Delivers**:

- Integration status model for DORA/ESSP sources.
- Source definition contracts for GitHub/CI/deployment/incident/work-item systems.
- Scorecard downstream section that reports not configured, configured, unavailable, or caveated.
- Causal-evaluation caveat wording and source-version display.

**Ownership split**:

| Concern | Owning Domain | Boundary |
|---------|---------------|----------|
| Downstream source definitions and causal caveat semantics | measurement | Conceptual contract and forbidden-causality wording only. |
| Import hooks, status display, and JSON envelopes | cli | User-facing optional integration surfaces. |

**Depends on**: Phases 5-6
**Key risks**: DORA/ESSP data can be over-attributed to MiniH. This phase must present downstream outcomes as context/correlation unless a causal evaluation design is explicitly configured.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 7.1 | Define downstream source contracts | measurement | Source definitions include source type, range, version, caveats, and data availability state. | AC14 |
| 7.2 | Add integration status display | cli | Scorecard reports downstream status as unavailable/not configured when integrations are absent. | Covers [AC3] and [AC15]. |
| 7.3 | Add optional import hooks | cli | Users can import downstream summaries without requiring external integrations for local scorecards. | |
| 7.4 | Add causal caveat rules | measurement | Reports distinguish local leading capability claims from downstream correlation and causal claims. | |
| 7.5 | Add integration contract tests | cli | Tests cover absent integrations, imported summaries, caveats, source versions, and forbidden causality wording. | |

## Acceptance Criteria

- [ ] [AC1] A user can inspect a completed MiniH run and see factual measurement fields, validation status, proof summary, caveats, and available evidence without reading run-directory files directly.
- [ ] [AC2] A user can view a local balanced MiniH scorecard for a selected cohort/range that includes value/evidence, proof quality, flow/friction, learning, trust/pulse status, and downstream integration status.
- [ ] [AC3] The scorecard clearly distinguishes missing data from zero values and labels downstream DORA/ESSP data as unavailable when integrations are not configured.
- [ ] [AC4] Every metric shown to users has traceability metadata that identifies whether it is direct literature, literature-aligned, a MiniH-local harness extension, or source-work-needed.
- [ ] [AC5] MiniH-local metrics are reported as "mapped to" or "aligned with" frameworks, not falsely described as framework-native DORA/SPACE/ESSP metrics.
- [ ] [AC6] The default validated threshold is L5 for setup/change/benchmark claims, L4 for research/coordination claims, and L6 only for reproducibility claims.
- [ ] [AC7] Measurement agents or companions can classify task intent, friction, proof quality, recurring difficulty, and framework mapping only when they cite evidence IDs or proof artifacts.
- [ ] [AC8] Agent or companion classifications are visibly marked as interpretive and never override runner-owned factual records.
- [ ] [AC9] A run or cohort can produce exportable measurement records suitable for future dashboards or data warehouses while preserving provenance and redaction metadata.
- [ ] [AC10] The feature captures or imports team-level human pulse data for proof trust, failure clarity, cognitive load, safer-to-change confidence, flow, and AI helpfulness without producing individual productivity reports.
- [ ] [AC11] The feature can identify repeated difficulties and encoded mitigations well enough to show recurrence, mitigation status, and whether a subsequent run verified the mitigation.
- [ ] [AC12] Benchmark/probe results can be associated with scenarios such as fresh setup, proof quality, failure recovery, or coordination and compared by proof level.
- [ ] [AC13] Reporting surfaces prevent or explicitly discourage a single composite productivity score, individual rankings, and unsupported claims that MiniH caused downstream DORA or business outcomes.
- [ ] [AC14] If DORA/ESSP integrations are present, their source definitions, range, and caveats are visible alongside local leading measures.
- [ ] [AC15] The first useful local slice works without GitHub Actions, ADO/Jira, deployment, incident, finance, or survey-system integrations.
- [ ] [AC16] Users can see how measurement findings feed retrospectives, difficulties, magic-wand items, or recommended encoded mitigations.
- [ ] [AC17] The first measurement command family is exposed as `minih measure`.
- [ ] [AC18] V1 benchmark/probe catalogues cover fresh setup, proof quality, failure recovery, and coordination scenarios.
- [ ] [AC19] Measurement findings create reviewable candidate mitigations or backlog items, not automatic noisy work.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Metrics become targets and invite gaming | Medium | High | Keep proof quality, caveats, missing data, and healthy tensions visible; forbid single composite productivity scores. |
| Measurement feels like surveillance | Medium | High | Aggregate pulse data, redact exports by default, and forbid individual productivity views. |
| Proof levels overclaim safety | Medium | High | Require explicit artifacts and limitations per proof level before scorecarding proof metrics. |
| Agent classifications appear factual | Medium | High | Require evidence IDs, confidence, caveats, and clear interpretive labels; never override runner-owned facts. |
| Runner measurement writes destabilize run finalization | Low | High | Reuse existing atomic write, manifest, and finalization patterns; add fixture coverage for terminal states. |
| Historical validation rewrites measurement meaning | Medium | High | Store schema-versioned measurement snapshots and distinguish current revalidation from original proof state. |
| DORA/ESSP integrations imply causality too early | Medium | High | Defer integrations behind local scorecards and label downstream outcomes as contextual unless causal design exists. |
| Benchmark catalogues become too tailored | Medium | Medium | Version catalogues and include anti-gaming variants and proof requirements. |

## Readiness Gates

| Gate | Required Before | Evidence |
|------|-----------------|----------|
| Harness gate | Phase 1 | `docs/project-rules/harness.md` exists and Boot -> Interact -> Observe succeeds. |
| Contract gate | Phase 2 | Measurement schemas, proof levels, metric registry, and domain docs are reviewed. |
| Fact gate | Phase 3 | Runner emits local measurement/proof records for representative terminal states. |
| UX gate | Phase 4 | `minih measure inspect/scorecard/export/doctor` expose JSON envelopes and missing-data semantics. |
| Interpretation gate | Phase 5 | Classifier outputs fail validation without evidence IDs and caveats. |
| Privacy gate | Phase 6 | Export and pulse tests prove redacted aggregate defaults. |
| Downstream gate | Phase 7 | Integration outputs include source definitions and causality caveats. |

## Next Steps

Phase 0's engineering harness gate is satisfied. Validate the Phase 1 dossier, then run `/plan-6-v2-implement-phase --phase "Phase 1: Measurement Domain Contracts"` for implementation.

---

## Validation Record (2026-05-10)

### Validation Thesis

**Raison d'être**: Turn a clarified CS-5 spec and three authoritative workshops into an implementation-ready, domain-aware phase plan for local-first MiniH harness effectiveness measurement.

**Value claim**: Future implementation agents, reviewers, and operators should have a clearer, safer, more repeatable path for building `minih measure` without drifting into productivity theater, unsupported proof claims, or domain-boundary violations.

**Artifact promise**: The plan provides phases, task ownership, file placement, success criteria, risks, and gates sufficient to guide `/plan-5` dossiers and later implementation.

**Intended beneficiaries**: Implementation agents, code reviewers, MiniH maintainers, downstream phase planners, and operators who will consume `minih measure`.

**Proof target**: Implementation.

**Evidence standard**: Alignment with the spec, research dossier, workshops, domain registry/map, phase task tables, domain manifest, acceptance criteria, and readiness gates.

**Thesis source**: `minih-harness-measurement-spec.md`, `research-dossier.md`, workshops 001-003, and the user request for `/plan-3`, `/plan-4`, high-finding fixes, and validation.

**Thesis verdict**: Advanced.

**Main thesis risk**: Phase ownership boundaries could blur implementation responsibility across runner, cli, and measurement if future dossiers ignore the ownership splits added during validation.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Plan Coherence | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, Integration & Ripple, Hidden Assumptions, Domain Boundaries, Concept Documentation, Technical Constraints | Implementation Readiness, Review Compression, Cross-Domain Coordination, Learning Compounding | 1 MEDIUM fixed, 1 LOW fixed | Pass after fixes |
| Plan Risk/Evidence | Evidence Sufficiency, Security & Privacy, Edge Cases & Failures, Deployment & Ops, Performance & Scale, Hidden Assumptions, System Behavior, Technical Constraints, Thesis Alignment | Evidence Sufficiency, Proof-Level Fit, Operational Reliability, Security & Privacy, User/Product Value Preservation | 0 | Pass |
| Plan Completeness/Domain | Domain Boundaries, Concept Documentation, Integration & Ripple, Technical Constraints, Deployment & Ops, Evidence Sufficiency, Proof-Level Fit, Hidden Assumptions, Thesis Alignment | Contract Integrity, Cross-Domain Coordination, Implementation Readiness, Agent Readiness | 1 HIGH fixed, 1 MEDIUM fixed | Pass after fixes |
| Forward Compatibility | Forward-Compatibility, Integration & Ripple, Domain Boundaries, Test Boundary, Contract Integrity, Evidence Sufficiency, Thesis Alignment, Hidden Assumptions, Technical Constraints | Downstream Usefulness, Implementation Readiness, Contract Integrity, Cross-Domain Coordination | 0 | Pass |
| Patch Recheck | Domain Boundaries, CS score plausibility, Concept Documentation, Forward-Compatibility | Contract Integrity, Downstream Usefulness, Implementation Readiness | 0 | Pass |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-5-v2-phase-tasks-and-brief` for Phase 0 | Phase 0 task table, dependencies, success criteria, and domain/file context | Shape mismatch | ✅ | Phase 0 includes task table, dependencies, success criteria, and domain context. |
| Phase 1 implementation dossier | Measurement domain setup, proof levels, metric registry, schemas, and guardrails | Shape mismatch | ✅ | Phase 1 includes measurement docs, proof levels, metric registry, core schemas, authority/redaction rules, and contract tests. |
| Phase 2 runner implementation dossier | Runner-owned fact boundaries and artifact contracts | Encapsulation lockout | ✅ | Phase 2 defines runner derivation, proof summaries, immutable snapshots, manifest pointers, metrics, and fixtures. |
| Phase 3 CLI implementation dossier | `minih measure` command scope, JSON envelopes, and missing-data requirements | Contract drift | ✅ | Phase 3 defines inspect, scorecard, export, doctor, strict parsing, envelope behavior, missing-data semantics, and CLI tests. |
| Later review/validation agents | Acceptance criteria, risks, and readiness gates | Test boundary | ✅ | Acceptance criteria, risks, readiness gates, and validation records are explicit and reviewable. |

**Thesis alignment**: Value claim advanced? Yes; Proof level: Target = implementation, Actual = implementation-ready plan; Main thesis risk: A few phase ownership boundaries could still blur implementation responsibility across runner/cli/measurement.

**Outcome alignment**: The patched plan advances “MiniH should provide a local-first measurement capability that helps teams understand whether the harness is making valuable work easier to enter, safer to change, faster to prove, and more likely to compound into reusable capability” by turning it into domain-owned phases, contracts, and gates that preserve local-first facts, proof quality, CLI access, cited interpretation, and privacy guardrails.

**Standalone?**: No — downstream `/plan-5` phase dossiers, implementation agents, and review/validation agents depend on this plan's shape.

Overall: VALIDATED WITH FIXES
