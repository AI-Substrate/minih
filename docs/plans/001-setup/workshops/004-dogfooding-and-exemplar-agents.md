# Workshop: Dogfooding & Exemplar Agents

**Type**: Integration Pattern
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-02T13:35:00Z
**Status**: Draft

**Related Documents**:
- [001 Magic Wand Feedback Loop](./001-magic-wand-feedback-loop.md) — retrospective contract these agents implement
- [002 CLI Command Design](./002-cli-command-design.md) — commands these agents exercise
- [003 Agent Folder Convention](./003-agent-folder-convention.md) — convention these agents demonstrate

---

## Purpose

Design the set of minih agents that run against minih itself. These agents serve a dual purpose: they **validate minih works** (testing) and they **teach users how to use minih** (exemplar). Every feature of minih should be demonstrated by at least one dogfood agent. When someone asks "how do I write an agent?", the answer is "look at the ones minih uses on itself."

## Key Questions Addressed

- What dogfood agents should minih ship with?
- How does each agent exercise a different minih feature?
- What's the development timeline — when can we start dogfooding?
- How do these agents form a progression from simple to advanced?

---

## The Dogfood Philosophy

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   minih builds minih.                                               │
│                                                                     │
│   The agents that test minih ARE the documentation.                 │
│   The agents that validate conventions ARE the reference impls.     │
│   The magic wand feedback FROM these agents drives minih's roadmap. │
│                                                                     │
│   When a user asks "show me how", you point at agents/ and say     │
│   "this is how we build this tool."                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this matters:**

- **No stale docs** — the agents run regularly, so they always reflect reality
- **Real feedback** — magic wand wishes from dogfood agents surface real UX problems
- **Progressive complexity** — agents range from "just prompt.md" to "input schema + output schema + instructions + cross-agent reads"
- **Proof by existence** — if minih can't run its own agents well, it's not ready

---

## The Dogfood Agent Catalogue

Six agents, ordered from simplest to most complex. Each demonstrates specific minih features.

### Agent 1: `hello-world` — The Minimum Viable Agent

**What it does**: Says hello, reports its environment, confirms minih is working.

**Why it exists**: Proves the simplest possible agent works. Shows users the absolute minimum to get started.

**Features demonstrated**:
- ✅ Minimum viable agent (just `prompt.md` with frontmatter)
- ✅ No schema, no instructions, no params
- ✅ Run artifacts created automatically
- ❌ No output validation
- ❌ No retrospective (intentionally — shows what happens without it)

**Folder structure**:
```
agents/hello-world/
└── prompt.md
```

**prompt.md**:
```markdown
---
description: "Confirm minih is working by reporting your environment and capabilities"
tags: [smoke, minimal]
---

# Hello World

You are running inside minih. Confirm this by:

1. Run `pwd` and report your working directory
2. Run `minih list --json` and report what agents you see
3. Report the current date and time
4. Describe what tools you have available

Write your findings as a brief summary to stdout. No structured output needed.
```

**What users learn**: You only need one file. Frontmatter gives you discoverability. The agent gets full tool access.

---

### Agent 2: `convention-check` — The Validator Agent

**What it does**: Runs `minih doctor --json` and reports on the health of the agents directory. Validates that all agents follow conventions.

**Why it exists**: Tests the `doctor` command from the inside. Produces a structured report about convention compliance.

**Features demonstrated**:
- ✅ Output schema with retrospective (full schema validation)
- ✅ Instructions.md (agent identity/rules)
- ✅ Consumer 1 pattern — agent invokes minih CLI from inside a run
- ✅ Demonstrates the self-improving loop (reports back on the doctor command UX)

**Folder structure**:
```
agents/convention-check/
├── prompt.md
├── output-schema.json
└── instructions.md
```

**prompt.md**:
```markdown
---
description: "Validate all minih agents follow folder conventions, frontmatter, and schema rules"
tags: [ci, validation, conventions]
---

# Convention Check

## Objective

Audit the minih agents directory for convention compliance. Run the doctor
command and produce a detailed report with findings and recommendations.

## Tasks

### 1. Run Doctor

```bash
minih doctor --json
```

Capture the full JSON output. Parse the results.

### 2. Analyze Each Agent

For each agent reported by doctor:
- Is frontmatter present and valid?
- Does the output schema compile?
- Is retrospective included in the output schema?
- Does the agent have instructions?

### 3. Check Preamble

Verify `_shared/preamble.md` exists and contains the feedback loop section.

### 4. Report

Write a structured report with:
- Overall health status
- Per-agent findings
- Recommendations for agents that need attention
- Your retrospective on the doctor command UX

## Output

Write your report to the output hint path. It must conform to output-schema.json.
```

**output-schema.json**:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Convention Check Report",
  "type": "object",
  "required": ["overallHealth", "agents", "preamble", "recommendations", "retrospective"],
  "additionalProperties": true,
  "properties": {
    "overallHealth": {
      "type": "string",
      "enum": ["healthy", "warnings", "errors"],
      "description": "Overall convention health status."
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["slug", "status", "checks"],
        "additionalProperties": true,
        "properties": {
          "slug": { "type": "string" },
          "status": { "type": "string", "enum": ["pass", "warning", "fail"] },
          "checks": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["check", "status"],
              "additionalProperties": true,
              "properties": {
                "check": { "type": "string" },
                "status": { "type": "string", "enum": ["pass", "warning", "fail", "skip"] },
                "message": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "preamble": {
      "type": "object",
      "required": ["exists"],
      "additionalProperties": true,
      "properties": {
        "exists": { "type": "boolean" },
        "hasFeedbackSection": { "type": "boolean" }
      }
    },
    "recommendations": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Actionable recommendations for improving convention compliance."
    },
    "retrospective": {
      "type": "object",
      "required": ["workedWell", "confusing", "magicWand"],
      "additionalProperties": true,
      "properties": {
        "workedWell": { "type": "string", "minLength": 10 },
        "confusing": { "type": "string", "minLength": 10 },
        "magicWand": { "type": "string", "minLength": 20 },
        "improvementSuggestions": {
          "type": "array",
          "items": { "type": "string", "minLength": 10 }
        }
      }
    }
  }
}
```

**What users learn**: How to write an output schema with retrospective. How to invoke minih commands from inside an agent. How instructions.md shapes agent identity.

---

### Agent 3: `prompt-review` — The Input-Accepting Agent

**What it does**: Reviews another agent's `prompt.md` for clarity, completeness, and convention compliance. Takes an agent slug as input.

**Why it exists**: Tests input schema validation. Demonstrates the `--param` flow. Agent reads another agent's files — cross-agent data flow.

**Features demonstrated**:
- ✅ Input schema (requires `agent_slug` parameter)
- ✅ Input validation (fail fast if param missing)
- ✅ Cross-agent file reading (reads target agent's prompt, instructions, schema)
- ✅ Output schema with retrospective
- ✅ Instructions with persona

**Folder structure**:
```
agents/prompt-review/
├── prompt.md
├── output-schema.json
├── input-schema.json
└── instructions.md
```

**input-schema.json**:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Prompt Review Input",
  "type": "object",
  "required": ["agent_slug"],
  "properties": {
    "agent_slug": {
      "type": "string",
      "description": "Slug of the agent whose prompt to review (e.g., 'convention-check')."
    }
  }
}
```

**prompt.md**:
```markdown
---
description: "Review another agent's prompt.md for clarity, completeness, and minih conventions"
tags: [review, quality, prompts]
---

# Prompt Review

## Objective

Review the agent specified by the `agent_slug` input parameter. Assess its
prompt.md, instructions.md, and schemas for quality and convention compliance.

## Tasks

### 1. Locate the Agent

Read the agent's files from the agents directory:
- `agents/{agent_slug}/prompt.md` — the main prompt
- `agents/{agent_slug}/instructions.md` — if present
- `agents/{agent_slug}/output-schema.json` — if present
- `agents/{agent_slug}/input-schema.json` — if present

If the agent doesn't exist, report an error in your output.

### 2. Review Prompt Quality

Assess the prompt.md for:
- **Clarity**: Is the objective clear? Would an LLM know what to do?
- **Completeness**: Are tasks specific enough? Are edge cases addressed?
- **Frontmatter**: Is description present and accurate?
- **Output instructions**: Does it reference the output hint and schema?
- **Retrospective reminder**: Does it ask for magic wand feedback?

### 3. Review Schema Quality

If output-schema.json exists:
- Does it include retrospective with magicWand required?
- Are descriptions present on all fields?
- Does it use appropriate constraints (minLength, enum, etc.)?

### 4. Report

Write findings with specific suggestions for improvement.

## Output

Write your report to the output hint path.
```

**Usage**:
```bash
minih run prompt-review --param agent_slug=convention-check
```

**What users learn**: How to define input parameters. How `--param` works. How one agent can read another agent's files. Shows `minih list` revealing required params.

---

### Agent 4: `smoke-test` — The Full-Loop Agent

**What it does**: Exercises the full minih lifecycle — init, run, validate, history, tail. Creates a temporary agent, runs it, validates the output, and reports results.

**Why it exists**: End-to-end integration test of minih itself. Tests that every command works together.

**Features demonstrated**:
- ✅ Full CLI exercise (init → run → check → history → validate → last-run)
- ✅ Complex multi-step task
- ✅ Creates and destroys temporary agents (tests init)
- ✅ Self-validation with `minih check` mid-run
- ✅ Rich output schema

**prompt.md**:
```markdown
---
description: "End-to-end smoke test of all minih CLI commands and the full agent lifecycle"
tags: [smoke, ci, integration, e2e]
---

# Minih Smoke Test

## Objective

Exercise every minih command to verify the full agent lifecycle works.
Create a temporary agent, run it, validate outputs, check history, and report.

## Tasks

### 1. List Agents

```bash
minih list --json
```

Record the count and slugs. Verify this agent (smoke-test) appears.

### 2. Doctor Check

```bash
minih doctor --json
```

Verify the harness is healthy. Record any warnings.

### 3. Create Temporary Agent

```bash
minih init _smoke-temp --with-input
```

Verify the folder was created with prompt.md, output-schema.json, input-schema.json.

### 4. Verify List Updated

```bash
minih list --json
```

Verify `_smoke-temp` now appears. (Note: it won't — underscore prefix is skipped.
Use `smoke-temp` instead.)

Correction: use `minih init smoke-temp` (no underscore).

### 5. Inspect Scaffolded Files

Read the generated files and verify:
- prompt.md has frontmatter with description
- output-schema.json has retrospective required
- Templates are valid

### 6. Run the Temp Agent

```bash
minih run smoke-temp --timeout 120
```

Capture the result. It should complete (even if degraded — the template prompt
is generic).

### 7. Check History

```bash
minih history smoke-temp --json
```

Verify at least one run appears.

### 8. Validate Output

```bash
minih validate smoke-temp --json
```

Record validation result.

### 9. Last Run Info

```bash
minih last-run smoke-temp --json
```

Verify runDir and reportPath are present.

### 10. Cleanup

Remove the temporary agent folder:
```bash
rm -rf agents/smoke-temp
```

### 11. Report

Compile all results into the structured output. Include pass/fail for each step.

### 12. Retrospective

Reflect on the full minih experience. What was smooth? What was confusing?
What would your magic wand fix?
```

**What users learn**: The full CLI lifecycle demonstrated step-by-step. How init scaffolds files. How commands compose. What the full agent loop looks like in practice.

---

### Agent 5: `feedback-digest` — The Aggregator Agent

**What it does**: Reads magic wand feedback from ALL agents' recent runs and produces a prioritized improvement digest.

**Why it exists**: Closes the self-improving loop. Demonstrates cross-agent data aggregation. Produces actionable output that drives the minih roadmap.

**Features demonstrated**:
- ✅ Cross-agent data reading (reads every agent's run artifacts)
- ✅ Aggregation pattern (many runs → prioritized digest)
- ✅ No input params needed (scans everything)
- ✅ The feedback loop completing its cycle

**prompt.md**:
```markdown
---
description: "Aggregate magic wand feedback from all agents' recent runs into a prioritized improvement digest"
tags: [feedback, meta, roadmap]
---

# Feedback Digest

## Objective

Read the magic wand feedback from all minih agents' recent runs and produce
a prioritized improvement digest. This is how minih improves itself.

## Tasks

### 1. Discover All Agents

```bash
minih list --json
```

### 2. Read Recent Feedback

For each agent, find the 5 most recent runs and extract the retrospective:

```bash
for each agent slug:
  minih history <slug> --json
  # For each recent run, read:
  #   agents/<slug>/runs/<runId>/output/report.json
  #   Extract .retrospective.magicWand, .retrospective.confusing,
  #           .retrospective.improvementSuggestions
```

### 3. Analyze Themes

Group feedback into themes:
- CLI usability
- Convention clarity
- Error messages
- Missing features
- Documentation gaps

### 4. Prioritize

Rank themes by:
- Frequency (how many agents mention it)
- Impact (how much it affects the workflow)
- Feasibility (how easy to fix)

### 5. Produce Digest

Write a prioritized list of improvements with supporting quotes from agents.

## Output

Write your digest to the output hint path.
```

**What users learn**: How to build agents that aggregate data from other agents. The feedback loop in action. Real-world useful output.

---

### Agent 6: `self-review` — The Meta Agent

**What it does**: Reviews minih's own source code for quality, patterns, and consistency.

**Why it exists**: Code review agent that targets minih itself. Tests input params with a real use case. Produces the most complex output schema.

**Features demonstrated**:
- ✅ Input schema (file_path parameter)
- ✅ Complex output schema (findings, verdict, retrospective)
- ✅ Instructions with detailed persona and rules
- ✅ Full Chainglass code-review pattern adapted for minih

**Usage**:
```bash
minih run self-review --param file_path=src/runner/runner.ts
```

**What users learn**: A production-grade agent with complex schemas, detailed instructions, and rich structured output. The most complete reference implementation.

---

## Feature Coverage Matrix

Every minih feature should be exercised by at least one dogfood agent:

| Feature | hello-world | convention-check | prompt-review | smoke-test | feedback-digest | self-review |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| Minimum viable (just prompt.md) | ✅ | | | | | |
| Frontmatter with description | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Frontmatter with tags | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Output schema | | ✅ | ✅ | ✅ | ✅ | ✅ |
| Input schema | | | ✅ | | | ✅ |
| Instructions.md | | ✅ | ✅ | | | ✅ |
| Retrospective in schema | | ✅ | ✅ | ✅ | ✅ | ✅ |
| `minih list` invocation | | ✅ | | ✅ | ✅ | |
| `minih doctor` invocation | | ✅ | | ✅ | | |
| `minih check` self-validation | | | | ✅ | | |
| `minih history` invocation | | | | ✅ | ✅ | |
| `minih init` invocation | | | | ✅ | | |
| Cross-agent file reads | | | ✅ | | ✅ | |
| `--param` input flow | | | ✅ | | | ✅ |
| `--dry-run` | | | | ✅ | | |
| Complex multi-step task | | | | ✅ | ✅ | ✅ |
| No output schema (unvalidated) | ✅ | | | | | |
| Degraded handling (intentional) | ✅ | | | | | |

**Coverage**: Every minih feature has ≥1 dogfood agent exercising it. ✅

---

## Development Timeline

Dogfood agents are introduced incrementally as minih features become available:

```
Phase 1: Types + Adapter Interface
  └── No agents yet (nothing to run)

Phase 2: Runner Core
  └── hello-world can run (if adapter is wired)

Phase 3: SDK Adapter
  └── hello-world runs for real ← FIRST DOGFOOD MOMENT
  └── convention-check can run (tests basic CLI)

Phase 4: CLI Commands
  └── All agents can run
  └── convention-check exercises doctor
  └── smoke-test exercises full lifecycle
  └── prompt-review exercises input params

Phase 5: Init + Scaffolding
  └── smoke-test exercises init
  └── All dogfood agents are complete

Phase 6: Dogfood + Polish
  └── Run ALL dogfood agents
  └── Read their magic wand feedback
  └── Fix what they report
  └── Run them again
  └── Repeat until feedback stabilizes
  └── feedback-digest produces the first real improvement roadmap
```

**The key moment**: Phase 3 completion. The first time `minih run hello-world` works end-to-end, the dogfood loop begins. Every subsequent phase should run the available dogfood agents as part of validation.

---

## The Progression: Simple → Advanced

The agents form a teaching progression. A new user reads them in order:

```
1. hello-world         "Oh, it's just a prompt.md file. That's it?"
     │
     ▼
2. convention-check    "I can add a schema and instructions. The agent
     │                  can call minih commands from inside."
     ▼
3. prompt-review       "I can take input params. One agent can read
     │                  another agent's files."
     ▼
4. smoke-test          "I can exercise the full CLI. The agent can create
     │                  and clean up resources."
     ▼
5. feedback-digest     "I can aggregate data across ALL agents' runs.
     │                  The feedback loop actually works."
     ▼
6. self-review         "This is a production-grade agent. Complex schema,
                        detailed persona, real code review output."
```

Each agent adds exactly one or two new concepts. No agent requires understanding all of minih at once.

---

## README.md Integration

The README should point directly at the dogfood agents:

```markdown
## Examples

minih ships with agents that it uses to test and improve itself.
These are the best examples of how to write agents:

| Agent | Complexity | What It Demonstrates |
|-------|-----------|---------------------|
| [`hello-world`](agents/hello-world/) | Minimal | Just a prompt — the simplest possible agent |
| [`convention-check`](agents/convention-check/) | Basic | Output schema, instructions, CLI invocation |
| [`prompt-review`](agents/prompt-review/) | Intermediate | Input params, cross-agent file reading |
| [`smoke-test`](agents/smoke-test/) | Advanced | Full CLI lifecycle test |
| [`feedback-digest`](agents/feedback-digest/) | Advanced | Cross-agent aggregation, feedback loop |
| [`self-review`](agents/self-review/) | Complete | Production-grade code review agent |

Start with `hello-world`, then read through in order.
Each agent builds on the concepts introduced by the previous one.
```

---

## Magic Wand Feedback → Minih Roadmap

The feedback from dogfood agents IS the minih improvement backlog:

```
┌────────────────┐
│ Run dogfood    │
│ agents         │──┐
└────────────────┘  │
                    ▼
┌────────────────────────────────────────────────────┐
│ feedback-digest agent reads all magic wand wishes  │
│ and produces prioritized improvement list          │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────┐
│ Human reviews digest:                              │
│                                                    │
│   Priority 1: "minih check should show which       │
│   specific schema field failed, not just the       │
│   AJV error path" (3 agents mentioned this)        │
│                                                    │
│   Priority 2: "minih history should show the       │
│   magic wand from each run inline" (2 agents)      │
│                                                    │
│   Priority 3: "dry-run should also validate        │
│   input params, not just show the prompt"           │
│   (1 agent)                                        │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────┐
│ Fix issues     │
│ in minih       │──► Run dogfood agents again → new feedback → repeat
└────────────────┘
```

**The preamble evidence table gets real entries:**

```markdown
| Agent Said | What Happened |
|-----------|---------------|
| convention-check: "doctor --json output doesn't include description from frontmatter" | Added description field to doctor output |
| smoke-test: "minih init creates output-schema but doesn't include description in fields" | Fixed init template schema |
| prompt-review: "No way to check if an agent exists without listing all of them" | Added minih check-exists <slug> |
```

---

## Open Questions

### Q1: Should dogfood agents ship in the npm package?

**RESOLVED**: Yes. They live in `agents/` in the repo and ship as part of the package. Users can delete them or keep them as reference. `npx minih list` shows them immediately — zero to "see how it works."

### Q2: When is the dogfood loop "done"?

**OPEN**: The loop never ends — that's the point. But for V1 ship readiness:
- All 6 dogfood agents run successfully
- Magic wand feedback has been acted on at least once (one cycle completed)
- feedback-digest produces a coherent improvement list
- No agent reports blockers or critical confusions

### Q3: Should dogfood agents gitignore their runs?

**RESOLVED**: Yes — `agents/*/runs/` in `.gitignore`. The agent definitions are committed; the run artifacts are ephemeral.

---

## Summary

| Agent | Complexity | Key Feature Demonstrated | Earliest Phase |
|-------|-----------|-------------------------|----------------|
| `hello-world` | Minimal | Just prompt.md | Phase 3 |
| `convention-check` | Basic | Output schema, CLI invocation | Phase 4 |
| `prompt-review` | Intermediate | Input params, cross-agent reads | Phase 4 |
| `smoke-test` | Advanced | Full lifecycle test | Phase 5 |
| `feedback-digest` | Advanced | Cross-agent aggregation | Phase 5 |
| `self-review` | Complete | Production-grade agent | Phase 4 |

**The dogfood agents are not an afterthought. They are the proof that minih works, the documentation for how to use it, and the mechanism by which it improves itself.**
