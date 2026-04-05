# Workshop: System Output Contract

**Type**: Data Model
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-05T02:09:00Z
**Status**: Draft

**Related Documents**:
- [001 Magic Wand Feedback Loop](./001-magic-wand-feedback-loop.md) — retrospective schema design
- [003 Agent Folder Convention](./003-agent-folder-convention.md) — prompt assembly order

---

## Purpose

Define a **system-level output contract** that minih enforces on every agent run, regardless of whether the agent has a custom `output-schema.json`. Every agent — even the most minimal one-file agent — must produce structured feedback that helps future generations improve the harness, the prompts, and the agent configurations.

---

## The Problem

Currently, output validation only happens when the agent defines `output-schema.json`. A minimal agent (just `prompt.md`) produces unstructured text and zero feedback. The self-improving loop breaks for simple agents — exactly the ones that need the most feedback because they're new and untested.

```
Agent with output-schema.json:
  ✅ Output validated
  ✅ Retrospective enforced (if in schema)
  ✅ Magic wand captured

Agent with just prompt.md:
  ❌ No validation
  ❌ No retrospective
  ❌ No magic wand
  ❌ No summary
  → Self-improving loop broken
```

## The Solution: System Output Fields

Every agent run produces output with two layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  SYSTEM OUTPUT (minih-enforced, always required)                │
│                                                                 │
│  summary: string       — single paragraph: what happened        │
│  retrospective: {      — self-improving feedback                │
│    workedWell: string  — what was smooth about the experience   │
│    confusing: string   — what was unclear or hard               │
│    magicWand: string   — one wish to improve harness/prompt     │
│  }                                                              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  AGENT OUTPUT (user-defined, optional)                          │
│                                                                 │
│  ...whatever the agent's output-schema.json defines...          │
│  (findings, verdict, health checks, etc.)                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### The System Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["summary", "retrospective"],
  "properties": {
    "summary": {
      "type": "string",
      "minLength": 20,
      "description": "Single paragraph summarizing what happened during this run."
    },
    "retrospective": {
      "type": "object",
      "required": ["workedWell", "confusing", "magicWand"],
      "properties": {
        "workedWell": {
          "type": "string",
          "minLength": 10,
          "description": "What about the experience worked well? Be specific."
        },
        "confusing": {
          "type": "string",
          "minLength": 10,
          "description": "What was confusing, unclear, or required trial-and-error?"
        },
        "magicWand": {
          "type": "string",
          "minLength": 20,
          "description": "If you had a magic wand, what ONE thing would you change about the harness, prompt, or agent config?"
        }
      }
    }
  }
}
```

---

## How It Works

### Prompt Assembly (Updated)

The runner injects a **system output instruction** into every prompt, after the agent's prompt body:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. PREAMBLE (_shared/preamble.md)              [if exists]     │
├─────────────────────────────────────────────────────────────────┤
│  2. INSTRUCTIONS (instructions.md)              [if exists]     │
├─────────────────────────────────────────────────────────────────┤
│  3. OUTPUT HINT                                 [always]        │
│     "Write your final JSON report to: <path>"                   │
├─────────────────────────────────────────────────────────────────┤
│  4. INPUT PARAMS (from --param)                 [if params]     │
├─────────────────────────────────────────────────────────────────┤
│  5. PROMPT (prompt.md body)                     [always]        │
├─────────────────────────────────────────────────────────────────┤
│  6. SYSTEM OUTPUT REQUIREMENTS                  [always, NEW]   │
│     "Your output MUST be valid JSON containing at minimum:      │
│      - summary: single paragraph of what you did                │
│      - retrospective: { workedWell, confusing, magicWand }      │
│      Additional fields from your output-schema are also         │
│      required if the schema exists."                            │
└─────────────────────────────────────────────────────────────────┘
```

**Key change**: The output hint now ALWAYS appears (not just when a schema exists), and the system output requirements are always appended last.

### Validation (Updated)

After the agent completes, the runner validates in two stages:

```
Agent output → report.json
    │
    ├── 1. SYSTEM VALIDATION (always)
    │   ├── Is it valid JSON?
    │   ├── Has "summary" field (string, minLength 20)?
    │   └── Has "retrospective" with workedWell, confusing, magicWand?
    │
    ├── 2. USER SCHEMA VALIDATION (if output-schema.json exists)
    │   └── Validate against the full user-defined schema
    │
    └── Result:
        ├── Both pass → "completed"
        ├── System fails → "degraded" (agent worked but broke system contract)
        ├── User fails → "degraded" (agent worked but broke user contract)
        └── Agent error → "failed"
```

### CompletedMetadata (Updated)

```typescript
interface CompletedMetadata {
  // ... existing fields ...
  validated: boolean | null;       // null only if system validation also skipped (shouldn't happen)
  validationErrors: string[];      // combined system + user errors
  systemValidated: boolean;        // NEW: did system fields pass?
  userValidated: boolean | null;   // NEW: did user schema pass? null if no schema
}
```

---

## What the Agent Sees

The system output instruction injected into every prompt:

```markdown
## Required Output Format

Your output MUST be a valid JSON object written to the path specified above.
At minimum, include these fields:

```json
{
  "summary": "A single paragraph describing what you did and what you found.",
  "retrospective": {
    "workedWell": "What about the tools, workflow, or environment was smooth? Be specific.",
    "confusing": "What was unclear, confusing, or required trial-and-error?",
    "magicWand": "If you could change ONE thing about this experience, what would it be? Be concrete — name a specific tool, command, or workflow improvement."
  }
}
```

The `retrospective.magicWand` field is the most valuable thing you produce.
Your feedback directly improves this system for every agent that runs after you.
```

---

## Implementation Changes

### runner.ts

1. **Always include output hint** — even without `output-schema.json`, the agent needs to know where to write
2. **Append system output requirements** to every prompt
3. **Always validate system fields** in output (new `validateSystemOutput()` function)
4. **Merge validation results** — system + user schema errors combined
5. **New metadata fields** — `systemValidated`, `userValidated`

### validator.ts

Add `validateSystemOutput(outputPath: string): ValidationResult` — validates the minimum system contract (summary + retrospective + magicWand). Uses the system schema (shipped at `src/schemas/system-output.json`).

### schemas/

Add `system-output.json` alongside existing `retrospective.json`. The system schema is a superset (adds `summary`).

---

## Interaction with User Schema

If the agent has `output-schema.json`, both validations run:

| Scenario | System Validation | User Validation | Result |
|----------|:---:|:---:|--------|
| Both pass | ✅ | ✅ | `completed` |
| System fails, user passes | ❌ | ✅ | `degraded` |
| System passes, user fails | ✅ | ❌ | `degraded` |
| Both fail | ❌ | ❌ | `degraded` |
| Agent error (no output) | — | — | `failed` |

**User schemas should include retrospective** (minih init scaffolds this), but even if they don't, the system validation catches missing feedback.

---

## Open Questions

### Q1: Should the system schema be strict about additional properties?

**RESOLVED**: No — `additionalProperties: true`. The agent can include any domain-specific fields alongside the required system fields.

### Q2: Should system validation errors be separate from user validation errors?

**RESOLVED**: Yes — `systemValidated` and `userValidated` as separate boolean fields in CompletedMetadata, but `validationErrors` is combined for display. This lets tools filter "did the agent fulfill the system contract?" separately from "did it fulfill the user's schema?"

### Q3: What if the agent writes non-JSON text as output?

**RESOLVED**: System validation catches this ("Output is not valid JSON"). Status = `degraded`. The raw text is preserved in `report.json` for debugging. The prompt clearly says "your output MUST be valid JSON."

---

## Summary

| Aspect | Design |
|--------|--------|
| System fields | `summary` (string, 20+ chars) + `retrospective` (workedWell, confusing, magicWand) |
| Enforcement | Always — every agent, even without output-schema.json |
| Prompt injection | System output requirements appended to every prompt |
| Validation | Two-stage: system first, then user schema (if exists) |
| Missing feedback | Run status = `degraded` (exit 0, not failure) |
| Metadata | New `systemValidated` + `userValidated` fields |
| Schema location | `src/schemas/system-output.json` shipped with package |
