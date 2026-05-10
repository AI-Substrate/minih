# Research Report: Measuring MiniH / Harness Effectiveness

**Generated**: 2026-05-07T07:44:25+10:00  
**Research Query**: "Figure out how to add a mixture of hard and soft measures to minih to measure its effectiveness, including imperative-code timers, companion-agent interpretation, and metrics grounded in DORA, ESSP, SPACE, and Accelerate."  
**Mode**: Pre-Plan  
**Location**: `docs/plans/020-minih-harness-measurement/research-dossier.md`  
**FlowSpace**: Available via external graph `measuring-hve`  
**External Research**: Perplexity research pass over DORA/Accelerate, SPACE, GitHub ESSP, Goodhart/metric gaming, AI measurement, and balanced scorecards  
**Findings**: 79 subagent findings synthesized

## Executive Summary

MiniH should not be measured as "AI produced more code" or "more PRs happened." The strongest framing in this repo is: **MiniH improves value delivery when it reduces the time from intent to validated evidence, while preserving proof quality and developer trust.**

The core measurement architecture was researched from the Measuring-HVE material:

```text
Hooks sense -> Harness proves -> Companion agents interpret -> DORA/ESSP/SPACE explain impact
```

DORA is useful, but it is downstream. For MiniH, the leading signals are accessibility, validated learning speed, proof quality, cognitive-load reduction, and reduced expert rescue. The best all-up metric cohort is therefore a small balanced scorecard: Time to Validated Evidence, proof quality, difficulty half-life, expert escalation/manual intervention rate, quarterly trust/confidence pulse, and downstream DORA.

## Key Insights

1. **The headline hard metric should be Time to Validated Evidence**, with Time to Verified Working Context as the first-run/accessibility variant. This is already defined in `docs/articles/measurement-architecture/04-beyond-dora.md:85-177` and `09-verified-working-context.md:18-42`.
2. **Imperative code should measure event timestamps and proof artifacts, not agent opinions.** The repo explicitly says agents are probes, not the stopwatch (`07-agents-as-probes.md:18-43`).
3. **Companion agents are valuable for classification, not authority.** They should classify task intent, friction, evidence quality, cognitive-load hotspots, repeated difficulties, and magic-wand requests, while citing event IDs and proof artifacts (`10-three-layers.md:188-229`).
4. **The balanced framework is ESSP as operating model, SPACE as safety rail, Accelerate as causal lens, DORA as lagging scorecard.** The repo already describes this lineage in `04-the-four-frameworks.md:9-19`.
5. **Value delivery is best shown through upstream causal measures first, then DORA later.** The repo's strongest executive argument is access -> learning -> load reduction -> safer flow -> DORA improvement (`04-beyond-dora.md:369-394`).

## Harness Status

No `docs/project-rules/harness.md` was found in `/Users/jordanknight/repos/Measuring-HVE` during source research. That source repo is documentation-heavy and has no formal project harness contract yet.

For MiniH measurement, the missing harness contract should eventually define:

- boot/start semantics
- interaction verbs
- observable proof levels
- event envelope
- milestone vocabulary
- benchmark task catalogue
- companion-agent classification contract
- privacy/redaction rules

## Domain Context

No `docs/domains/registry.md` was found. Natural boundaries discovered:

| Potential Domain | Evidence | Boundary |
|---|---|---|
| Measurement architecture | `docs/articles/measurement-architecture/00-index.md:5-21` | Overall theory and reading order |
| Harness telemetry | `10-three-layers.md:132-187`, `11-hookability-matrix.md:36-76` | Product-aware proof and milestone events |
| Companion interpretation | `10-three-layers.md:188-229` | Classification, dedupe, evidence quality, friction meaning |
| Soft metrics | `06-measuring-the-soft-stuff.md:71-161` | Surveys, developer happiness, flow, confidence |
| Framework mapping | `04-the-four-frameworks.md:9-19` | DORA / SPACE / Accelerate / ESSP mapping |
| Benchmark tasks | `05-benchmark-tasks.md:71-93` | Repeatable proof of harness improvement |

Recommendation: formalize MiniH measurement as an upstream harness-measurement domain later, with contracts for event records, proof levels, benchmark tasks, and soft-metric pulse data.

## How It Currently Works in the Research Material

### Entry Points

| Entry Point | Type | Location | Purpose |
|---|---|---|---|
| Measurement architecture index | Docs hub | `docs/articles/measurement-architecture/00-index.md:5-21` | Reading order for harness measurement architecture |
| Beyond DORA | Conceptual core | `docs/articles/measurement-architecture/04-beyond-dora.md:49-84`, `85-177` | Defines SPACE framing and Time to Validated Evidence |
| Three layers | Architecture | `docs/articles/measurement-architecture/10-three-layers.md:10-24`, `247-279` | Separates hooks, harness plugins, and companion agents |
| Hookability matrix | Contract map | `docs/articles/measurement-architecture/11-hookability-matrix.md:36-76` | Routes each measurement question to hook/harness/companion |
| Verified working context | Headline first-run metric | `docs/articles/measurement-architecture/09-verified-working-context.md:18-42` | Defines verified environment readiness |
| Benchmark tasks | Operational method | `docs/articles/measurement-architecture/05-benchmark-tasks.md:71-93` | Repeatable scenarios for comparing harness versions |
| Soft stuff | Survey method | `docs/articles/06-measuring-the-soft-stuff.md:71-161` | Weekly/quarterly SPACE/ESSP pulse options |

### Core Execution Flow

1. **A session or benchmark task starts**
   - Source: hook event such as `sessionStart`, `workspace_bootstrap_started`, or benchmark runner start.
   - Reference: `11-hookability-matrix.md:77-121`.

2. **Imperative harness code emits canonical milestones**
   - Example milestones: `dependencies_restored`, `build_succeeded`, `database_seeded`, `server_ready`, `first_request_succeeded`, `database_effect_verified`, `proof_completed`.
   - Reference: `11-hookability-matrix.md:122-156`.

3. **The harness proves product truth**
   - It does not merely observe a shell exit code. It validates build, runtime, request, state effect, and proof artifact.
   - Reference: `10-three-layers.md:132-187`.

4. **Timers are computed from event timestamps**
   - Example:

   ```text
   time_to_verified_working_context =
     proof_completed.timestamp - workspace_bootstrap_started.timestamp
   ```

   - Reference: `11-hookability-matrix.md:157-195`.

5. **Companion agents interpret the trace**
   - They classify task intent, friction, cognitive-load hotspots, evidence quality, likely missing docs, and difficulty-ledger matches.
   - Reference: `10-three-layers.md:188-229`.

6. **Metrics roll into a balanced scorecard**
   - Hooks provide adoption/activity.
   - Harnesses provide flow, proof, validation depth, false-pass risk.
   - Companion agents provide meaning.
   - Surveys provide human trust, confidence, and satisfaction.
   - DORA provides downstream delivery evidence.

## Recommended Measurement Architecture for MiniH

### Layer 1: Hooks Sense

Use hooks for cheap chronology and outer-loop activity:

| Signal | Capture Mechanism | Notes |
|---|---|---|
| Session start/end | agent/tool lifecycle hook | Needed for elapsed-time denominator |
| Prompt/task submitted | prompt hook | Hash or redact prompt; companion classifies intent |
| Tool command start/end | shell/tool hook | Useful fallback timer, not proof |
| File edits | editor/tool hook | Activity only; not correctness |
| Error events | shell/tool hook | Inputs for companion classification |

Do not let hooks answer product-truth questions. A shell command can exit zero while the DB is wrong or the wrong build target ran.

### Layer 2: Harness Proves

Use MiniH imperative code for product-aware milestones and proof artifacts:

| MiniH Concern | Instrumentation |
|---|---|
| Dependency restore | timestamp, package manager, lockfile fingerprint, cache state |
| Build | target, flags, env fingerprint, duration, outcome, artifact |
| DB seed/overlay | fixture/schema version, verification query, expected row/state |
| Runtime readiness | process start plus actual health/readiness check |
| First request | request transcript, response, correlation ID |
| State effect | DB/file/message/audit assertion |
| Proof completion | proof bundle path, validation depth, rerun command |
| Mitigation verification | difficulty ID, mitigation version, future successful run |

Minimum event fields should follow the repo's canonical envelope:

```json
{
  "event_id": "evt_...",
  "timestamp": "2026-05-07T07:44:25+10:00",
  "event_name": "proof_completed",
  "source": "minih.harness",
  "session_id": "session_...",
  "generation_id": "generation_...",
  "actor_type": "human_with_agent",
  "repo": "example-repo",
  "branch": "feature/example",
  "harness_version": "0.1.0",
  "task_id": "task_...",
  "scenario": "fresh_setup",
  "duration_ms": 12450,
  "outcome": "success",
  "validation_depth": "L5",
  "artifacts": [".minih/proofs/proof-summary.json"],
  "redaction_policy": "v1"
}
```

Reference: `11-hookability-matrix.md:77-121`.

### Layer 3: Companion Agents Interpret

Companion agents should read events, proof artifacts, command outputs, selected transcript evidence, and difficulty-ledger history. They should emit structured classifications with confidence and citations.

| Companion Output | Why It Benefits From an Agent | Required Evidence |
|---|---|---|
| Task intent | Prompts are ambiguous; same task may be schema, package, bug, validation, or research | prompt excerpt/hash, files touched, commands, scenario |
| Friction category | Failures need semantic grouping beyond exit codes | error snippets, failed milestone, retry sequence |
| Repeated difficulty match | Same issue appears with different text | prior difficulty IDs, matching files/commands/errors |
| Cognitive-load hotspot | Repeated reads, circular retries, compaction, and escalation are interpretive | event trace, files repeatedly inspected, time/retry evidence |
| Evidence quality | "Build passed" vs "API+DB proof" requires classification | proof artifact, validation depth, limitations |
| Missing recipe/doc | Repeated confusion often means docs/harness command missing | repeated search/read/fail patterns |
| Magic-wand request | Free text pain becomes backlog item | quote, event evidence, expected payoff |
| SPACE/Accelerate mapping | Maps trace evidence into framework categories | classification, source metrics, rationale |

Guardrail: no citation, no ledger entry; no proof, no metric. Reference: `07-agents-as-probes.md:158-204`.

## Metric Workshop Options

### Option A: Minimal Credible MiniH Scorecard

Use this when you need a small measurement set that is hard to game.

| Metric | Type | Framework Map | Source |
|---|---|---|---|
| Time to Verified Working Context, P50/P90 | Hard, leading | SPACE Efficiency/Flow; ESSP Velocity; Accelerate capability proxy | harness milestone timestamps |
| Proof completeness rate | Hard, quality guardrail | ESSP Quality; SPACE Performance | proof artifact inventory |
| L5+ proof share | Hard, quality guardrail | ESSP Quality | validation depth |
| Expert escalation/manual intervention rate | Hard/soft hybrid | SPACE Communication/Collaboration; Accelerate learning/culture proxy | explicit escalation event + companion inference |
| Difficulty half-life | Hard/interpretive | Accelerate capability improvement; SPACE Efficiency | difficulty ledger |
| Trust/confidence pulse | Soft | SPACE Satisfaction; ESSP Developer Happiness | quarterly pulse |
| DORA lead time + CFR + MTTR | Hard, lagging | DORA/Accelerate; ESSP Velocity/Quality | Jira/ADO/GitHub/CI/incident tooling |

This is the recommended starting cohort.

### Option B: Stronger Harness-Team Diagnostic Set

Use this for the MiniH team itself.

| Metric | Purpose |
|---|---|
| Time to dependencies restored | Shows setup/toolchain drag |
| Time to first successful build | Shows build path friction |
| Time to ready server | Shows runtime/readiness fragility |
| Time to first verified request | Shows product-path accessibility |
| DB overlay success rate | Shows data path maturity |
| Retry count by milestone | Shows where actors thrash |
| Failure signature recurrence | Shows whether fixes are compounding |
| False-pass rate | Shows whether green proofs lie |
| Proof reproducibility rate | Shows whether another actor can rerun evidence |
| Magic-wand closure rate | Shows whether user pain becomes product improvement |

### Option C: Executive Value-Delivery View

Use this when the question is "is the harness improving value delivery?"

| Executive Question | Metric Cohort |
|---|---|
| Can people/agents enter the system faster? | Time to Verified Working Context, zero-to-proof time, first-run success rate |
| Can teams answer questions faster? | Time to Evidence-Backed Decision, validated learning cycle time |
| Is the system safer to change? | L5/L6 proof share, false-pass rate, change failure rate, rollback/revert rate |
| Is tribal knowledge being encoded? | difficulty half-life, encoded mitigation rate, recurrence rate, expert escalation rate |
| Are engineers experiencing less load? | confidence/trust/failure-clarity/cognitive-load pulse |
| Is delivery improving downstream? | DORA lead time, deployment frequency, CFR, MTTR, reliability |

## Metric Definitions

### Hard Leading Metrics

| Metric | Formula / Capture | Interpretation |
|---|---|---|
| Time to Verified Working Context | `proof_completed - workspace_bootstrap_started` | Access to a real working state |
| Zero-to-Proof Time | first proof artifact from clean environment | Onboarding and first-run usability |
| Time to Validated Change | `proof_completed - change_task_started` for a change task | Modifiability |
| Time to Evidence-Backed Decision | decision recorded with evidence minus research task start | Learning speed |
| Validation depth | L0-L6 proof level | Strength of evidence |
| Proof completeness rate | complete proof bundles / proof runs | Evidence trustworthiness |
| Proof reproducibility rate | clean reruns passing / rerun attempts | Reusable evidence |
| False-pass rate | passed proofs later contradicted / passed proofs | Measurement quality |
| Manual intervention rate | tasks requiring human rescue / tasks attempted | Harness self-service |
| Expert escalation rate | tasks requiring named specialist / tasks attempted | Knowledge distribution risk |
| Retry count by milestone | failed attempts before milestone success | Friction localization |
| Encoded mitigation rate | difficulties converted to verified automation/docs/guards / difficulties | Compounding learning |
| Difficulty half-life | median time from difficulty creation to verified mitigation | How fast friction dies |

### Hard Lagging Metrics

| Metric | Source | Use |
|---|---|---|
| Lead time for changes | Jira/ADO/GitHub + VCS + deployment data | DORA downstream delivery speed |
| Deployment frequency | CI/CD/deployment tooling | Delivery throughput |
| Change failure rate | incidents/rollbacks/reverts/degradation | Quality/stability guardrail |
| MTTR | incident tooling | Recovery capability |
| Reliability | SLOs/availability/error budget | Product stability |

DORA is easy to measure only when issue, VCS, CI/CD, deployment, and incident data are linked. The repo's Jira article warns about custom field IDs, multi-status done states, resolution-date mistakes, API limits, and missing baseline commits (`03-jira-recipe.md:171-179`).

### Soft Metrics

Use a small pulse, aggregated at team level. Recommended MiniH-specific questions:

| Question | Measures |
|---|---|
| "I can get this system into a working state without specialist help." | Accessibility |
| "I trust the proof artifacts produced by MiniH." | Evidence trust |
| "When MiniH fails, I know what to do next." | Failure clarity |
| "MiniH reduces the amount of legacy knowledge I need before contributing." | Cognitive load |
| "MiniH makes this platform safer to change." | Confidence |
| "AI assistance in this workflow helped, hurt, or was neutral." | AI effectiveness |

Cadence: monthly during rollout, quarterly once stable. Keep results team-level and never individual. Reference: `04-beyond-dora.md:308-330`, `06-measuring-the-soft-stuff.md:131-161`, `06-measuring-the-soft-stuff.md:193-214`.

## DORA / SPACE / Accelerate / ESSP Mapping

| Framework | Role in MiniH Measurement | What to Use | What Not to Do |
|---|---|---|---|
| DORA | Lagging delivery-performance scoreboard | lead time, deployment frequency, CFR, MTTR, reliability | Use it as the only proof of MiniH impact |
| Accelerate | Causal capability lens | identify bottlenecks and capability bets; connect harness improvements to delivery capability | Treat capability scores as maturity theater |
| SPACE | Anti-single-metric safety rail | combine satisfaction, performance, activity, collaboration, flow across team/system levels | Infer happiness from telemetry |
| ESSP | Operating model / balanced scorecard | consolidate Business Outcomes, Quality, Velocity, Developer Happiness | Collapse it into one productivity number |

External research confirmed the same complementarity: DORA is precise and quantitative; SPACE protects against single-metric management; ESSP provides an integrated operating model; Goodhart's Law and metric gaming are core risks. Key public references from the external research pass included DORA guidance, the SPACE framework, GitHub's Engineering System Success Playbook, DX AI measurement, and Goodhart/metric-gaming guidance.

## Recommended All-Up Metric Cohort

The best first cohort for MiniH is:

1. **North Star**: Time to Validated Evidence, segmented by task type and proof level.
2. **Access metric**: Time to Verified Working Context for fresh setup benchmark.
3. **Quality guardrail**: L5+ proof share, proof completeness, false-pass rate, reproducibility rate.
4. **Learning metric**: difficulty half-life and encoded mitigation rate.
5. **Load metric**: expert escalation/manual intervention rate plus cognitive-load pulse.
6. **Human metric**: proof trust, failure clarity, confidence, AI helpfulness.
7. **Downstream business/delivery metric**: DORA lead time, CFR, MTTR, and reliability.

This cohort answers the value question without pretending that one number can measure engineering productivity.

## Benchmark Task Catalogue for MiniH

Start with six tasks already recommended in the repo:

| Task | What It Proves | Key Metrics |
|---|---|---|
| Fresh setup | A new actor can build, seed, run, health check, and make a real request | Time to Verified Working Context, manual interventions, missing assumptions |
| Schema overlay | DB change can be applied and proven through app path | apply time, request success, DB effect verified, rollback/reset clarity |
| Package path | modified package can be rebuilt, consumed, and proven | package version, dependency resolution, runtime proof, cache mistakes |
| Audit provenance | agent/operator identity flows into audit trail | identity injection, audit record correctness, correlation |
| Failure recovery | harness diagnoses known failure usefully | mean time to explanation, diagnosis quality, reusable recovery recipe |
| Small code change | known behavior can change and be proven end to end | time to validated change, proof depth, rework count |

Reference: `05-benchmark-tasks.md:71-93`.

## Data Model Sketch

Minimum viable records:

| Record | Created By | Required Fields |
|---|---|---|
| `session_event` | hooks | session ID, time, workspace, actor type, lifecycle state |
| `prompt_event` | hooks + companion | prompt hash/excerpt, intent candidate, timestamp |
| `tool_event` | hooks | tool, args fingerprint, result, duration, error category |
| `file_event` | hooks | path, action, generated/human where known |
| `milestone_event` | harness | scenario, milestone, outcome, duration, proof artifact, rerun command |
| `proof_summary` | harness + companion | validation depth, evidence links, limitations |
| `classification_event` | companion | intent, friction, cognitive-load signal, confidence, evidence links |
| `difficulty_item` | companion + harness | stable ID, symptom, mitigation, status, verified future run |
| `magic_wand_item` | companion | requested improvement, pain evidence, expected payoff, closure state |

Reference: `10-three-layers.md:260-279`.

## Critical Discoveries

### Critical Finding 01: MiniH terminology is missing

No exact `minih` hit was found in the FlowSpace graph. Existing docs use "harness", "harness plugins", "verified working context", "Time to Validated Evidence", and "verified useful work." A MiniH plan should either introduce MiniH as the concrete product name for these concepts or keep the generic harness vocabulary.

### Critical Finding 02: Do not let the agent be the stopwatch

Agents can attempt workflows and report confusion, but timings and outcomes must come from event streams, runners, validators, and proof artifacts. Reference: `07-agents-as-probes.md:18-43`.

### Critical Finding 03: Proof level is the quality contract

MiniH needs explicit proof tiers. For legacy/harness work, L5 or higher should be the default validated state: real request plus database/system side-effect proof. Reference: `04-beyond-dora.md:107-120`.

### Critical Finding 04: DORA is downstream

DORA should eventually move, but MiniH acts earlier by improving access, learning speed, proof reliability, and cognitive-load reduction. Reference: `04-beyond-dora.md:369-394`.

### Critical Finding 05: Soft metrics cannot be inferred from telemetry

Telemetry can show retries and friction; it cannot show trust, confidence, overload, or psychological safety. Use a pulse survey. Reference: `04-beyond-dora.md:308-330`.

## Prior Learnings

| ID | Insight | Source |
|---|---|---|
| PL-01 | Harness value is upstream of DORA: access, learning, validation, encoded discoveries first; DORA later. | `04-beyond-dora.md:14-22` |
| PL-02 | Time to Validated Evidence / Time to Verified Working Context is better than commits, PRs, lines, or first build. | `04-beyond-dora.md:85-105` |
| PL-03 | Agents are probes, not the stopwatch. | `07-agents-as-probes.md:18-42` |
| PL-04 | Benchmark fresh agents against API+DB proof using public instructions and harness only. | `07-agents-as-probes.md:68-96` |
| PL-05 | Use messy benchmark tasks, not toy tasks. | `05-benchmark-tasks.md:71-108` |
| PL-06 | Start forward-looking benchmarks now; retro-baselines are weak. | `05-benchmark-tasks.md:20-63` |
| PL-07 | Verified useful work beats AI adoption/activity signals. | `06-verified-useful-work.md:10-76` |
| PL-08 | Keep a leader-safe dashboard separate from a harness-team diagnostic dashboard. | `06-verified-useful-work.md:120-158` |
| PL-09 | Jira/DORA requires linked issue, VCS, CI/CD, deploy, and incident data. | `03-jira-recipe.md:11-179` |
| PL-10 | Artifact adoption matters: dashboards referenced in standups/retros are stronger than dashboards merely existing. | `02-measuring-from-real-data.md:57-100` |

## Modification Considerations

### Safe to Define Now

1. Canonical event envelope.
2. Milestone vocabulary.
3. Proof levels.
4. Benchmark task catalogue.
5. MiniH-specific pulse survey.
6. Companion-agent classification schema.

### Modify with Caution

1. Composite "productivity" scores. They invite Goodhart's Law and hide tradeoffs.
2. Activity metrics such as prompts, PR count, accepted suggestions, or files changed. Use as supporting telemetry only.
3. Individual-level metrics. The repo repeatedly rejects surveillance and stack ranking.
4. Historical baselines. Use if defensible, but prefer prospective benchmark trendlines.

### Danger Zones

1. Counting a shell exit code as proof.
2. Letting the coding agent self-report duration or success.
3. Averaging unlike task types into one productivity number.
4. Reporting survey results without team-level anonymity and response-rate provenance.
5. Treating DORA improvement as immediate proof of MiniH impact without causal leading indicators.

## Open Workshop Questions

1. What is the minimum proof level MiniH will call "validated" for each benchmark task: L4 request proof, L5 state proof, or L6 reproducible proof?
2. Which six benchmark tasks should be first-class in MiniH v1, and which task variants should rotate to prevent benchmark gaming?
3. What is the canonical event sink: local JSONL, SQLite, OpenTelemetry, GitHub artifact, CI artifact, or a service endpoint?
4. How much prompt/transcript evidence can be retained under the redaction policy?
5. What constitutes expert escalation: explicit marker only, inferred companion signal, or both?
6. Should the first scorecard be team/harness-level only, or should it support org-level rollups from day one?
7. What DORA source is authoritative for the first target environment: Jira/ADO/GitHub/CI/incident tooling?
8. What is the survey cadence during rollout: monthly pulse or quarterly pulse?
9. How will false passes be detected: later test failures, review findings, incidents, reverted PRs, or manually adjudicated proof audits?
10. How will MiniH distinguish a one-off difficulty from a recurring difficulty worth encoding?

## External Research Opportunities

The Perplexity pass covered the broad external framework comparison. Remaining focused research opportunities:

### Research Opportunity 1: ESSP Metric Contract

**Why Needed**: The repo treats ESSP as the operating model, but MiniH needs a concrete mapping from ESSP zones to event fields and dashboard rows.

**Prompt**:

```text
/deepresearch "Create a concrete metric contract for applying GitHub Engineering System Success Playbook / ESSP to an AI harness product. Map Business Outcomes, Quality, Velocity, and Developer Happiness to hard telemetry, companion-agent classifications, and survey questions. Include examples for a harness that emits proof artifacts and benchmark-task events."
```

### Research Opportunity 2: Causal Evaluation Design

**Why Needed**: MiniH impact claims will be stronger if prospective benchmark trends are paired with rollout comparisons or matched cohorts.

**Prompt**:

```text
/deepresearch "Design a practical causal evaluation approach for measuring whether an internal engineering harness improves value delivery. Compare pre/post, difference-in-differences, matched team cohorts, benchmark probes, and interrupted time series. Include pitfalls for DORA/SPACE/ESSP metrics and recommendations for small sample sizes."
```

### Research Opportunity 3: Telemetry Privacy and Redaction

**Why Needed**: MiniH event envelopes may include prompts, commands, file paths, logs, and proof artifacts. Measurement value depends on trust.

**Prompt**:

```text
/deepresearch "Research privacy-preserving telemetry design for developer productivity and AI-agent harness measurement. Focus on prompt/log redaction, team-level aggregation, proof artifact retention, individual-surveillance avoidance, and governance practices aligned with SPACE and developer experience research."
```

## Appendix: Source Inventory

### Core Documents

| File | Purpose |
|---|---|
| `docs/articles/measurement-architecture/00-index.md` | Measurement architecture reading order |
| `docs/articles/measurement-architecture/04-beyond-dora.md` | Core Time to Validated Evidence and difficulty-ledger model |
| `docs/articles/measurement-architecture/05-benchmark-tasks.md` | Benchmark task catalogue |
| `docs/articles/measurement-architecture/07-agents-as-probes.md` | Agent probe guardrails |
| `docs/articles/measurement-architecture/09-verified-working-context.md` | Verified working context definition |
| `docs/articles/measurement-architecture/10-three-layers.md` | Hooks/harness/companion architecture |
| `docs/articles/measurement-architecture/11-hookability-matrix.md` | Event envelope and milestone vocabulary |
| `docs/articles/measurement-architecture/12-hooks-are-not-the-system.md` | Responsibility separation |
| `docs/articles/06-measuring-the-soft-stuff.md` | Soft metric survey paths |
| `docs/articles/04-the-four-frameworks.md` | DORA/SPACE/Accelerate/ESSP framing |
| `docs/articles/03-jira-recipe.md` | Jira-based DORA implementation notes |

### External Public References Used by Perplexity Pass

| Source | URL |
|---|---|
| DORA metrics guide | https://dora.dev/guides/dora-metrics/ |
| SPACE framework | https://space-framework.com |
| GitHub Engineering System Success Playbook | https://github.com/resources/insights/engineering-system-success-playbook |
| DX AI Measurement Framework | https://getdx.com/ai-measurement/ |
| Goodhart/metric gaming discussion | https://jellyfish.co/blog/goodharts-law-in-software-engineering-and-how-to-avoid-gaming-your-metrics/ |

## Next Steps

Run `/plan-2c-workshop` before specification if the team wants to design the MiniH event model, proof levels, and dashboard contract in detail. Otherwise, run `/plan-1b-specify` to convert this research into a feature specification.

Research complete.
