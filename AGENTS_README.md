# Building Agents with minih

> **What is minih?** A standalone agent runner that executes declarative AI agents against `@github/copilot-sdk`. Every agent produces structured feedback about its own experience — what worked, what was confusing, and a **magic wand** wish for what should change. This feedback loop makes both the agents and the harness better over time.

---

## Philosophy: Self-Improving Systems

minih agents aren't fire-and-forget scripts. They're participants in a feedback loop:

```
You build an agent  →  Agent runs  →  Agent reports what could be better
                                              ↓
                          You improve the system  ←  Repeat
```

Every agent output MUST include a `retrospective` with three fields:
- **workedWell**: What about the tools, workflow, or environment was smooth?
- **confusing**: What required trial-and-error? What information was hard to find?
- **magicWand**: If you could change ONE thing to make your job easier, what would it be?

The `magicWand` is the most valuable thing an agent produces. It directly improves the system for every agent that runs after it. Be concrete — name a specific tool, command, flag, or workflow improvement.

---

## Install & Get Started

### From GitHub (no npm publish yet)

```bash
# Quickstart — zero to success in 60 seconds
export GH_TOKEN=$(gh auth token)
npx github:AI-Substrate/minih quickstart

# Or install for repeated use
git clone https://github.com/AI-Substrate/minih.git
cd minih && npm install && npm link
minih quickstart
```

### Prerequisites

- **Node.js ≥ 20.19.0**
- **GH_TOKEN**: `export GH_TOKEN=$(gh auth token)` — required for running agents
- **@github/copilot-sdk**: installed as a peer dependency in your project

---

## Agent = Folder

An agent is a folder with at least `prompt.md`:

```
agents/
├── _shared/
│   └── preamble.md              # Shared context injected into every agent
├── my-agent/
│   ├── prompt.md                # The prompt (REQUIRED — with YAML frontmatter)
│   ├── output-schema.json       # JSON Schema for structured output (optional)
│   ├── instructions.md          # Agent identity and rules (optional)
│   ├── input-schema.json        # Input parameter validation (optional)
│   └── runs/                    # Auto-created — run artifacts (gitignored)
│       └── 2026-04-06T.../
│           ├── prompt.md        # Frozen copy of prompt at run time
│           ├── events.ndjson    # Full event stream
│           ├── completed.json   # Run metadata (sessionId, duration, status)
│           └── output/
│               └── report.json  # Agent's structured output
```

### prompt.md

Must have YAML frontmatter with at least a `description`:

```markdown
---
description: Scan the project for common security issues
tags: [security, review]
---

# Security Scan

Scan the codebase for hardcoded secrets, SQL injection risks, and XSS vulnerabilities.
Report each finding with file path, line number, severity, and remediation.
```

### output-schema.json

Optional. Defines what your agent's output should look like (validated automatically after each run). System fields (`summary` + `retrospective`) are always required regardless of your schema.

### instructions.md

Optional. Agent identity, rules, and behavioral guidelines — injected after the preamble but before the prompt.

### input-schema.json

Optional. Validates `--param` inputs before the agent runs. Useful for agents that take file paths, feature names, etc.

---

## The Output Contract

Every agent must produce a JSON object with at minimum:

```json
{
  "summary": "A paragraph describing what you did and found.",
  "retrospective": {
    "workedWell": "What was smooth about this experience.",
    "confusing": "What required trial-and-error.",
    "magicWand": "The ONE thing you'd change to make your job easier."
  }
}
```

Your agent-specific fields go alongside these. The runner enforces this — if your agent doesn't produce `summary` + `retrospective`, the run is marked as "degraded."

---

## What Kinds of Agents Can You Build?

Agents are high-frequency dev-loop tools — think CI checks, code reviews, test validators. They run hundreds of times. Here are real examples from this repo:

| Agent | Purpose | Has Input? | Runs |
|-------|---------|-----------|------|
| **hello-world** | Environment check — confirms minih is working | No | On demand |
| **convention-check** | Audits all agents for folder convention compliance | No | After changes |
| **smoke-test** | Tests CLI lifecycle: list, doctor, init, dry-run, history | No | After CLI changes |
| **code-review** | Reviews code changes for correctness, domain compliance, anti-reinvention | No | After features |
| **prompt-review** | Reviews other agents' prompts for quality | Yes (slug) | After agent changes |
| **feedback-digest** | Aggregates magicWand feedback across all agents | No | Periodically |
| **first-time-experience** | Simulates a new user's first time using minih | Yes (minih_command) | After UX changes |

### Simple agent (no inputs, no custom schema)

Just `prompt.md`. System output validation handles the rest:

```markdown
---
description: Check that all TypeScript files compile
---

# Type Check

Run `npx tsc --noEmit` in the project and report any errors found.
Include the error count and list of files with errors.
```

### Agent with inputs

Add `input-schema.json` for validated parameters:

```json
{
  "type": "object",
  "required": ["file_path"],
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the file to review"
    }
  }
}
```

Run with: `minih run my-agent --param file_path=src/main.ts`

### Agent with structured output

Add `output-schema.json` to validate agent-specific fields:

```json
{
  "type": "object",
  "required": ["findings", "summary", "retrospective"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "severity", "issue"],
        "properties": {
          "file": { "type": "string" },
          "severity": { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] },
          "issue": { "type": "string" }
        }
      }
    }
  }
}
```

---

## CLI Quick Reference

```bash
# Quickstart
minih quickstart                 # Scaffold + run hello-world in one command

# Scaffold
minih init my-agent              # Create agent folder with templates
minih init my-agent --with-input # Also create input-schema.json

# Validate
minih doctor                     # Check all agents for convention compliance
minih check my-agent --file output.json  # Validate file against schema

# Run
minih run my-agent               # Execute (pretty streaming output)
minih run my-agent --dry-run     # Preview assembled prompt
minih run my-agent --verbose     # Timestamped event log
minih run my-agent --param key=value     # Pass input parameters

# Inspect
minih list                       # Show all agents
minih history my-agent           # Past runs with status
minih last-run my-agent          # Latest run path
minih validate my-agent          # Re-validate latest output
minih tail my-agent              # Follow live event stream

# Continue
minih resume my-agent "You missed the tests"  # Follow-up message
minih connect my-agent           # Print copilot CLI resume command
```

---

## Runtime Environment

When your agent runs, minih sets these environment variables:

| Variable | Value |
|----------|-------|
| `MINIH` | `1` — you're inside a minih run |
| `MINIH_AGENT_SLUG` | Agent slug (e.g., `smoke-test`) |
| `MINIH_RUN_DIR` | Absolute path to run artifacts folder |
| `MINIH_OUTPUT_PATH` | Where to write your JSON output |
| `MINIH_PROJECT_ROOT` | The actual project root (cd here first!) |

Your agent's working directory is the **run folder** (for session isolation), not the project root. Always `cd $MINIH_PROJECT_ROOT` before running project commands.

---

## Tips for Good Agents

1. **Be specific in your prompt** — "scan src/ for XSS" beats "find security issues"
2. **Validate before finishing** — run `minih check` at the end to catch schema issues
3. **Use the dry-run** — `minih run my-agent --dry-run` shows exactly what the LLM sees
4. **Write honest retrospectives** — the magicWand feedback is how the system improves
5. **Keep agents focused** — one job per agent, run them often
6. **Use inputs for parameterized agents** — `--param file_path=...` + input-schema validation
7. **Don't nest `minih run` inside agents** — SDK session conflicts. Use `--dry-run` and other commands instead.

---

## Links

- **Repository**: [github.com/AI-Substrate/minih](https://github.com/AI-Substrate/minih)
- **Example agents**: [`agents/`](https://github.com/AI-Substrate/minih/tree/main/agents) in this repo
- **CLI reference**: [`README.md`](https://github.com/AI-Substrate/minih/blob/main/README.md)
