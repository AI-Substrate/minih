# Workshop: Ethos of Value-Delivery Measurement

**Type**: Measurement Design / Operating Model
**Plan**: `020-minih-harness-measurement`
**Spec**: Not yet created
**Created**: 2026-05-09T09:46:15+10:00
**Status**: Draft

**Related Documents**:
- [`../research-dossier.md`](../research-dossier.md)
- [`001-literature-traceability-matrix.md`](001-literature-traceability-matrix.md)
- Perplexity deep-research refinement pass, 2026-05-09, over DORA, Accelerate, SPACE, ESSP, DX/DevEx, Goodhart's Law, and AI productivity measurement
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/01-better-questions.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/04-beyond-dora.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/06-verified-useful-work.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/07-agents-as-probes.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/10-three-layers.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/measurement-architecture/11-hookability-matrix.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/06-measuring-the-soft-stuff.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/04-the-four-frameworks.md`
- `/Users/jordanknight/repos/Measuring-HVE/docs/articles/sources/frameworks/`

**Domain Context**:
- **Primary Domain**: runner - event capture, run lifecycle, artifacts, retrospectives, output validation
- **Related Domains**: cli - reporting and dashboard/export UX; adapter - normalized SDK events; mcp - coordinated agent state/inbox signals

---

## Purpose

This workshop sets the measurement ethos for MiniH before the feature spec is written. It keeps the product pointed at delivery of value, validated evidence, flow, trust, and compounding engineering-system capability - not faster typing, more code, more PRs, more prompts, or individual surveillance.

## Key Questions Addressed

- Why do DORA, SPACE, Accelerate, and ESSP exist, and what spirit should MiniH inherit from each?
- What is MiniH's value-delivery thesis as a professional agent system?
- Which hard, soft, and agent-interpreted metrics can MiniH credibly capture?
- Which metrics are easy now because of agents, and which still require human surveys or downstream integrations?
- How do we keep the scorecard useful without turning it into productivity theater?

---

## The Ethos Contract

MiniH exists to improve the engineering system so humans and agents can deliver valuable outcomes with less friction and stronger evidence.

```text
Intent
  -> working context
  -> validated evidence
  -> decision or change
  -> encoded learning
  -> safer, faster, more valuable delivery
```

The reason for existence is **value delivery**, not code generation. MiniH should help teams answer: "Did this system become easier to enter, safer to change, easier to understand, and better at producing trustworthy evidence?"

The Perplexity refinement pass sharpened one phrase: MiniH should treat measurement as **calibrated learning**, not control. The goal is not to prove that agents are busy or operators are productive. The goal is to calibrate claims against evidence: "we trust this proof" against false-pass rate, "we encoded learning" against recurrence, and "we are faster" against proof depth and downstream rework.

### MiniH should optimize for

| Value | What it means in MiniH | Primary evidence |
|---|---|---|
| Value delivery | Useful work reaches a trustworthy proof or decision | Validated task outcomes, evidence-backed decisions, downstream DORA/ESSP outcomes |
| Working context | A fresh actor can enter the system without hidden folklore | Time to Verified Working Context, first-run success, proof level |
| Validated learning | Questions become evidence, not just answers | Time to Evidence-Backed Decision, research conclusions with artifacts |
| Proof quality | "Done" means a defined validation depth was reached | L5+ proof share, proof completeness, reproducibility, false-pass rate |
| Flow | Humans and agents move from intent to proof without avoidable thrash | Retry count, failed-command loops, flow-state pulse, failure clarity |
| Cognitive-load reduction | Tribal knowledge becomes executable structure | difficulty half-life, encoded mitigation rate, expert escalation rate |
| Developer trust | People trust the harness, proofs, and failure guidance | proof-trust pulse, failure-clarity pulse, adoption/repeat use |
| Business impact | Engineering improvement eventually moves delivery outcomes | DORA/ESSP lagging metrics, business-outcome context |

### MiniH should not optimize for

| Anti-goal | Why it is wrong | Allowed use |
|---|---|---|
| Lines of code | Volume can increase review load and rework | Context only, never a target |
| PR count | Rewards slicing and activity, not value | Context only, paired with proof and outcomes |
| Prompt count | Activity can mean friction | Diagnostic signal for thrash or adoption |
| Token count | Cost signal, not value signal | Cost management only |
| Agent "I finished" claims | Self-report is not evidence | Narrative only, must be backed by artifacts |
| Individual productivity scores | Destroys trust and violates SPACE/ESSP spirit | Individual traces only for opt-in self-review/debugging |
| One composite productivity number | Hides tradeoffs and invites gaming | Use a small balanced scorecard instead |

---

## Framework Ethos: Why Each Exists

The four frameworks are not competing brand names. They are a stack of concerns.

| Framework | Why it exists | Core ethos | MiniH translation |
|---|---|---|---|
| DORA | Prove software delivery performance is measurable and improvement-oriented | Delivery performance is an outcome, not an activity count; use metrics to improve, not compete | Keep DORA downstream. Use it to show whether harness improvements eventually improve delivery, but do not make it the only proof of MiniH impact |
| Accelerate | Explain which capabilities cause performance, not just which numbers correlate | Capabilities are levers; metrics are dials; continuous improvement beats maturity theater | Treat MiniH itself as a capability investment: proof loops, fast feedback, test data, value-stream visibility, supporting learning, empowered teams |
| SPACE | Stop organizations from reducing developer productivity to one harmful number | Productivity is multidimensional, contextual, team/system-level, and must mix telemetry with perception | Use SPACE as the governance rail: at least three dimensions, team/system aggregation, soft metrics included, no surveillance |
| ESSP | Turn DORA + SPACE + Accelerate into an executable engineering-system operating model | Business outcomes sit above quality, velocity, and developer happiness; use leading, lagging, and companion metrics | Use ESSP as the scorecard shape: value at the top, supported by proof quality, flow/velocity, and developer happiness/trust |

### Source anchors

- DORA current guidance warns against setting metrics as goals, one metric to rule them all, disparate comparisons, competition, and measurement without improvement (`dora-metrics-guide-2026/raw.md:83-115`).
- SPACE's abstract says developer productivity is more than individual activity or engineering-system efficiency and cannot be measured by a single metric or dimension (`space-developer-productivity-2021/raw.md:204-216`).
- Accelerate's public source describes measuring software delivery performance and what drives it using rigorous methods, with the goal of applying technology to drive business value (`accelerate-2018/raw.md:262-292`).
- ESSP frames engineering success as business outcomes supported by quality, velocity, and developer happiness, with leading and lagging indicators (`github-essp-2025/raw.md:96-143`, `224-256`).

---

## The MiniH Value Thesis

MiniH should be described as a professional agent system that improves value delivery by reducing the time and human attention required to get from intent to validated evidence.

### The CTO sentence

> MiniH improves value delivery when it makes systems more accessible, more knowable, and safer to change, and when those upstream improvements eventually move downstream delivery and business outcomes.

### The operator sentence

> MiniH is working when a fresh human or agent can enter a codebase, use the harness, reach a defined proof level, and leave behind evidence or encoded learning that makes the next loop cheaper.

### The measurement sentence

> Measure the system's ability to produce verified useful work per unit of human attention, segmented by task type and proof level.

This deliberately avoids "AI made developers faster." Faster at what? Typing? Drafting? Creating review burden? MiniH's claim should be stronger and harder to game: validated work and validated learning are becoming cheaper, safer, and more repeatable.

### Audience-specific wording

| Audience | Strong wording | Avoid |
|---|---|---|
| Executive | "MiniH reduces the time from intent to trusted evidence and shows whether that upstream capability later moves delivery outcomes." | "AI made developers faster." |
| Engineering manager | "MiniH exposes where work waits, retries, needs rescue, loses trust, or fails proof, so the team can improve the system." | "Your team should produce more PRs." |
| Harness team | "MiniH turns run traces, proof artifacts, retros, and difficulty recurrence into a backlog of encoded mitigations." | "The dashboard says productivity is down." |
| Practitioner | "MiniH should make the next run clearer, safer, and less dependent on hidden knowledge." | "The agent did more work than you." |

---

## What Agents Change

Before agents, the easiest metrics were DORA-style queries over tangible delivery data: commits, deploys, incidents, recovery time, and tickets. The softer layers were hard because the data lived in people's heads.

Agents do not remove that human layer, but they create a new middle layer: **repeatable, inspectable traces of how work is attempted**.

### New measurement affordances

| New affordance | What MiniH can see | What it still cannot know |
|---|---|---|
| Agent/task traces | Prompts, tool calls, commands, reads, edits, retries, failures, compactions | Whether the business outcome mattered |
| Harness proofs | Build, seed, runtime, request, DB/state verification, proof artifacts | Whether humans trust the proof |
| Companion interpretation | Task intent, friction category, repeated difficulty, evidence quality, likely missing docs | Whether a person felt overloaded, safe, or satisfied |
| Synthetic probes | Cold-start accessibility, discoverability, repeatable benchmark success | Day-to-day human experience under real org pressure |
| Retros/magic-wand items | Pain points and improvement requests close to the work | Representativeness without aggregation and response-rate context |

### The rule

```text
Agents can reveal friction.
Harnesses must prove facts.
Humans must confirm human experience.
```

Companion agents can classify cognitive-load hotspots from trace evidence, but they cannot replace a pulse survey. If five agents repeatedly read the same stale doc, fail the same command, and ask for specialist help, MiniH has a strong proxy signal. It is still not the same as "developers feel less cognitive load."

---

## Measurement Architecture Vibe

Use the existing three-layer measurement architecture, but make the value-delivery purpose explicit.

```text
Layer 1: Hooks sense
  session, prompt, tool, shell, file, retry, error, context events
    |
    v
Layer 2: Harness proves
  build, seed, run, request, state effect, proof level, reproducibility
    |
    v
Layer 3: Companion agents interpret
  intent, friction, evidence quality, cognitive load, repeated difficulty
    |
    v
Balanced operating view
  value delivery, proof quality, flow, learning, developer trust, downstream DORA
```

The design rule from Measuring-HVE should become MiniH's measurement rule:

> Measure the event where the truth is cheapest to prove.

Hooks should not prove product truth. Harnesses should not infer human happiness. Companion agents should not invent proof. Surveys should not be used where event data already exists.

---

## Metric Families

### 1. Value and Evidence Metrics

These are MiniH's top-line local metrics.

| Metric | Meaning | Capture | Framework relationship |
|---|---|---|---|
| Time to Validated Evidence | Time from task/question/change intent to trustworthy evidence | task start event to proof/decision event | Local north star aligned to ESSP leading indicators and SPACE flow |
| Time to Verified Working Context | Fresh actor reaches build + seed + runtime + request + state proof | milestone timestamps | Local access/flow metric |
| Time to Evidence-Backed Decision | Research/investigation reaches a decision with cited evidence | task start to decision artifact | Local validated-learning metric |
| Evidence-Backed Decisions | Count/share of decisions with cited proof artifacts above a declared proof level | decision artifacts + proof links | Local value-through-learning metric |
| Verified Useful Work per Human Attention | Validated useful outcomes divided by human rescue/review/debug attention | proof outcomes + intervention events + review loops | Local AI-era value metric |
| Agent-proven accessibility | Fresh probe agents reach required proof level within a budget | scheduled synthetic probes | Local synthetic DevEx metric |

**Vibe**: These are not speed-of-coding metrics. They measure how quickly the system can become correct enough to support action.

### 2. Proof Quality Metrics

These prevent faster evidence from becoming weaker evidence.

| Metric | Meaning | Capture |
|---|---|---|
| Validation depth / proof level | Highest proof tier reached, L0-L6 | proof metadata |
| L5+ proof share | Share of runs reaching state/system side-effect proof or better | proof summaries |
| Proof completeness rate | Required artifacts present for proof runs | artifact inventory |
| Proof reproducibility rate | Clean reruns pass from the proof bundle | rerun attempts |
| False-pass rate | Passed proofs later contradicted by review, tests, incidents, or later validation | later quality correlation |

**Default stance**: For MiniH's professional-agent positioning, "validated" should normally mean L5+ for change/setup benchmarks unless a task explicitly uses a lower proof contract.

### 3. Flow and Friction Metrics

These explain where work slows before it becomes DORA-visible.

| Metric | Meaning | Capture |
|---|---|---|
| Retry count by milestone | Thrash before a proof stage succeeds | hook + harness events |
| Failed-command loop rate | Repeated same or similar failures | hook events + companion dedupe |
| Failure diagnosis time | Time from first failure to actionable next step | failure event to mitigation/recipe/success |
| Context compaction pressure | Long or confusing sessions exhausting context | adapter/runtime events |
| Intervention rate | Share of runs requiring human redirect, rescue, abandon, or expert handoff | explicit run events + optional human annotation |
| Time waiting on human/expert | Scarce attention consumed by rescue | explicit escalation event, review loop, companion candidate |
| Flow-state pulse | Whether humans report significant deep-focus time | team-level survey |

**Vibe**: Flow is not "people typed continuously." Flow is the absence of avoidable interruption between intent and proof.

### 4. Learning and Capability Metrics

These show whether MiniH compounds.

| Metric | Meaning | Capture |
|---|---|---|
| Difficulty count by category | Where friction concentrates | companion-classified ledger |
| Friction recurrence rate | Same class of difficulty reappears | ledger matching |
| Encoded mitigation rate | Difficulty became automation, doc, guard, recipe, benchmark, or validation | ledger state + verification run |
| Difficulty half-life | Median time from discovery to verified mitigation | ledger timestamps |
| Magic-wand closure rate | Pain requests become shipped improvements | retros/magic-wand lifecycle |
| Expert escalation rate | Work still depends on named specialists | escalation events + companion classification |

**Vibe**: A professional harness does not merely help one task finish. It turns each painful loop into an improvement that reduces future pain.

### 5. Developer Trust and Soft Metrics

These must include human perception.

| Metric | Question | Capture |
|---|---|---|
| Proof trust | "I trust the proof artifacts produced by MiniH." | monthly rollout / quarterly steady-state pulse |
| Proof trust calibration | Whether reported trust matches false-pass and rework evidence | trust pulse + false-pass/rework correlation |
| Failure clarity | "When MiniH fails, I know what to do next." | pulse + failed-run transactional prompt |
| Cognitive-load reduction | "MiniH reduces the amount of legacy knowledge I need before contributing." | pulse + difficulty ledger trend |
| Safer-to-change confidence | "MiniH makes this platform safer to change." | pulse + proof quality trend |
| Flow state | "I have significant time for deep, focused work during my work days." | ESSP/DX-style survey |
| AI helpfulness | "AI assistance in this workflow helped, hurt, or was neutral." | lightweight pulse or end-of-task question |

**Vibe**: Soft metrics are not weaker. They are harder because the data lives in people. Treat them as a relationship with developers, not a dashboard feature.

### 6. Downstream Delivery and Business Metrics

These are important, but they are lagging indicators for MiniH.

| Metric | Use in MiniH |
|---|---|
| Change lead time | Downstream delivery-speed impact after harness adoption |
| Deployment frequency | Delivery cadence context, not the MiniH north star |
| Change failure rate | Production-quality guardrail |
| Failed deployment recovery time / MTTR | Recovery capability |
| Deployment rework rate | Current DORA guide's stability/rework metric |
| Reliability / SLO attainment | Optional operational-health guardrail if sourced correctly |
| AI leverage | Executive context only; requires assumptions outside MiniH telemetry |
| Engineering expenses to revenue | Org-level finance metric, not MiniH v1 instrumentation |

**Vibe**: DORA should improve because MiniH improves the causes. Do not skip the causal story.

---

## What MiniH Can Do Now vs Later

This is a planning view, not an implementation promise.

| Horizon | Metric capability | Why it fits |
|---|---|---|
| Now | Run lifecycle events, command/tool timing, task duration, run status, errors, retries, retrospectives, magic-wand items | MiniH already owns agent execution, run folders, event streaming, artifacts, retros, and CLI reporting surfaces |
| Now | Companion classification of intent, friction, evidence quality, cognitive-load hotspots, and magic-wand requests | Coordinated/companion agents can read evidence and produce structured classifications with confidence |
| Now | Synthetic benchmark/probe runs for closed-book/guided tasks | MiniH can run agents repeatably and preserve run artifacts |
| Next | Canonical measurement event envelope and milestone vocabulary | Needed to make metric queries boring and comparable |
| Next | Proof summary contract with proof levels, artifact inventory, rerun command, and limitations | Needed for L5+ share, completeness, reproducibility, and false-pass tracking |
| Next | Difficulty ledger lifecycle | Needed for difficulty half-life, recurrence, encoded mitigation, and expert escalation |
| Next | Lightweight pulse capture and provenance | Needed for trust, flow state, failure clarity, cognitive load, AI helpfulness |
| Later | DORA integrations with GitHub/ADO/Jira/CI/deploy/incident systems | Requires external delivery-system data and definitions |
| Later | Business outcome / AI leverage metrics | Requires finance, cost, salary/productivity assumptions, or executive-defined business outcomes |
| Later | Cross-team/org rollups | Requires privacy, aggregation thresholds, retention rules, and governance |

---

## Perplexity Refinement Pass: Extra Color to Preserve

The external research pass did not overturn the workshop. It added color that should influence the spec and architecture.

| Refinement | Why it matters | Design implication |
|---|---|---|
| Trust must be calibrated, not just reported | High proof trust with high false-pass rate means the harness is overclaiming or explaining poorly | Pair proof-trust pulse with false-pass/rework data |
| Intervention rate is more useful than generic "human in the loop" | Human redirects, rescues, abandonments, and expert handoffs expose where agent autonomy is expensive | Add explicit intervention events; do not infer everything from retries |
| Evidence-backed decisions are a value unit | Some valuable work is a "do not ship" or "this hypothesis is wrong" decision | Count decisions only when linked to proof artifacts and task intent |
| Flow proxies must stay humble | Retry loops and context compaction are useful friction proxies, not emotions | Label as "flow friction proxy"; human flow state remains survey-owned |
| Survey fatigue is a product risk | Soft-metric instruments decay if they ask too much or produce no visible response | Keep operator survey load low; close the loop with "what changed because of feedback" |
| Proof-level semantics need their own workshop | L3/L5/L6 meanings vary by product and can easily overclaim | Define proof levels operationally before dashboarding them |
| Causality must be staged | DORA movement has many confounders; MiniH should not overclaim causal impact early | Treat local harness metrics as leading/capability evidence; add causal evaluation later |

### Refined one-page scorecard candidate

| Category | Metric | Data source | Tension pair |
|---|---|---|---|
| Value & Evidence | Time to Validated Evidence | runner timestamps + proof records | false-pass rate, proof completeness |
| Value & Evidence | Evidence-Backed Decisions | decision artifacts + proof links | decision quality/rework |
| Proof Quality | L5+ proof share | proof summary records | proof trust calibration |
| Proof Quality | False-pass rate | later tests/reviews/incidents/manual proof audit | Time to Validated Evidence |
| Flow & Friction | Intervention rate | explicit redirect/rescue/abandon/escalation events | task complexity segmentation |
| Learning | Encoded mitigation rate | difficulty ledger + verified later run | difficulty recurrence rate |
| Learning | Difficulty half-life | difficulty lifecycle timestamps | recurrence after mitigation |
| Trust | Proof trust / failure clarity pulse | team-level pulse or post-run prompt | false-pass/rework evidence |
| Downstream | DORA/ESSP outcomes | delivery-system integrations | local leading indicators |

This is deliberately not a composite score. The value is in the tensions.

---

## Companion-Agent Classification Contract

Companion agents should be used for interpretation, not authority. Every classification should cite evidence.

```typescript
interface MeasurementClassification {
  classificationId: string;
  sourceEventIds: string[];
  taskId: string;
  taskIntent: {
    category:
      | 'fresh_setup'
      | 'code_change'
      | 'schema_overlay'
      | 'package_path'
      | 'failure_recovery'
      | 'research_decision'
      | 'harness_improvement'
      | 'other';
    confidence: number;
    rationale: string;
  };
  friction?: {
    category:
      | 'build'
      | 'config'
      | 'data'
      | 'test'
      | 'runtime'
      | 'tooling'
      | 'docs'
      | 'permissions'
      | 'domain_knowledge'
      | 'review'
      | 'unknown';
    severity: 'low' | 'medium' | 'high';
    recurringCandidate: boolean;
    evidenceRefs: string[];
  };
  evidenceQuality: {
    proofLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
    limitations: string[];
    proofArtifactRefs: string[];
  };
  cognitiveLoadSignals?: {
    repeatedReads?: string[];
    retryLoopCount?: number;
    contextCompactions?: number;
    escalationCandidate?: boolean;
    confidence: number;
  };
  recommendedImprovement?: {
    kind: 'automation' | 'documentation' | 'guardrail' | 'recipe' | 'benchmark' | 'other';
    description: string;
    expectedMetricImpact: string;
  };
}
```

### Classification rules

1. No evidence refs, no classification.
2. No proof artifact, no proof metric.
3. Low confidence is allowed; false certainty is not.
4. Companion output may create a candidate difficulty, but closure requires a verified later run.
5. Companion output may suggest human experience, but pulse surveys own human experience.

### Safe vs unsafe classifications

| Safe classification | Evidence required | Unsafe overreach to avoid |
|---|---|---|
| Tool failure | tool name, parameters fingerprint, error code/message, event IDs | "The agent was confused." |
| Repeated proof strategy failure | ordered proof attempts and failure reasons | "The operator misunderstood the task." |
| Known difficulty match | prior difficulty ID, similarity evidence, matching commands/files/errors | "This is definitely the root cause." |
| Context pressure proxy | context size/compaction/repeated reads/long dwell with event IDs | "The human was cognitively overloaded." |
| Intervention event | explicit redirect/rescue/abandon/escalation marker | "The human intervention was unnecessary." |
| Evidence-quality limitation | proof level, missing artifact, limitation text | "The change is safe to deploy." |

Companion agents should classify observable patterns and attach confidence. They should not infer private mental states, assign blame, or make deployment decisions.

---

## Dashboard Shape

One dashboard cannot serve every audience. MiniH should support two views over the same event spine.

### Leader-safe value view

| Question | Metric |
|---|---|
| Can people and agents enter the system? | Time to Verified Working Context, first-run success, expert escalation |
| Can they produce trustworthy evidence faster? | Time to Validated Evidence, proof level, proof completeness |
| Is the system learning? | difficulty half-life, encoded mitigation rate, recurrence rate |
| Is developer experience improving? | proof trust, failure clarity, flow-state pulse |
| Is delivery improving downstream? | DORA/ESSP lagging metrics, clearly labeled as downstream |

### Harness-team diagnostic view

| Improvement question | Metric |
|---|---|
| Which stage is slow? | build/seed/run/request/validation durations |
| Which failures recur? | failure signatures, recurrence, retry loops |
| Which proofs are shallow? | proof level, missing artifacts, false-pass candidates |
| Which docs or commands are missing? | repeated reads, failed discovery, magic-wand requests |
| Which specialists are still bottlenecks? | explicit escalation, domain-knowledge friction |

### Why two views

Leader-safe metrics prevent diagnostic details from becoming targets. Harness-team diagnostics stay concrete enough to fix. Both should come from the same provenance-rich event model so the numbers can be explained.

---

## Healthy Metric Tensions

MiniH should make tradeoffs visible instead of pretending every metric moves together.

| Pattern | Interpretation | Response |
|---|---|---|
| Time to Validated Evidence down, false-pass rate down | Strong improvement: faster and more trustworthy evidence | Preserve the change; inspect which mitigation caused it |
| Time to Validated Evidence down, false-pass rate up | Speed-quality tradeoff or overclaimed proof level | Tighten proof contract or label the lower proof level honestly |
| Encoded mitigation rate up, recurrence down | Learning is compounding | Promote mitigation pattern into standard harness capability |
| Encoded mitigation rate up, recurrence flat | The team is writing mitigations that do not kill the difficulty | Audit mitigation quality and discoverability |
| Proof trust high, false-pass high | Trust is miscalibrated; UX/proof labels may be overconfident | Improve proof explanation and reduce overclaiming |
| Intervention rate high, expert escalation low | Could mean healthy operator steering or silent abandonment | Add abandonment/redirect reason capture and segment by task type |
| DORA improves, local proof quality worsens | Downstream outcome may be driven by confounders or risky shortcuts | Do not claim MiniH causality without local leading evidence |

---

## Reporting Rules

1. **Say value, not velocity, when you mean value.** Velocity without proof and outcome context is motion.
2. **Use "aligned with" for local MiniH metrics.** Time to Validated Evidence is local; it is aligned with SPACE/ESSP/DORA guidance, not a named framework metric.
3. **Segment by task type and proof level.** Do not average fresh setup, code changes, research decisions, and failure recovery into one productivity number.
4. **Report team/system level by default.** Individual traces are for debugging and opt-in self-review, not leadership scoring.
5. **Include provenance.** Every chart should expose source, date range, response rate where relevant, harness version, task type, and proof contract.
6. **Pair hard and soft signals.** If telemetry improves but trust/flow falls, treat that as a warning, not a rounding error.
7. **Keep DORA downstream.** DORA is valuable, but it is not the whole MiniH impact story.
8. **Measure improvement, not competition.** Avoid cross-team leaderboards unless teams share context, architecture, mission, and consent.

---

## Open Questions

### Q1: Should MiniH's north star be speed?

**RESOLVED**: No. The north star should be value delivery through validated evidence. Speed only matters when it reduces time to proof or time to decision without weakening quality, trust, or flow.

### Q2: Can agents measure developer flow state?

**RESOLVED**: Not directly. Agents can provide flow proxies such as retries, repeated reads, context compactions, failed discovery, and escalation candidates. Human pulse surveys own flow-state experience.

### Q3: Should PR count or lines of code appear anywhere?

**RESOLVED**: They may appear as activity/context metrics, never as success metrics. They must be paired with proof quality, rework, and value outcomes.

### Q4: What proof level should count as validated in v1?

**RECOMMENDATION**: Default to L5 for setup/change benchmarks: real request plus expected state/system side-effect proof. Allow lower proof levels only when the task explicitly defines a lower proof contract.

### Q5: Should MiniH implement a metric registry as code/config?

**OPEN / RECOMMENDED YES**: The literature traceability workshop already suggests storing traceability metadata beside metric definitions. This workshop strengthens that recommendation because ethos and caveats need to travel with the metric, not live only in prose.

### Q6: Should MiniH include DORA integrations in v1?

**OPEN**: DORA is downstream and valuable, but MiniH's first credible product slice can focus on local harness/agent measurement. If DORA is included, label source version and integration assumptions explicitly.

### Q7: How much transcript/log evidence should be retained?

**OPEN**: Default should be proof metadata and redacted excerpts, not raw transcript/log retention. This needs a privacy/redaction workshop before implementation.

### Q8: What is the metric review cadence?

**OPEN / RECOMMENDATION**: Review the scorecard rhythm explicitly. Per-run diagnostics are useful for operators; weekly summaries are safer for team improvement; quarterly review is better for metric taxonomy and survey calibration. Avoid real-time executive dashboards that encourage micro-optimization.

### Q9: How much survey load is acceptable?

**OPEN / RECOMMENDATION**: Treat surveys as developer attention cost. Start with optional post-failure/post-proof prompts plus a short monthly rollout pulse, then move to quarterly steady-state. Keep the total operator burden small and close the loop by showing what changed because of feedback.

### Q10: What causal claims can MiniH make?

**OPEN / RECOMMENDATION**: V1 should make local capability claims, not broad DORA causality claims. A later causal-evaluation workshop should consider pre/post, benchmark probes, interrupted time series, and matched cohorts if stakeholders need stronger attribution.

---

## Future Workshop Candidates

| Workshop | Why |
|---|---|
| Proof-level semantics and examples | Prevents L3/L5/L6 overclaiming and makes proof quality comparable |
| Survey instrument and rollout | Defines questions, cadence, response-rate provenance, anonymity, and feedback loop |
| Privacy/redaction and retention | Decides what prompt/log/proof data can be stored and for how long |
| Causal evaluation design | Separates local leading evidence from downstream DORA/business attribution |
| Metric registry as code/config | Keeps traceability, caveats, source versions, and reporting rules beside metric definitions |

---

## Quick Reference

| If someone says... | MiniH should answer... |
|---|---|
| "Did agents make us faster?" | "Did time from intent to validated evidence fall, at the same or better proof level?" |
| "Are developers producing more code?" | "Are teams producing more verified useful work with less human rescue and rework?" |
| "Can we just use DORA?" | "Use DORA downstream, but MiniH acts upstream on access, learning speed, proof quality, and cognitive load." |
| "Can agents tell us if developers are happier?" | "Agents can classify friction. Humans report human experience." |
| "What's the executive story?" | "The engineering system is becoming easier to enter, safer to change, and faster to learn from; downstream delivery should improve because those causes improve." |

```text
MiniH scorecard v1:

1. North star: Time to Validated Evidence by task type + proof level
2. Access: Time to Verified Working Context / first-run success
3. Quality: L5+ proof share / completeness / reproducibility / false-pass candidates
4. Learning: difficulty half-life / encoded mitigation / recurrence
5. Load: expert escalation / manual intervention / cognitive-load pulse
6. Trust: proof trust / failure clarity / safer-to-change confidence
7. Downstream: DORA/ESSP outcomes when integrations exist
```
