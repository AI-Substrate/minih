# Domain: measurement

**Purpose**: Defines the vocabulary and contracts for evaluating MiniH harness effectiveness as value delivery through validated evidence.

Measurement is a conceptual contract domain. It defines what MiniH may measure, how claims are qualified, how local metrics map to DORA/SPACE/Accelerate/ESSP, and which reporting guardrails prevent productivity theater. Runtime implementation stays inside the owning domains: runner owns deterministic facts, CLI owns operator surfaces, and agents/companions provide cited interpretation.

## Boundary

**Owns**: Metric catalogue, framework traceability levels, scorecard categories, proof-level vocabulary, benchmark catalogue semantics, pulse-question semantics, reporting caveats, fact-vs-interpretation authority model, redaction posture, and anti-surveillance guardrails.

**Excludes**: Raw SDK event normalization (adapter), run lifecycle and artifact persistence (runner), command UX and JSON envelopes (cli), inside-agent coordination mechanics (mcp), and downstream delivery-system integrations until explicitly configured.

## Composition

Planned runtime files live in their owning domains; measurement defines the semantics and guardrails they implement.

| File | Classification | Purpose |
|------|----------------|---------|
| `docs/domains/measurement/domain.md` | contract | Conceptual measurement boundary and contracts |
| `src/runner/measurement/types.ts` | contract | Measurement, proof, authority, redaction, and metric types consumed by CLI |
| `src/runner/measurement/authority.ts` | contract | Authority classes, redaction postures, missing-data vocabulary, and forbidden measurement views |
| `src/runner/measurement/metric-registry.ts` | contract | Metric IDs, traceability levels, framework mappings, and caveats |
| `src/runner/measurement/proof-levels.ts` | contract | L0-L6 proof-level helpers and threshold rules |
| `src/schemas/measurement-event.json` | schema contract | Factual measurement event schema |
| `src/schemas/proof-summary.json` | schema contract | Proof summary and artifact inventory schema |
| `src/schemas/measurement-classification.json` | cli schema contract | Evidence-cited classifier output schema |
| `src/schemas/measurement-scorecard.json` | schema contract | Balanced local scorecard schema |
| `src/schemas/pulse-aggregate.json` | runner/cli schema contract | Team/system aggregate pulse schema |
| `src/schemas/benchmark-catalog.json` | runner schema contract | Benchmark catalogue schema |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| Proof ladder L0-L6 | Vocabulary | runner proof summaries, CLI scorecards, classifier agents |
| Metric traceability levels | Vocabulary | metric registry, scorecard output, docs |
| Authority model | Rule set | runner, cli, measurement agents, companions |
| Redaction posture | Rule set | exports, scorecards, classifier evidence bundles |
| Forbidden measurement views | Rule set | scorecards, exports, classifier evidence bundles |
| Benchmark catalogue semantics | Schema/concept | `minih measure benchmark`, runner benchmark records |
| Pulse aggregate semantics | Schema/concept | `minih measure pulse`, scorecards, exports |

## Authority Model

| Signal Class | Source of Truth | May Interpret | Export Posture |
|--------------|-----------------|---------------|----------------|
| Runner-owned facts | Runner-derived evidence such as manifests, events, validations, artifacts, retros, difficulties, coordination snapshots, and benchmark results. | CLI may render; agents may cite. | Exportable with schema version, evidence IDs, provenance, and redaction metadata. |
| Interpretive classifications | Agent or companion output that cites runner facts or proof artifacts. | Agents and companions only. | Exportable only when visibly marked interpretive with confidence, rationale, caveats, and evidence references. |
| Human pulse | Explicit team/system aggregate input or imported aggregate summaries. | CLI may summarize; agents may cite aggregates. | Aggregate-only by default; no individual productivity fields, stack rankings, or inferred sentiment from telemetry. |
| Downstream context | Optional external summaries such as DORA/ESSP data with visible source definitions. | CLI may show as context; agents may cite with caveats. | Unavailable/not configured until explicitly provided; no unsupported causal claims. |

Runner-owned facts can support interpretation, but interpretation cannot replace or correct them. The implemented `MEASUREMENT_AUTHORITY_CONTRACTS` keeps `canOverrideRunnerFacts: false` for every authority class, including interpretations. Missing data is a first-class state and must not be coerced to zero.

## Concepts

| Concept | Definition |
|---------|------------|
| Runner-owned fact | A factual measurement value derived from MiniH runtime evidence such as manifests, events, validation results, artifacts, coordination snapshots, or ledgers. Agents do not create these facts. |
| Interpretive classification | Agent or companion output that labels task intent, friction, proof quality, recurrence, or framework mapping with evidence IDs, confidence, rationale, and caveats. It never overrides runner-owned facts. |
| Proof level | A local L0-L6 evidence-strength label. L5 is the default validated threshold for setup/change/benchmark claims, L4 for research/coordination claims, and L6 only for reproducibility claims. |
| Metric traceability | Metadata that explains whether a metric is direct literature, literature-aligned, a MiniH-local harness extension, or source-work-needed. |
| Balanced scorecard | A local view that keeps value/evidence, proof quality, flow/friction, learning, trust/pulse, and downstream context separate. It is not a composite productivity score. |
| Missing data | A first-class state distinct from zero. Missing pulse data, absent DORA integration, or unsupported proof evidence must be displayed as unavailable or not configured. |
| Aggregate pulse | Team/system-level human feedback about proof trust, failure clarity, cognitive load, safer-to-change confidence, flow, and AI helpfulness. Individual productivity views are out of scope. |
| False-pass candidate | A passed proof later contradicted by local evidence such as later validation failures, proof reruns, review notes, or manual proof audits. It is reviewable, not automatically adjudicated. |
| Reviewable mitigation | A candidate improvement generated from repeated friction or measurement findings. It requires human review before becoming encoded work. |
| Forbidden measurement view | A reporting shape MiniH must reject: composite productivity score, individual productivity score, inferred sentiment from telemetry, stack ranking, or unsupported causal claim. |

## Traceability Levels

| Level | Name | Meaning | Reporting Wording |
|-------|------|---------|-------------------|
| L1 | Direct Literature | Metric or principle appears directly in the local source corpus. | "from" the named framework only when the source version is cited. |
| L2 | Literature-Aligned | Metric operationalizes a literature dimension or principle but is not named directly. | "aligned with" the framework dimension. |
| L3 | Local Harness Extension | Metric is invented for MiniH harness measurement and intentionally maps to framework concepts. | "MiniH-local" and "mapped to" framework concepts. |
| L4 | Needs Source Work | Claim depends on missing or incomplete source material. | "source-work-needed"; do not present as supported. |

MiniH-local L2/L3 metrics must not be described as DORA/SPACE/ESSP-native metrics.

## Dependencies

### This Domain Depends On

| Domain | Contract Used |
|--------|---------------|
| runner | Run evidence, manifests, validation, artifacts, retros, difficulties, coordination snapshots |
| cli | JSON envelope and operator command conventions |
| adapter | Normalized event contracts, consumed through runner |
| mcp | Coordination state/inbox evidence, consumed through runner-owned files |

### Domains That Depend On This

| Domain | Contract Used |
|--------|---------------|
| runner | Proof levels, measurement schemas, metric registry, redaction rules |
| cli | Scorecard categories, command semantics, missing-data rules, reporting guardrails |
| agents | Classification schema, evidence-citation rules, caveats |

## Guardrails

- Do not report individual productivity scores, stack rankings, or surveillance views.
- Do not collapse measurement into a single composite productivity number.
- Do not describe MiniH-local metrics as DORA/SPACE/ESSP-native metrics; use "mapped to" or "aligned with" unless the metric is directly from the framework.
- Do not let agent or companion output create facts without cited evidence.
- Do not infer trust, flow, overload, or satisfaction solely from telemetry.
- Do not claim MiniH caused downstream DORA or business outcomes without an explicit causal-evaluation design.
- Do not export records without provenance and redaction metadata when they can leave the local run context.
- Do not export pulse aggregates below the minimum group size of five; under-threshold pulse data is suppressed, not redacted into an individual view.

## Tests & Validation

| Area | Planned Tests |
|------|---------------|
| Proof levels and thresholds | `test/runner/measurement/proof-levels.test.ts` |
| Metric registry and traceability wording | `test/runner/measurement/metric-registry.test.ts` |
| Authority and redaction constants | `test/runner/measurement/authority-contracts.test.ts` |
| Measurement schemas | `test/runner/schemas.test.ts` |
| CLI scorecard missing-data rules | `test/cli/measure.test.ts` |
| Classifier evidence citation | `test/cli/measure-classify.test.ts` |

## History

| Phase | Changes |
|-------|---------|
| 020 planning | Created conceptual domain contract for MiniH harness effectiveness measurement. |
| 020 Phase 1 | Clarified authority model, traceability levels, and redaction guardrails for implementation contracts. |
| 020 Phase 1 T009 | Encoded authority/redaction constants, forbidden measurement views, and aggregate-only pulse threshold. |
