# MiniH Harness Effectiveness Measurement

**Mode**: Full

## Research Context

📚 This specification incorporates findings from `research-dossier.md`.

The research and workshops establish that MiniH should measure value delivery through validated evidence, not through activity volume, code volume, prompt count, PR count, or individual productivity scoring. The core measurement thesis is:

```text
Hooks sense -> harness proves -> companion agents interpret -> DORA/ESSP/SPACE explain impact
```

The feature should inherit the spirit of DORA, Accelerate, SPACE, and ESSP without misusing them. DORA remains downstream delivery context. Accelerate supplies the capability-improvement lens. SPACE is the guardrail against single-metric productivity theater and individual surveillance. ESSP supplies the balanced operating shape: business/value outcomes supported by quality, velocity/flow, and developer happiness/trust.

The three completed workshops are authoritative inputs:

- `001-literature-traceability-matrix.md` defines how MiniH-local metrics map to DORA, SPACE, Accelerate, and ESSP, and requires local metrics to be described as "mapped to" or "aligned with" frameworks rather than falsely reported as framework-native metrics.
- `002-ethos-value-delivery-scorecard.md` defines the measurement ethos: calibrated learning, proof quality, flow, cognitive-load reduction, trust, and value delivery over productivity theater.
- `003-measurement-manifestation-surfaces.md` defines how the feature should manifest: runner-owned facts, proof contracts, CLI operator surfaces, special measurement agents, companion-mode interpretation, benchmark/probe catalogs, retros/difficulties/magic-wand ledgers, human pulse capture, exports/dashboards, and later DORA/ESSP integrations.

## Summary

MiniH should provide a local-first measurement capability that helps teams understand whether the harness is making valuable work easier to enter, safer to change, faster to prove, and more likely to compound into reusable capability.

The feature should expose a balanced scorecard around validated evidence, proof quality, flow/friction, encoded learning, human trust, and downstream delivery context. It should make facts inspectable through MiniH surfaces, use agents and companions only for cited interpretation, and preserve a clear boundary between factual telemetry, proof artifacts, human experience, and downstream outcome claims.

## Proof-Level Policy

MiniH should use an L0-L6 proof ladder for measurement. The default validated threshold should be:

- **L5** for setup, code-change, and benchmark/probe tasks where MiniH claims a real working state or change has been validated.
- **L4** for research, evidence-backed decision, and coordination tasks where the proof is a cited decision, validated contract, or coordination outcome rather than a product state change.
- **L6** only when MiniH claims reproducibility across a clean rerun or independent replay.

Lower proof levels may still be reported, but they must be labeled honestly as lower-confidence evidence and should not be counted as the default validated state for setup/change/benchmark scorecard claims.

## V1 Scope Decisions

The first implementation should be local-first and useful before downstream delivery-system integrations exist.

- **User-facing namespace**: Use `minih measure` for the first measurement command family.
- **Record placement**: Use per-run measurement/proof artifacts for provenance, plus project-level summaries or exports for cohort views.
- **Export posture**: Export redacted metadata by default, with provenance and redaction policy visible in the record.
- **Pulse posture**: Support team-level aggregate pulse capture/import only; do not create individual productivity views.
- **Benchmark catalogue**: Start with fresh setup, proof quality, failure recovery, and coordination scenarios.
- **DORA/ESSP integrations**: Defer DORA/ESSP delivery-system integrations out of the first implementation phase; keep the v1 scorecard local and show downstream status as unavailable/not configured.
- **False-pass candidates**: In v1, detect candidates from local later evidence such as subsequent validation failures, proof reruns, review notes, or manual proof audits.
- **Learning-loop output**: Measurement findings should create candidate mitigations or backlog items that require review before becoming encoded work.

## Goals

- Help operators and teams answer whether MiniH is reducing the time from intent to trustworthy evidence.
- Make proof quality visible so faster evidence does not become weaker evidence.
- Expose where work retries, waits, needs rescue, loses trust, or fails proof.
- Turn repeated friction, retrospectives, and magic-wand requests into an evidence-backed improvement backlog.
- Provide a balanced scorecard that includes hard signals, soft human signals, agent-assisted interpretation, and downstream delivery context.
- Preserve trust by avoiding individual productivity scoring, one-number productivity rankings, and unsupported causal claims.
- Let future architecture and implementation phase the work from local evidence to broader dashboards and DORA/ESSP integrations.

## Non-Goals

- Do not measure MiniH success by lines of code, PR count, prompt count, token count, or agent self-report alone.
- Do not create individual productivity scores, stack ranking, or surveillance-oriented views.
- Do not claim DORA or business-outcome causality until a causal evaluation method exists.
- Do not make dashboard visuals the source of truth; dashboards should project evidence contracts.
- Do not let measurement agents invent facts or proof levels without cited evidence.
- Do not infer human trust, flow, overload, or satisfaction solely from telemetry.
- Do not require downstream delivery-system integrations for the first useful local measurement slice.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| runner | existing | **modify** | Own factual measurement records, proof summaries, run-derived metrics, scorecard inputs, and learning-loop records that can be explained from evidence. |
| cli | existing | **modify** | Provide the user-facing measurement surfaces for inspecting runs, viewing scorecards, exporting records, invoking classification, checking measurement readiness, and running benchmark/probe flows. |
| adapter | existing | **consume** | Supply normalized agent/runtime events that can be used as factual inputs without making adapter responsible for metric interpretation. |
| mcp | existing | **consume** | Supply coordinated-agent state and inbox signals for companion-mode and inside/outside workflows without becoming a public measurement API. |
| measurement | **NEW** | **create** | Establish the conceptual domain for measurement vocabulary, metric definitions, traceability, proof levels, pulse data, benchmark catalogs, and reporting guardrails. |

### New Domain Sketches

#### measurement [NEW]

- **Purpose**: Own the language and contracts for evaluating MiniH harness effectiveness as value delivery through validated evidence. This domain defines what can be measured, how claims are qualified, and how local MiniH metrics map to DORA, SPACE, Accelerate, ESSP, and MiniH-local concepts.
- **Boundary Owns**: Metric catalogue, framework traceability levels, scorecard categories, proof-level vocabulary, benchmark catalogue semantics, pulse-question semantics, reporting caveats, authority model for facts vs interpretation, and guardrails against productivity theater.
- **Boundary Excludes**: Raw SDK event normalization belongs to `adapter`; run lifecycle and artifact persistence belong to `runner`; command UX belongs to `cli`; inside-agent coordination mechanics belong to `mcp`; downstream delivery systems remain external integrations.

### Domain Review

Confirmed for architecture planning. The new `measurement` domain should remain a conceptual contract/domain for vocabulary, metric traceability, proof levels, pulse semantics, benchmark semantics, and reporting guardrails. Implementation should still respect the existing topology: `cli -> {mcp, runner, adapter}`, `mcp -> runner`, `runner -> adapter`, with no upward imports.

## Complexity

**Score**: CS-5 (epic)

**Breakdown**: S=2, I=2, D=2, N=2, F=2, T=2

- **S=2 Surface Area**: Cross-cuts runner records, CLI reporting, existing retros/difficulties/harvest surfaces, agent packs, and future integrations.
- **I=2 Integration**: Local v1 can be internal, but the intended capability includes agent interpretation, benchmark/probe flows, human pulse import/export, and later GitHub/ADO/Jira/CI/deployment/incident integrations.
- **D=2 Data/State**: Requires durable records for measurement events, proof summaries, classifications, metric traceability, pulse aggregates, benchmark results, and learning-loop lifecycle.
- **N=2 Novelty**: The desired measurement ethos is clear, but proof-level semantics, pulse storage, privacy rules, false-pass detection, and causal evaluation still need design.
- **F=2 Non-Functional**: Trust, privacy, redaction, anti-surveillance, provenance, aggregation thresholds, and Goodhart resistance are core to acceptance.
- **T=2 Testing/Rollout**: Needs unit, integration, benchmark, classifier-validation, fixture, regression, and staged rollout checks across local and later integrated data.

**Confidence**: 0.82

**Assumptions**:

- The first implementation slice should be local-first and useful without external DORA integrations.
- The primary user value is knowing whether MiniH produces trustworthy evidence and compounding learning, not proving broad business causality immediately.
- CLI surfaces should be the operator contract; raw run artifacts may exist but should not be the supported way to inspect measurement.
- Agents and companions are interpretive workers and must cite evidence.
- Human experience metrics require explicit pulse input or imported aggregate data.

**Dependencies**:

- Phase 0 should establish or refresh the project harness contract in `docs/project-rules/harness.md`.
- A dedicated proof-level workshop should still operationalize the L0-L6 ladder with examples and required artifacts.
- Agreement on measurement event vocabulary and scorecard categories.
- A privacy/redaction position for prompts, logs, file paths, proof artifacts, and exported records.
- A classification output contract for measurement agents and companions.
- Benchmark catalogue definitions for the first repeatable scenarios.
- Later: external delivery-system definitions for DORA/ESSP integrations.

**Risks**:

- Metrics could drift into productivity theater if reporting rules are not encoded beside metric definitions.
- Proof-level labels could overclaim safety if artifact requirements are vague.
- Agent classifications could be mistaken for facts without evidence/citation rules.
- Soft metrics could create trust issues if captured too frequently, too individually, or without visible follow-through.
- DORA integrations could create misleading causal narratives if introduced before local leading measures stabilize.
- Multiple audiences may pressure the scorecard toward a single composite number.

**Phases**:

0. Establish or refresh the project harness contract so MiniH's own Boot -> Interact -> Observe loop is explicit before measurement implementation.
1. Define measurement vocabulary, proof levels, authority model, and scorecard categories.
2. Add local factual measurement records and proof summaries for MiniH runs.
3. Expose local inspect, scorecard, export, and readiness surfaces.
4. Add cited classifier-agent and companion-mode interpretation.
5. Add benchmark/probe catalogue support and difficulty/retro/magic-wand learning loops.
6. Add human pulse import/capture and privacy-safe aggregation.
7. Add optional downstream DORA/ESSP integrations and causal-evaluation reporting.

## Harness Readiness

`docs/project-rules/harness.md` now exists as the MiniH engineering harness contract. Phase 0 established the Boot -> Interact -> Observe loop before measurement implementation, so later phases should validate against that harness instead of treating harness readiness as missing.

## Testing Strategy

**Approach**: Hybrid

**Rationale**: The feature combines deterministic product behavior with interpretive agent workflows and planning/reporting surfaces. Deterministic contracts should be test-first or strongly fixture-driven; agent-assisted interpretation and human-facing reporting should use schema validation, golden examples, and targeted manual review where appropriate.

**Focus Areas**:

- Metric derivation, proof-summary rules, traceability metadata, and scorecard aggregation.
- CLI behavior, JSON envelopes, missing-data handling, and dogfood read paths.
- Measurement event records, export records, and privacy/redaction metadata.
- Classifier-agent output schema validation, evidence-citation requirements, and confidence/caveat handling.
- Benchmark/probe catalogue behavior and regression fixtures.
- Difficulty/retro/magic-wand learning-loop state transitions.

**Mock Usage**: Allow targeted mocks only at external or unstable boundaries, such as SDK/adapter sessions, downstream delivery-system integrations, survey import sources, and LLM/classifier invocations. Prefer real local fixtures for measurement records, proof summaries, CLI envelopes, exports, benchmark catalogues, and ledger transitions.

**Excluded**:

- No attempt to unit-test broad claims that MiniH caused downstream DORA or business outcomes without a later causal-evaluation design.
- No tests that treat LLM interpretation as deterministic fact; classifier outputs should be validated against schema, citations, and controlled fixtures.

## Documentation Strategy

**Approach**: Hybrid - README + `docs/how/`

**Rationale**: The feature needs quick-start discoverability for operators and deeper guidance for proof levels, scorecard interpretation, privacy, classifier evidence, and downstream caveats. The README should introduce the measurement surface and common commands. `docs/how/` should carry the detailed operating guidance and examples.

**Documentation Focus Areas**:

- Quick-start use of the measurement surface and the local-first scorecard.
- How to interpret Time to Validated Evidence, proof quality, difficulty half-life, intervention rate, and trust/pulse metrics.
- Reporting guardrails: no individual productivity scoring, no single composite score, no unsupported DORA causality.
- Proof-level and evidence-citation expectations.
- Privacy/redaction expectations for exports and classifier evidence.
- Benchmark/probe catalogue usage and anti-gaming guidance.

## Acceptance Criteria

1. A user can inspect a completed MiniH run and see factual measurement fields, validation status, proof summary, caveats, and available evidence without reading run-directory files directly.
2. A user can view a local balanced MiniH scorecard for a selected cohort/date range that includes value/evidence, proof quality, flow/friction, learning, trust/pulse status, and downstream integration status.
3. The scorecard clearly distinguishes missing data from zero values and labels downstream DORA/ESSP data as unavailable when integrations are not configured.
4. Every metric shown to users has traceability metadata that identifies whether it is direct literature, literature-aligned, a MiniH-local harness extension, or source-work-needed.
5. MiniH-local metrics are reported as "mapped to" or "aligned with" frameworks, not falsely described as framework-native DORA/SPACE/ESSP metrics.
6. The default validated threshold is L5 for setup/change/benchmark claims, L4 for research/coordination claims, and L6 only for reproducibility claims.
7. Measurement agents or companions can classify task intent, friction, proof quality, recurring difficulty, and framework mapping only when they cite evidence IDs or proof artifacts.
8. Agent or companion classifications are visibly marked as interpretive and never override runner-owned factual records.
9. A run or cohort can produce exportable measurement records suitable for later dashboards or data warehouses while preserving provenance and redaction metadata.
10. The feature captures or imports team-level human pulse data for proof trust, failure clarity, cognitive load, safer-to-change confidence, flow, and AI helpfulness without producing individual productivity reports.
11. The feature can identify repeated difficulties and encoded mitigations well enough to show recurrence, mitigation status, and whether a later run verified the mitigation.
12. Benchmark/probe results can be associated with scenarios such as fresh setup, proof quality, failure recovery, coordination, or legacy accessibility and compared over time by proof level.
13. Reporting surfaces prevent or explicitly discourage a single composite productivity score, individual rankings, and unsupported claims that MiniH caused downstream DORA or business outcomes.
14. If DORA/ESSP integrations are present, their source definitions, time range, and caveats are visible alongside local leading measures.
15. The first useful local slice works without GitHub Actions, ADO/Jira, deployment, incident, finance, or survey-system integrations.
16. Users can see how measurement findings feed retrospectives, difficulties, magic-wand items, or recommended encoded mitigations.
17. The first measurement command family is exposed as `minih measure`.
18. V1 benchmark/probe catalogues cover fresh setup, proof quality, failure recovery, and coordination scenarios.
19. Measurement findings create reviewable candidate mitigations or backlog items, not automatic noisy work.

## Risks & Assumptions

- **Risk: Goodhart's Law**. Any visible metric may become a target. Mitigation: report balanced metric tensions, provenance, proof quality, and caveats rather than a single score.
- **Risk: Trust erosion**. Operators may reject measurement if it feels like surveillance. Mitigation: team/system aggregation by default, no individual productivity scoring, explicit privacy/redaction rules, and visible feedback loops.
- **Risk: Weak proof semantics**. If "validated" is vague, the scorecard may reward shallow evidence. Mitigation: define proof levels before dashboarding them.
- **Risk: Agent overreach**. Companion classifications can look authoritative. Mitigation: require evidence IDs, confidence, caveats, and clear separation from facts.
- **Risk: Causal overclaiming**. DORA movement has many confounders. Mitigation: start with local capability claims and stage causal evaluation later.
- **Assumption: Local-first value**. Operators get value from local run evidence, proof summaries, and scorecards before downstream integrations exist.
- **Assumption: CLI-first access**. The supported operator path is through MiniH commands and JSON envelopes, not raw artifact spelunking.
- **Assumption: Human experience needs humans**. Pulse data or imported aggregate survey data is required for trust, flow, and cognitive-load claims.

## Open Questions

The critical product-scope questions have been clarified enough for architecture planning. Remaining questions should be handled as workshop or architecture details rather than blocking ambiguity:

1. What exact fields belong in the v1 measurement event envelope, and which existing run events map into them?
2. What redaction levels should exist beyond the v1 default redacted metadata posture?
3. What anti-gaming variants should each benchmark catalogue include?
4. What manual review workflow should promote a candidate mitigation into encoded work?
5. What later causal-evaluation method is credible when DORA/ESSP integrations are introduced?

## Clarifications

### Session 2026-05-09

1. **Workflow Mode**: Full Mode. This is a CS-5, cross-domain feature that needs multi-phase planning, required dossiers, and full quality gates.
2. **Testing Strategy**: Hybrid. Deterministic metric, proof, event, export, and CLI behavior should receive strong automated coverage; interpretive agent and human-facing scorecard behavior should use schema validation, fixtures, and targeted review.
3. **Mock Usage**: Allow targeted mocks at external/unstable boundaries only. Local measurement records, proof summaries, CLI envelopes, exports, benchmark catalogs, and ledger transitions should use real fixtures wherever practical.
4. **Documentation Strategy**: Hybrid README plus `docs/how/`. README should cover quick-start discovery and common commands; `docs/how/` should carry proof-level, scorecard, privacy, classifier, benchmark, and reporting guidance.
5. **Domain Review**: Confirmed as written. Keep `measurement` as a new conceptual domain while `runner`, `cli`, `adapter`, and `mcp` retain their existing import-direction boundaries.
6. **Harness Readiness**: Build harness as Phase 0. This is now satisfied by `docs/project-rules/harness.md`, which defines MiniH's engineering Boot -> Interact -> Observe contract before measurement surfaces are implemented.
7. **Proof-Level Policy**: Use an L0-L6 ladder. Default validated means L5 for setup/change/benchmark tasks, L4 for research/coordination tasks, and L6 only for reproducibility claims.
8. **V1 Scope Bundle**: Adopt the local-first defaults: `minih measure` namespace; per-run proof/measurement artifacts plus project-level summaries/exports; redacted metadata by default; aggregate pulse capture/import only; fresh setup/proof quality/failure recovery/coordination benchmark catalogues; no DORA integration in the first implementation phase; false-pass candidates from local later evidence; and reviewable candidate mitigations/backlog items rather than automatic work creation.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Proof-level semantics and validation examples | Data Model / Other | Prevents "validated" from overclaiming and gives the scorecard a trustworthy quality contract. | What do L0-L6 mean for setup, code change, research, failure recovery, and coordination? What artifacts are required at each level? |
| Measurement event model and metric registry | Data Model | The feature needs stable facts, traceability metadata, and caveats before scorecards or exports are trustworthy. | What is the event envelope? Which metrics are derived? How are framework mappings and caveats stored? |
| `minih measure` CLI flows | CLI Flow | The operator experience should be dogfooded through supported commands instead of run-file spelunking. | Which commands ship first? What do JSON envelopes contain? How are missing data and caveats displayed? |
| Measurement classifier and companion contracts | API Contract / Integration Pattern | Agents and companions must interpret evidence without becoming the authority. | What output schema is required? What counts as valid evidence? How are confidence, caveats, and citations enforced? |
| Benchmark/probe catalogue | State Machine / Data Model | Repeatable scenarios are needed to compare harness versions and prevent organic-run noise from dominating. | Which scenarios ship first? What scenario states exist? How are proof levels and anti-gaming variants represented? |
| Human pulse, privacy, redaction, and retention | Storage Design / Other | Human trust and flow require explicit input, and measurement will fail if it feels surveillant. | What data is captured? What is aggregated? What is redacted? How long is it retained? |
| Difficulty ledger and encoded mitigation lifecycle | State Machine | The system should prove that friction is dying, not just being counted. | When does a difficulty open, recur, merge, mitigate, verify, or close? How is half-life calculated? |
| DORA/ESSP downstream integration and causal evaluation | Integration Pattern | Downstream delivery claims need careful timing, source definitions, and caveats. | Which systems provide data? What can be claimed as correlation vs causation? What evaluation design is credible? |
