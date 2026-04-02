# Workshop: Magic Wand Feedback Loop

**Type**: Data Model
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-02T01:58:00Z
**Status**: Draft

**Related Documents**:
- [Research Dossier](../research-dossier.md) — sections on retrospective requirement, preamble
- [003 Agent Folder Convention](./003-agent-folder-convention.md)

---

## Purpose

Design the self-improving feedback mechanism that makes minih unique: every agent run MUST produce honest retrospective feedback including a "magic wand" wish. This workshop clarifies the schema, enforcement strategy, storage, and how feedback flows back into improvement.

## Key Questions Addressed

- How is magic wand feedback structured in the output schema?
- Is enforcement done via preamble prompt, output schema validation, or both?
- How does accumulated feedback get surfaced and acted on?
- What does the minih-generic version look like (vs. Chainglass-specific)?

---

## How It Works in Chainglass Today

The source repo enforces feedback through **two complementary mechanisms**:

### 1. Preamble Instruction (Prompt-Level)

From `harness/agents/_shared/preamble.md`:

```markdown
## The Most Important Part: Feedback

You are not just running a task. You are dogfooding this harness — using it
as a real user would. Your honest feedback is the single most valuable thing
you produce, because it directly improves the product for every agent that
runs after you.

Every agent output MUST include a `retrospective` with a required `magicWand`
field. This is non-negotiable.
```

The preamble then provides:
- **Examples** of bad vs. good feedback (teaching quality)
- **Field definitions** for `workedWell`, `confusing`, `magicWand`, `improvementSuggestions`
- **Evidence table** showing past feedback that shipped as fixes

### 2. Output Schema Validation (Schema-Level)

Every agent's `output-schema.json` includes a required `retrospective` object:

```json
{
  "retrospective": {
    "type": "object",
    "required": ["workedWell", "confusing", "magicWand"],
    "properties": {
      "workedWell": {
        "type": "string",
        "description": "What CLI commands were intuitive and worked well?"
      },
      "confusing": {
        "type": "string",
        "description": "What was confusing, unclear, or required trial-and-error?"
      },
      "magicWand": {
        "type": "string",
        "description": "If you could add or change one thing, what would it be? Be concrete."
      },
      "cliDiscoverability": {
        "type": "string"
      },
      "improvementSuggestions": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  }
}
```

`retrospective` appears in the top-level `required` array of every agent schema. If the agent omits it, the run status becomes **"degraded"** (not "failed") — the agent did work, but didn't fulfill the feedback contract.

### The Dual Enforcement Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│  PROMPT LAYER (preamble.md)                                     │
│                                                                 │
│  • Tells the agent WHY feedback matters                         │
│  • Provides examples of good vs bad feedback                    │
│  • Shows evidence that past feedback shipped as real fixes      │
│  • Creates social/moral motivation                              │
│                                                                 │
│  Effect: Agent WANTS to give feedback                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SCHEMA LAYER (output-schema.json)                              │
│                                                                 │
│  • Makes retrospective a required field                         │
│  • Makes magicWand required within retrospective                │
│  • Validator enforces at run completion                          │
│  • Missing = "degraded" status (not failure, but visible)       │
│                                                                 │
│  Effect: Agent MUST give feedback (or run is flagged)           │
└─────────────────────────────────────────────────────────────────┘
```

**Why both?** The prompt teaches quality; the schema enforces existence. An agent that only has schema enforcement would produce `"magicWand": "n/a"`. The preamble's examples and evidence table motivate genuinely useful feedback.

---

## Minih Design: The Retrospective Contract

### Core Decision: Dual Enforcement (Same Pattern)

Minih preserves the Chainglass pattern but makes it **generic** — not tied to harness CLI commands or Chainglass infrastructure.

### The Retrospective Schema Fragment

This is the **canonical schema fragment** that minih provides. Agent authors are encouraged to include it in their `output-schema.json` via the shared fragment or by copying the shape.

```typescript
/** The retrospective contract — every agent should include this in its output. */
interface Retrospective {
  /** What about the experience worked well? Be specific about WHY. */
  workedWell: string;

  /** What was confusing, unclear, or required trial-and-error? */
  confusing: string;

  /**
   * REQUIRED. If you had a magic wand, what ONE thing would you change
   * about the tools, workflow, or environment to make your job easier?
   * Be concrete: name a specific command, flag, format, or workflow.
   */
  magicWand: string;

  /** 1-3 specific, actionable improvement suggestions. */
  improvementSuggestions?: string[];
}
```

### JSON Schema (Shipped with minih)

```json
{
  "$id": "https://minih.dev/schemas/retrospective.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Agent Retrospective",
  "description": "Self-improving feedback from an agent run. The magicWand field is the most important — one concrete wish for a better experience.",
  "type": "object",
  "required": ["workedWell", "confusing", "magicWand"],
  "additionalProperties": true,
  "properties": {
    "workedWell": {
      "type": "string",
      "minLength": 10,
      "description": "What about the experience worked well? Be specific about WHY."
    },
    "confusing": {
      "type": "string",
      "minLength": 10,
      "description": "What was confusing, unclear, or required trial-and-error?"
    },
    "magicWand": {
      "type": "string",
      "minLength": 20,
      "description": "If you had a magic wand, what ONE thing would you change? Name a specific command, flag, format, or workflow improvement."
    },
    "improvementSuggestions": {
      "type": "array",
      "items": { "type": "string", "minLength": 10 },
      "minItems": 1,
      "maxItems": 5,
      "description": "1-5 specific, actionable improvements."
    }
  }
}
```

**Design choices:**
- **`minLength` on all fields**: Prevents `"n/a"` or `"none"` low-effort responses. `magicWand` requires at least 20 chars to force a real sentence.
- **`additionalProperties: true`**: Agents can add domain-specific feedback fields (e.g., `cliDiscoverability` in Chainglass).
- **`$id` for `$ref` usage**: Agent schemas can reference this fragment: `"retrospective": { "$ref": "https://minih.dev/schemas/retrospective.json" }`.
- **`improvementSuggestions` optional**: Not every agent has actionable suggestions — but `magicWand` is always required.

### Preamble Template (Shipped with `minih init`)

When `minih init` creates a new project or when the user creates `_shared/preamble.md`, minih provides this template section:

```markdown
## Feedback — The Self-Improving Loop

You are not just running a task. You are helping build a better system.
Every time you run, you have two responsibilities:

1. Complete your task well
2. Feed back honestly on the experience of doing it

Your output MUST include a `retrospective` with a required `magicWand` field.

**What makes good feedback:**

Bad: "Everything was fine."
Good: "The input params were validated before execution, which saved me from
discovering the wrong file_path halfway through a 5-minute run."

Bad: "Some things were confusing."
Good: "I couldn't tell whether output should be written to a relative or
absolute path — the output hint said '/full/path' but the schema description
said 'relative to run dir'."

**The retrospective fields:**

- **workedWell**: What about the tools, workflow, or environment was smooth?
  Be specific about WHY it worked.
- **confusing**: What required trial-and-error? What information was hard to
  find? What error messages were unhelpful?
- **magicWand** (REQUIRED): If you could add or change ONE thing to make your
  job easier, what would it be? Name a specific tool, command, flag, format,
  or workflow improvement. Be concrete.
- **improvementSuggestions**: 1-3 specific, actionable improvements.

This feedback loop is real. Previous agent feedback has been acted on:
<!-- Update this table as feedback ships -->
| Agent Said | What Happened |
|-----------|---------------|
| (your feedback will appear here) | (after it's acted on) |
```

### How `minih init` Scaffolds It

When creating a new agent with `minih init <slug>`:

1. If the agent gets `--with-output` (or default), the generated `output-schema.json` template **includes the retrospective fragment as a required field**:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "<Slug> Report",
  "type": "object",
  "required": ["result", "retrospective"],
  "properties": {
    "result": {
      "type": "object",
      "description": "Your agent's domain-specific output goes here."
    },
    "retrospective": {
      "$ref": "https://minih.dev/schemas/retrospective.json"
    }
  }
}
```

2. The generated `prompt.md` template includes a reminder:

```markdown
## Retrospective

After completing your tasks, include a `retrospective` in your output with
honest feedback. Your `magicWand` wish is the most valuable thing you produce.
```

---

## Feedback Storage & Surfacing

### Per-Run Storage (Automatic)

Feedback lives inside the run's `output/report.json` — no separate extraction needed. The `completed.json` metadata tracks whether the output validated (which includes the retrospective).

```
agents/my-agent/runs/2026-04-02T10-30-00-000Z-a1b2/
  output/
    report.json          ← contains retrospective as a required field
  completed.json         ← validated: true/false (reflects schema compliance)
```

### Feedback Surfacing (Future — Not V1)

V1 stores feedback in run artifacts. Future commands could surface it:

```bash
# Hypothetical future commands (NOT V1 scope)
minih feedback <slug>              # Show retrospective from latest run
minih feedback <slug> --all        # Show all retrospectives, newest first
minih feedback --magic-wands       # Show just magicWand wishes across all agents
```

For V1, users can extract feedback manually:

```bash
# Get the latest magicWand wish
cat agents/my-agent/runs/$(ls -t agents/my-agent/runs/ | head -1)/output/report.json \
  | jq '.retrospective.magicWand'
```

### The Improvement Cycle

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Agent Runs  │────►│  Feedback    │────►│  Human       │
│              │     │  Captured    │     │  Reviews     │
│  report.json │     │  in output   │     │  magicWands  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌──────────────┐              │
                     │  Next Run    │◄─────────────┘
                     │  Benefits    │  Prompt/tool/workflow
                     │  From Fix    │  improvements ship
                     └──────────────┘
```

---

## Degraded vs Failed

When an agent produces output but the `retrospective` is missing or malformed:

| Scenario | Run Status | Exit Code | Why |
|----------|-----------|-----------|-----|
| Output valid, retrospective present | `completed` | 0 | Everything worked |
| Output valid, retrospective missing | `degraded` | 0 | Agent did work but broke feedback contract |
| Output valid, magicWand empty string | `degraded` | 0 | Schema minLength check fails |
| Output invalid (not just retrospective) | `degraded` | 0 | Multiple schema issues |
| Agent threw error / no output at all | `failed` | 1 | Agent didn't complete |
| Agent timed out | `timeout` | 124 | Agent ran out of time |

**Key insight**: `degraded` is exit code 0, not 1. The agent did its job — it just didn't fulfill the feedback contract. This is a quality signal, not a failure mode. CI can filter on `degraded` if feedback compliance is enforced.

---

## Open Questions

### Q1: Should minih ship the retrospective schema as a standalone file?

**RESOLVED**: Yes. Ship at `node_modules/minih/schemas/retrospective.json` so agent schemas can `$ref` it. Also export as a TypeScript type from the package.

### Q2: Should feedback compliance be configurable?

**OPEN**: Should there be a config option to make retrospective truly optional (e.g., `feedback: false` in config)?
- Option A: Always required in schema template, but users can remove it from their schemas
- Option B: `minih.config` has `feedback: true/false` that controls whether init includes it
- **Recommendation**: Option A — make it the default, let users opt out by editing their schema. Don't build a toggle.

### Q3: Should `minLength` be enforced?

**RESOLVED**: Yes. Without `minLength`, agents write `"magicWand": "none"` which defeats the purpose. 20 chars for magicWand forces a real sentence. This is the lesson learned from the Chainglass preamble's "bad vs good" examples.

---

## Summary

| Aspect | Design |
|--------|--------|
| Enforcement | Dual: preamble teaches quality, schema enforces existence |
| Schema | `retrospective` object with required `workedWell`, `confusing`, `magicWand` |
| Min quality | `minLength: 20` on `magicWand`, `minLength: 10` on others |
| Missing feedback | Run status = `degraded` (exit 0, not failure) |
| Storage | Inside `output/report.json` alongside domain output |
| Surfacing (V1) | Manual (`jq` / read the file) |
| Surfacing (future) | `minih feedback` command family |
| Init scaffolding | Default `output-schema.json` includes retrospective as required |
| Preamble | Template section teaching good feedback with examples |
