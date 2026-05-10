# Workshop: Literature Traceability Matrix

**Type**: Data Model / Measurement Design  
**Plan**: `020-minih-harness-measurement`  
**Spec**: Not yet created  
**Created**: 2026-05-07T08:30:11+10:00  
**Status**: Draft

**Related Documents**:
- [`../research-dossier.md`](../research-dossier.md)
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/sources/frameworks/source-index.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/04-beyond-dora.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/10-three-layers.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/11-hookability-matrix.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/plans/003-source-literature-framework-corpus/research-dossier.md`

---

## Purpose

This workshop turns the MiniH measurement scorecard into a traceable literature matrix. It clarifies which metrics are directly grounded in DORA, SPACE, Accelerate, or ESSP, which are local harness-measurement extensions, and which claims need caveats because the primary source is not stored locally.

## Key Questions Addressed

- Which MiniH metrics map to DORA, SPACE, Accelerate, and ESSP?
- Which metrics are directly present in the literature versus locally derived for harness measurement?
- Which claims need a source caveat because the evidence lives in the full Accelerate book or current DORA sources?
- What traceability shape should implementation use so every metric can explain its provenance?

---

## Source Corpus Baseline

The framework corpus used for this workshop is in `/Users/jordanknight/repos/Measuring-HVE/docs/articles/sources/frameworks/`. The source index says every stored artifact should have an indexable markdown surface; it also explicitly says books should not be stored as full text unless rights are confirmed (`source-index.md:6-12`).

| Source ID | Framework(s) | Local Evidence | Use in Matrix | Caveat |
|---|---|---|---|---|
| `dora-metrics-guide-2026` | DORA | `summary.md:12-22`, `raw.md:37-43`, `raw.md:60-69`, `raw.md:83-115` | Delivery-performance definitions, pitfalls, continuous-improvement loop | Current local DORA guide uses five metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate, deployment rework rate. |
| `dora-research` | DORA | `summary.md:8-18`, `raw.md:29-37`, `raw.md:41-58` | Core model, capabilities/metrics/outcomes, AI as sociotechnical amplifier | Use with current guide for metric definitions; research archive is a hub, not a detailed metric spec. |
| `space-developer-productivity-2021` | SPACE | `summary.md:8-31`, `raw.md:204-216` | Anti-single-metric framing; five productivity dimensions | Local `raw.md` is a locator/abstract snapshot, not the full ACM paper. |
| `github-essp-2025` | ESSP, SPACE, DORA | `summary.md:9-48`, `raw.md:55-68`, `raw.md:96-113`, `raw.md:118-142`, `raw.md:144-178`, `raw.md:224-256`, `raw.md:260-340`, `raw.md:342-423`, `raw.md:425-520`, `raw.md:570-605` | Operating model, zones, 12 metrics, leading/lagging/companion guidance, survey/telemetry mix | Strongest local primary source for ESSP; use as the operational scorecard anchor. |
| `accelerate-2018` | Accelerate, DORA | `summary.md:10-28`, `raw.md:262-292`, `raw.md:317-338` | Scientific lineage: capabilities drive performance; business-value framing | Full book text is not stored. For page-specific claims, add licensed reader notes with page references. |
| `05-dora-space-accelerate-deep-reference.md` | DORA, SPACE, Accelerate | `:10-18`, `:135-215`, `:520-610` | Authored synthesis used when primary source text is unavailable or too sparse | Treat as repo-authored synthesis, not primary literature. |

## Traceability Levels

Use these levels when adding metrics to MiniH documentation or implementation:

| Level | Meaning | Example |
|---|---|---|
| **L1 Direct Literature** | Metric or principle appears directly in local source corpus. | DORA change lead time; ESSP flow state experience. |
| **L2 Literature-Aligned** | Metric is not named directly, but is a clear operationalization of a literature dimension or principle. | Time to Verified Working Context as SPACE Efficiency/Flow + ESSP leading indicator. |
| **L3 Local Harness Extension** | Metric is invented in the repo for harness measurement but intentionally maps to framework concepts. | L5+ proof share; false-pass rate; difficulty half-life. |
| **L4 Needs Source Work** | Claim depends on source material not fully stored locally or needs stronger external/source notes. | Specific Accelerate capability causality details by page; historical DORA reliability formulation. |

Implementation should not report L2/L3 metrics as "from SPACE" or "from DORA." It should say "mapped to" or "aligned with."

## Literature Traceability Matrix

### A. MiniH North-Star and Access Metrics

| MiniH Metric | Traceability | Literature Anchor | Local Harness Anchor | How to Phrase It | Caveat |
|---|---|---|---|---|---|
| Time to Validated Evidence | L3 Local Harness Extension | ESSP says use leading indicators near friction points and complement downstream metrics (`github-essp-2025/raw.md:224-243`); DORA says use specific leading indicators for improvement plans (`dora-metrics-guide-2026/raw.md:107-115`); SPACE rejects single activity metrics (`space-developer-productivity-2021/raw.md:214-216`). | Defined as the elapsed time from question/task/change idea to trustworthy evidence (`04-beyond-dora.md:85-95`). | "MiniH-local north-star metric aligned to SPACE/ESSP/DORA improvement guidance." | Not a named SPACE, DORA, ESSP, or Accelerate metric. |
| Time to Verified Working Context | L3 Local Harness Extension | SPACE Efficiency/Flow covers friction and tooling (`05-dora-space-accelerate-deep-reference.md:590-601`); ESSP leading indicators should reflect day-to-day friction (`github-essp-2025/raw.md:233-243`). | Defined as fresh workspace/session to build + seed + server + request + DB verification (`04-beyond-dora.md:98-105`). Event math in `11-hookability-matrix.md:157-184`. | "Access/flow leading indicator for harnessed systems." | Directly local; not named in source literature. |
| Zero-to-Proof Time | L3 Local Harness Extension | ESSP leading indicators; SPACE Efficiency/Flow. | Listed in metric family (`04-beyond-dora.md:98-103`). | "First-run usability metric aligned to flow and onboarding." | Needs benchmark task and proof-level definition to be comparable. |
| Time to Validated Change | L3 Local Harness Extension | DORA lead time is commit-to-production (`dora-metrics-guide-2026/raw.md:60`); ESSP lead time maps to velocity (`github-essp-2025/raw.md:342-365`). | Local stop condition is change proven through defined validation path (`04-beyond-dora.md:98-103`). | "Pre-production harness analogue to lead time, ending at proof rather than deploy." | Do not confuse with DORA lead time. |
| Time to Evidence-Backed Decision | L3 Local Harness Extension | Accelerate/DORA emphasize capabilities/metrics/outcomes and continuous improvement (`dora-research/raw.md:33-37`); ESSP Step 1-3 requires identifying barriers and monitoring changes (`github-essp-2025/raw.md:64-68`). | Local metric for research/question tasks (`04-beyond-dora.md:98-103`). | "Validated-learning metric for research and decision tasks." | No direct literature metric found; local harness concept. |

### B. Proof Quality and Validation Metrics

| MiniH Metric | Traceability | Literature Anchor | Local Harness Anchor | How to Phrase It | Caveat |
|---|---|---|---|---|---|
| Validation depth / proof level L0-L6 | L3 Local Harness Extension | ESSP Quality zone includes change failure, recovery, security/maintainability (`github-essp-2025/raw.md:260-340`); SPACE Performance covers outcomes and quality (`github-essp-2025/raw.md:155-158`). | Proof-level ladder L0-L6 (`04-beyond-dora.md:107-121`). | "Local evidence-strength control mapped to ESSP Quality / SPACE Performance." | Not direct literature; a MiniH-specific quality contract. |
| L5+ proof share | L3 Local Harness Extension | ESSP Quality; DORA instability metrics concern deployment failures (`dora-metrics-guide-2026/raw.md:64-71`). | L5 is expected state/system side-effect verification (`04-beyond-dora.md:111-121`). | "Share of proof runs meeting MiniH's validated-evidence threshold." | Define L5 per benchmark task. |
| Proof completeness rate | L3 Local Harness Extension | ESSP says calculation depends on workflow and data source (`github-essp-2025/raw.md:180-198`); DORA warns against measurement without improvement (`dora-metrics-guide-2026/raw.md:83-93`). | Completeness defined as required artifacts present (`04-beyond-dora.md:123-133`). | "Evidence-governance metric for proof trust." | Not present in DORA/SPACE/ESSP; local proof-system metric. |
| Proof reproducibility rate | L3 Local Harness Extension | Accelerate/DORA capability framing supports investing in practices that improve performance (`accelerate-2018/raw.md:290-292`, `dora-research/raw.md:33-37`). | Reproducibility defined as clean rerun success (`04-beyond-dora.md:127-133`). | "Harness repeatability metric aligned to capability improvement." | Needs reproducible runner/environment definition. |
| False-pass rate | L3 Local Harness Extension | DORA change fail rate is production failure ratio (`dora-metrics-guide-2026/raw.md:68-69`); ESSP change failure rate is Quality/Performance (`github-essp-2025/raw.md:260-299`). | False-pass defined as proof later contradicted by review/test/incident (`04-beyond-dora.md:127-133`). | "Pre-production analogue to change failure, measuring proof quality." | Do not present as DORA CFR; it is a harness-proof analogue. |
| DB/API/package proof success rate | L3 Local Harness Extension | ESSP says metrics depend on engineering workflow and production/failure definitions (`github-essp-2025/raw.md:180-188`). | Harness milestone/proof layer owns domain success (`10-three-layers.md:250-260`). | "Domain-specific quality success metric." | Literature does not name these; source of truth is MiniH proof contract. |

### C. Flow, Friction, and Capability-Improvement Metrics

| MiniH Metric | Traceability | Literature Anchor | Local Harness Anchor | How to Phrase It | Caveat |
|---|---|---|---|---|---|
| Retry count by milestone | L2 Literature-Aligned | SPACE Efficiency/Flow tracks throughput and focus (`github-essp-2025/raw.md:171-173`); ESSP leading indicators should reflect friction (`github-essp-2025/raw.md:233-243`). | Event math asks which milestone is slow, missing, flaky, or expert-dependent (`11-hookability-matrix.md:185-192`). | "Friction-localization leading indicator." | Needs dedupe so repeated same-error retries do not inflate distinct problems. |
| Failure signature recurrence | L2 Literature-Aligned | ESSP companion metrics prevent misinterpretation of a primary metric (`github-essp-2025/raw.md:249-256`); DORA continuous improvement loop repeats after checking progress (`dora-metrics-guide-2026/raw.md:107-115`). | Difficulty lifecycle monitors recurrence after mitigation (`04-beyond-dora.md:250-307`). | "Companion metric for learning-system health." | Local taxonomy required. |
| Difficulty count by category | L3 Local Harness Extension | SPACE includes Communication/Collaboration and Efficiency/Flow (`github-essp-2025/raw.md:167-173`); DORA Core Model connects ways of working to outcomes (`dora-research/raw.md:29-37`). | Difficulty ledger categories (`04-beyond-dora.md:250-307`). | "Cognitive-load inventory mapped to SPACE and DORA capability work." | Counts alone are not success; pair with mitigation/recurrence. |
| Encoded mitigation rate | L3 Local Harness Extension | Accelerate says invest in capabilities that drive performance (`accelerate-2018/raw.md:290-292`); DORA says commit to improving the bottleneck and repeat (`dora-metrics-guide-2026/raw.md:107-115`). | Difficulty ledger outcomes include encoded/documented/guarded/manual (`04-beyond-dora.md:284-307`). | "Rate at which friction becomes reusable capability." | Local metric, but strongly aligned to Accelerate/DORA capability logic. |
| Difficulty half-life | L3 Local Harness Extension | ESSP says sustainable improvement takes months and needs leading indicators (`github-essp-2025/raw.md:139-142`); DORA uses capabilities/metrics/outcomes for continuous improvement (`dora-research/raw.md:33-37`). | Defined as median time from difficulty discovery to verified mitigation (`04-beyond-dora.md:250-307`). | "How quickly MiniH turns discovered friction into verified capability." | Not found in DORA/SPACE/Accelerate/ESSP; use as local harness metric. |
| Manual intervention rate | L2 Literature-Aligned | SPACE Communication/Collaboration concerns knowledge sharing and coordination (`github-essp-2025/raw.md:167-169`); Accelerate's authored reference includes collaboration/supporting learning/job satisfaction capabilities (`05-dora-space-accelerate-deep-reference.md:170-178`). | MiniH metric in dossier; event envelope can capture actor/escalation (`11-hookability-matrix.md:84-118`). | "Self-service/knowledge-distribution metric." | Specific expert-help signal is local. |
| Expert escalation rate | L2 Literature-Aligned | Same as manual intervention; ESSP also warns metrics are affected by processes/culture beyond tooling (`github-essp-2025/raw.md:204-210`). | Difficulty ledger and companion-agent classification (`10-three-layers.md:247-279`). | "Indicator that tribal knowledge is still required." | Need explicit escalation event if possible; inferred companion signal should be lower confidence. |

### D. Companion-Agent Interpretation Metrics

| MiniH Metric | Traceability | Literature Anchor | Local Harness Anchor | How to Phrase It | Caveat |
|---|---|---|---|---|---|
| Task intent classification | L3 Local Harness Extension | ESSP supports leading indicators and companion metrics for context (`github-essp-2025/raw.md:224-256`). | Companion agents classify task intent over evidence (`10-three-layers.md:188-229`). | "Interpretive metadata that segments metrics by task type." | Not a productivity metric by itself. |
| Friction taxonomy | L2 Literature-Aligned | SPACE Communication/Collaboration and Efficiency/Flow; DORA improvement starts with friction/bottleneck conversation (`dora-metrics-guide-2026/raw.md:107-115`). | Three-layer model lists friction taxonomy as companion + hooks (`10-three-layers.md:250-260`). | "Classification layer for improvement targeting." | Requires evidence links; no proof, no ledger entry. |
| Evidence-quality classification | L3 Local Harness Extension | ESSP Quality and companion metrics; DORA warns against one metric/measurement-only (`dora-metrics-guide-2026/raw.md:83-93`). | `proof_summary` requires validation depth, evidence links, limitations (`10-three-layers.md:263-279`). | "Companion classification supporting proof trust." | Must not invent proof beyond harness artifacts. |
| Cognitive-load hotspot detection | L2 Literature-Aligned | SPACE says productivity includes more than individual activity or engineering-system efficiency (`space-developer-productivity-2021/raw.md:214-216`); SPACE Efficiency/Flow includes friction/focus (`github-essp-2025/raw.md:171-173`). | Companion layer identifies repeated reads, retries, compaction, long dwell (`10-three-layers.md:188-229`). | "Proxy signal for where humans/agents spend reasoning effort." | Telemetry cannot prove human experience; validate with pulse surveys. |
| Magic-wand closure rate | L3 Local Harness Extension | ESSP Developer happiness includes tooling satisfaction and Copilot satisfaction (`github-essp-2025/raw.md:425-508`). | `magic_wand_item` in minimum event model (`10-three-layers.md:263-279`). | "Whether pain reports become closed improvements." | Local metric; should not replace survey sentiment. |

### E. Soft / Survey Metrics

| MiniH Metric | Traceability | Literature Anchor | Local Harness Anchor | How to Phrase It | Caveat |
|---|---|---|---|---|---|
| Proof trust pulse | L2 Literature-Aligned | SPACE Satisfaction/Well-being; ESSP engineering tooling satisfaction (`github-essp-2025/raw.md:454-475`). | MiniH-specific pulse question in dossier (`research-dossier.md:264-277`). | "MiniH-specific satisfaction/trust question." | Not in source literature word-for-word. |
| Failure clarity pulse | L2 Literature-Aligned | SPACE Efficiency/Flow and Satisfaction; ESSP says surveys are practical for tooling satisfaction and some metrics (`github-essp-2025/raw.md:190-198`). | MiniH pulse question (`research-dossier.md:264-277`). | "Developer-perceived diagnosability." | Pair with hard recovery/diagnosis metrics. |
| Cognitive-load reduction pulse | L2 Literature-Aligned | SPACE rejects single activity metrics and includes satisfaction/flow (`space-developer-productivity-2021/raw.md:214-216`; `summary.md:12-24`). | Local pulse question (`research-dossier.md:264-277`). | "Human validation of friction/load reduction." | Do not infer only from agent telemetry. |
| Safer-to-change confidence | L2 Literature-Aligned | DORA metrics predict organizational performance and well-being (`dora-metrics-guide-2026/raw.md:37-50`); ESSP quality/velocity/developer happiness system (`github-essp-2025/raw.md:118-142`). | MiniH pulse question (`research-dossier.md:264-277`). | "Perceived change confidence." | Should be read alongside proof depth and false-pass rate. |
| AI helpfulness / Copilot-like satisfaction | L2 Literature-Aligned | ESSP Copilot satisfaction and AI leverage (`github-essp-2025/raw.md:477-520`); DORA AI archive says greatest returns come from underlying sociotechnical systems (`dora-research/raw.md:41-48`). | MiniH pulse question (`research-dossier.md:264-277`). | "AI-specific developer happiness and impact signal." | Do not equate AI helpfulness with value delivery without proof metrics. |

### F. Downstream Delivery and Business Metrics

| Metric | Traceability | Literature Anchor | MiniH Use | Caveat |
|---|---|---|---|---|
| Change lead time | L1 Direct Literature | DORA definition (`dora-metrics-guide-2026/raw.md:60`); ESSP Velocity lead time (`github-essp-2025/raw.md:342-365`). | Lagging delivery-speed signal after MiniH adoption. | Requires VCS-to-deploy linkage; not a MiniH leading metric. |
| Deployment frequency | L1 Direct Literature | DORA definition (`dora-metrics-guide-2026/raw.md:61`); ESSP Deployment frequency (`github-essp-2025/raw.md:366-386`). | Lagging delivery cadence. | Context-specific; avoid cross-system comparison. |
| Change failure rate | L1 Direct Literature | DORA definition (`dora-metrics-guide-2026/raw.md:68`); ESSP Quality (`github-essp-2025/raw.md:260-299`). | Quality guardrail for downstream impact. | Do not substitute false-pass rate for CFR; they are different levels. |
| Failed deployment recovery time / MTTR | L1 Direct Literature | DORA current guide uses failed deployment recovery time (`dora-metrics-guide-2026/raw.md:62`); ESSP uses failed deployment recovery time (`github-essp-2025/raw.md:260-299`). | Recovery capability after production failure. | If using historical "MTTR" wording, label it as older/DORA-adjacent terminology unless the chosen source uses it. |
| Deployment rework rate | L1 Direct Literature | DORA current guide (`dora-metrics-guide-2026/raw.md:69`). | Optional downstream stability metric. | Not in older four-key Accelerate formulation. |
| Reliability / SLO attainment | L4 Needs Source Work | Repo-authored DORA deep reference discusses Reliability as added later (`05-dora-space-accelerate-deep-reference.md:332-339`), but current local DORA metrics guide lists five different metrics (`dora-metrics-guide-2026/summary.md:12-22`). | Optional operational-health guardrail. | Current local source corpus does not make Reliability part of the 2026 DORA five-metric guide; cite the right DORA version if used. |
| AI leverage | L1 Direct Literature | ESSP Business outcome metric (`github-essp-2025/raw.md:510-539`). | Executive business-outcome signal for AI-assisted engineering. | Requires salary/cost/productivity assumptions; not a direct harness telemetry metric. |
| Engineering expenses to revenue | L1 Direct Literature | ESSP Business outcome (`github-essp-2025/raw.md:540-564`). | Optional org-level efficiency outcome. | Best monitored at org level, not team/MiniH level. |
| Feature engineering expenses to total engineering expenses | L1 Direct Literature | ESSP Business outcome (`github-essp-2025/raw.md:570-586`). | Optional value-allocation metric. | Requires finance taxonomy; not suitable for v1 MiniH instrumentation. |

## Source Gaps and Required Caveats

### Accelerate

The source corpus stores the IT Revolution product page and summary only. It explicitly says the full book requires purchase, subscription, or library access, and book-derived notes should be original summaries with page references (`accelerate-2018/summary.md:20-28`; `source-index.md:30-32`).

Use Accelerate for:

- the principle that capabilities drive software delivery performance
- the scientific lineage behind DORA
- the "metrics are dials, capabilities are levers" framing

Do not claim page-specific Accelerate evidence unless a licensed reader note is added.

### SPACE

The local SPACE raw file is a public locator/abstract snapshot, not the full ACM paper. It supports the anti-single-metric claim and the multidimensional framing (`space-developer-productivity-2021/raw.md:204-216`; `summary.md:12-24`), but detailed SPACE mechanics should cite repo-authored synthesis or a future authorized source note.

### DORA

The current local DORA guide uses five metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate (`dora-metrics-guide-2026/summary.md:12-22`). Older "four keys + reliability" language appears in repo-authored synthesis and other DORA-era material. When MiniH uses DORA, state the DORA source version.

### ESSP

ESSP is the strongest direct source for the MiniH balanced scorecard because it explicitly combines zones, leading/lagging indicators, telemetry/survey data, and companion metrics (`github-essp-2025/raw.md:96-113`, `raw.md:118-142`, `raw.md:224-256`).

## Metric Registry Shape

Implementation should keep the traceability metadata beside each metric definition.

```yaml
metric_id: time_to_verified_working_context
display_name: Time to Verified Working Context
traceability_level: L3_LOCAL_HARNESS_EXTENSION
framework_mappings:
  - framework: SPACE
    dimension: Efficiency and flow
    relationship: aligned
    source_refs:
      - docs/articles/sources/frameworks/space-developer-productivity-2021/summary.md:12-24
      - docs/articles/05-dora-space-accelerate-deep-reference.md:590-601
  - framework: ESSP
    zone: Velocity
    relationship: leading_indicator
    source_refs:
      - docs/articles/sources/frameworks/github-essp-2025/raw.md:224-243
local_refs:
  - docs/articles/measurement-architecture/04-beyond-dora.md:98-105
  - docs/articles/measurement-architecture/11-hookability-matrix.md:157-184
caveat: "Local harness metric; not a named DORA/SPACE/ESSP metric."
```

Suggested TypeScript shape:

```typescript
type TraceabilityLevel =
  | 'L1_DIRECT_LITERATURE'
  | 'L2_LITERATURE_ALIGNED'
  | 'L3_LOCAL_HARNESS_EXTENSION'
  | 'L4_NEEDS_SOURCE_WORK';

interface LiteratureReference {
  path: string;
  lines?: string;
  claim: string;
}

interface FrameworkMapping {
  framework: 'DORA' | 'SPACE' | 'Accelerate' | 'ESSP' | 'Local';
  dimensionOrZone?: string;
  relationship: 'direct' | 'aligned' | 'leading_indicator' | 'lagging_indicator' | 'analogue' | 'caveat';
  sourceRefs: LiteratureReference[];
}

interface MetricTraceability {
  metricId: string;
  displayName: string;
  traceabilityLevel: TraceabilityLevel;
  frameworkMappings: FrameworkMapping[];
  localRefs: LiteratureReference[];
  caveat?: string;
}
```

## Reporting Rules

1. **Direct metrics can use "from."** Example: "Change lead time is a DORA/ESSP velocity metric."
2. **Local metrics must use "aligned with" or "mapped to."** Example: "Time to Verified Working Context is mapped to SPACE Efficiency/Flow and ESSP leading indicators."
3. **Never present a harness metric as a DORA metric unless it is one.** False-pass rate is a local pre-production proof-quality analogue, not change failure rate.
4. **Always include source version.** Current DORA guide differs from older four-key/MTTR language.
5. **Separate literature from local design.** The literature justifies why the measure belongs; the MiniH design defines the exact event semantics.
6. **Prefer team/system aggregation.** ESSP warns against user-level metric misuse and recommends team/organization focus (`github-essp-2025/raw.md:211-222`).
7. **Use companion metrics sparingly.** ESSP warns too many companion metrics dilute focus and raise measurement cost (`github-essp-2025/raw.md:249-256`).

## Quick Reference

| Claim | Defensible Wording |
|---|---|
| MiniH improves value delivery | "MiniH improves value delivery if leading harness measures improve and downstream DORA/ESSP outcomes eventually move." |
| Time to Validated Evidence | "A local harness north-star metric aligned to ESSP leading indicators, SPACE Efficiency/Flow, and DORA continuous-improvement guidance." |
| Difficulty half-life | "A local capability-compounding metric inspired by Accelerate/DORA capability thinking; not a named literature metric." |
| Proof completeness / reproducibility | "Local evidence-quality guardrails mapped to ESSP Quality and SPACE Performance." |
| Trust/confidence pulse | "A MiniH-specific survey implementation of SPACE Satisfaction and ESSP Developer Happiness." |
| DORA metrics | "Downstream delivery-performance metrics; useful but insufficient alone for MiniH impact." |

## Open Questions

### Q1: Should MiniH store this matrix as code/config?

**OPEN**: Recommended if metrics will be rendered into dashboards. The YAML/TypeScript shape above can become `metric-registry.yaml` or equivalent.

### Q2: Should we add licensed Accelerate reader notes?

**OPEN**: Needed only if the implementation wants page-level citations for capability causality, Westrum culture, or the original four-key metric formulation.

### Q3: Which DORA version should dashboards use?

**OPEN**: Current local DORA guide uses the five-metric model. If stakeholders expect classic four metrics or reliability, the dashboard must label the source version explicitly.

### Q4: Should false-pass rate be promoted to the executive scorecard?

**RESOLVED FOR V1**: Include as a quality guardrail, but not as a top-line north-star. It is powerful for trust, but needs enough historical proof audits to avoid noise.

### Q5: Should AI leverage be a MiniH metric?

**RESOLVED FOR V1**: Treat as executive/business-outcome context only. MiniH can supply evidence of validated work and time saved, but AI leverage requires salary, cost, and productivity assumptions from outside the harness.
