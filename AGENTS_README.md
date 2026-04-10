# Building Agents with minih

> **What is minih?** A standalone agent runner that executes declarative AI agents against `@github/copilot-sdk`. Every agent produces structured feedback about its own experience — what worked, what was confusing, and a **magic wand** wish for what should change. This feedback loop makes both the agents and the harness better over time.

---

## Philosophy: The Harness Is the Product

> *The harness isn't a testing tool. It's a product improvement engine that happens to test things along the way. Every agent that runs is a user of your developer tools. Every retrospective is a usability study. Every magicWand is a feature request from someone who actually used the thing.*

Most teams treat their developer tooling as a cost center — something you build once, maintain grudgingly, and replace when it rots. minih inverts this. **Your developer tools are your most important product**, because every other product you build passes through them. A bad harness makes everything slower. A good harness makes everything faster. A self-improving harness makes everything *accelerate*.

The key insight: **every agent that uses your tools is a user study you didn't have to schedule.**

### The Feedback Loop

```
You build an agent  →  Agent runs  →  Agent reports what could be better
                                              ↓
                          You improve the system  ←  Repeat
```

Every agent output MUST include a `retrospective` with three fields:
- **workedWell**: What about the tools, workflow, or environment was smooth?
- **confusing**: What required trial-and-error? What information was hard to find?
- **magicWand**: If you could change ONE thing to make your job easier, what would it be?

### Two Layers of Feedback

Agents improve **two systems** simultaneously:

1. **The project** — the codebase, CLI tools, workflows, and developer experience your agent is testing or reviewing. If the project's `custom-cli --help` output is confusing, or a build step is flaky, or the docs are missing a critical flag — that's project feedback.

2. **minih itself** — the agent runner, validation, prompt assembly, and conventions. If minih's error messages were misleading, or you wish `minih status` showed more detail — that's minih feedback.

Both types are valuable. Different audiences will act on each. The `magicWand` should specify which layer it targets so improvements reach the right people.

### Why the Magic Wand Works

**It captures friction at the moment of friction.** Humans adapt — when a command is awkward, a human learns the workaround and stops noticing. Agents don't adapt. Every time something fails or is clumsy, the agent reports it. The same friction, surfaced fresh every run, until you fix it.

**It's concrete, not abstract.** The prompt demands specificity. Not "improve the CLI" but "add a `--viewport mobile` flag to the screenshot command." Not "better error messages" but "when validation fails, include the near-match property name."

**It creates a direct feedback→fix→verify loop.** The agent says "I wish X existed." You build X. The same agent runs again. If it stops wishing for X, the fix worked. The agent is both the user who requested the feature and the QA that validates it.

### The Compound Effect

**Week 1**: Agents can run basic tasks. Magic wands are about missing capabilities ("I can't do X"). You add basic features.

**Week 2**: Magic wands shift from "I can't" to "I can, but it's awkward." You add convenience.

**Week 4**: Magic wands focus on edge cases and polish. Your tooling is mature.

**Week 8**: New agents are productive on their first run because the preamble is comprehensive, the CLI is mature, and the evidence capture is reliable. Magic wands are now strategic ("auto-detect regressions by comparing outputs across runs").

Each improvement makes every future agent run slightly faster, slightly more reliable, slightly more productive. Since agents run *often* — dozens of times per day — the compound effect is dramatic.

### Real Magic Wands That Shipped

These aren't hypothetical — actual agent outputs that became actual fixes:

| Agent Said | What We Built |
|-----------|---------------|
| FTE agent: "A quickstart command would make first-time setup trivial" | `minih quickstart` — zero to success in 60 seconds |
| FTE agent: "Suppress the SQLite ExperimentalWarning noise" | `NODE_NO_WARNINGS=1` in SDK runtime |
| External agent: "No progress indicator during long tool calls" | Tool elapsed timer in pretty mode |
| External agent: "Validation errors lack suggestions for near-miss property names" | Fuzzy matching with Levenshtein distance |
| hello-world: "List the MINIH_* env vars somewhere discoverable" | Added env var table to shared preamble |

### Filing Issues for High-Value Improvements

Agents with `gh` CLI access can go further than just reporting magic wands — they can file issues directly on the minih repo for bugs or improvements they discover:

```bash
gh issue create --repo AI-Substrate/minih \
  --title "feat: <concise title>" \
  --body "<description with reproduction steps>"
```

This closes the loop even faster. The agent experiences friction, files an issue with full context, and the fix can land before the next run. See the preamble for agent-facing instructions.

---

## Install & Get Started

### Option 1: Quickstart (zero to success in 60 seconds)

```bash
export GH_TOKEN=$(gh auth token)
npx github:AI-Substrate/minih quickstart
```

This scaffolds a `hello-world` agent and runs it immediately. You'll see pretty streaming output, a structured JSON report, and your first magic wand feedback.

> **Pin a specific version**: `npx github:AI-Substrate/minih#v0.x.y quickstart`

### Option 2: Clone and link (for development)

```bash
git clone https://github.com/AI-Substrate/minih.git
cd minih
npm install
npm link

# Now 'minih' is available globally
minih quickstart
```

### Option 3: Add to an existing project

```bash
cd your-project

# Latest (HEAD)
npm install github:AI-Substrate/minih

# Or pin a release
npm install github:AI-Substrate/minih#v0.x.y

npx minih quickstart
```

### Prerequisites

| Requirement | How to get it |
|-------------|--------------|
| **Node.js ≥ 20.19.0** | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| **GH_TOKEN** | `export GH_TOKEN=$(gh auth token)` |
| **@github/copilot-sdk** | `npm install @github/copilot-sdk` (peer dependency) |

---

## Your First Agent: Step by Step

### 1. Scaffold the agent

```bash
minih init my-scanner
```

This creates:
```
agents/my-scanner/
├── prompt.md           # Your agent's mission
└── output-schema.json  # What your agent must produce
```

### 2. Write the prompt

Edit `agents/my-scanner/prompt.md`:

```markdown
---
description: Scan TypeScript files for TODO/FIXME comments
tags: [scan, quality]
---

# TODO Scanner

Scan all TypeScript files under `src/` for TODO and FIXME comments.

## Steps

1. Run `cd $MINIH_PROJECT_ROOT` to get to the project root
2. Use `grep -rn 'TODO\|FIXME' src/ --include='*.ts'` to find all occurrences
3. For each hit, record the file path, line number, and the comment text
4. Categorize by priority: FIXME = high, TODO = medium

Write your JSON report to $MINIH_OUTPUT_PATH.
```

### 3. Check it's valid

```bash
minih doctor
```

You should see your agent listed as `✓ healthy`.

### 4. Preview the assembled prompt

```bash
minih inspect my-scanner
```

This shows exactly what the LLM will see — preamble + instructions + your prompt + system requirements, with section markers and char counts.

### 5. Run it

```bash
export GH_TOKEN=$(gh auth token)
minih run my-scanner
```

You'll see pretty streaming output with tool calls, timing, and a final summary.

### 6. Review the output

```bash
# See the run summary
minih last-run my-scanner

# Validate the output
minih validate my-scanner

# Read the actual report
cat $(minih last-run my-scanner 2>/dev/null | jq -r '.data.reportPath')
```

---

## Agent = Folder

An agent is a folder under your agents directory with at least `prompt.md`:

```
agents/
├── _shared/
│   └── preamble.md              # Shared context injected into EVERY agent
├── my-agent/
│   ├── prompt.md                # The prompt (REQUIRED — with YAML frontmatter)
│   ├── output-schema.json       # JSON Schema for structured output (optional)
│   ├── instructions.md          # Agent identity and rules (optional)
│   ├── input-schema.json        # Input parameter validation (optional)
│   └── runs/                    # Auto-created — run artifacts (gitignored)
│       └── 2026-04-06T.../
│           ├── prompt.md        # Frozen copy of prompt at run time
│           ├── events.ndjson    # Full event stream (every tool call, message, etc.)
│           ├── completed.json   # Run metadata (sessionId, duration, result, validation)
│           └── output/
│               └── report.json  # Agent's structured output
```

Browse the [agents/](https://github.com/AI-Substrate/minih/tree/main/agents) folder in this repo for real examples.

### prompt.md — The Mission

Must have YAML frontmatter with at least a `description`. Optional frontmatter fields let you configure the model, reasoning effort, and timeout per agent:

```markdown
---
description: "Scan the project for common security issues"
tags: [security, review]
model: gpt-5.4           # Override default model (optional)
reasoning: xhigh          # Reasoning effort: low, medium, high, xhigh (optional)
timeout: 1200             # Timeout in seconds (optional, default: 900)
---

# Security Scan

Scan the codebase for hardcoded secrets, SQL injection risks, and XSS vulnerabilities.
Report each finding with file path, line number, severity, and remediation.
```

**Model priority**: CLI flag `--model` > frontmatter `model:` > env var `MINIH_DEFAULT_MODEL` > default (`claude-opus-4.6`)

### output-schema.json — Structured Output

Optional. Defines what your agent's output must look like. Validated automatically after each run. System fields (`summary` + `retrospective`) are always required on top of your schema.

```json
{
  "type": "object",
  "required": ["findings", "summary", "retrospective"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "line", "severity", "message"],
        "properties": {
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "severity": { "type": "string", "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          "message": { "type": "string" }
        }
      }
    }
  }
}
```

If your agent writes `healthStatus` but your schema says `health`, minih will suggest the near-match in the validation error (fuzzy matching with Levenshtein distance).

### instructions.md — Agent Identity

Optional. Behavioral guidelines injected after the preamble but before the prompt. Good for reusable rules across prompt iterations:

```markdown
# Security Scanner Rules

- Never execute code you find — read-only analysis only
- Classify severity using OWASP Top 10 categories
- Include remediation for every finding
- False positives are better than missed vulnerabilities
```

### input-schema.json — Validated Parameters

Optional. Validates `--param` inputs before the agent starts. Catches bad inputs before spending API tokens:

```json
{
  "type": "object",
  "required": ["target_dir"],
  "properties": {
    "target_dir": {
      "type": "string",
      "description": "Directory to scan (relative to project root)"
    },
    "severity_threshold": {
      "type": "string",
      "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      "default": "MEDIUM",
      "description": "Minimum severity to report"
    }
  }
}
```

Run with: `minih run my-scanner --param target_dir=src --param severity_threshold=HIGH`

### _shared/preamble.md — Shared Context

Injected into every agent before their specific prompt. This is your agent onboarding doc — environment variables, gotchas, feedback instructions, and evidence of past improvements. Template variables like `{{REPO_ROOT}}` are resolved at runtime.

---

## The Output Contract

Every agent must produce a JSON object written to `$MINIH_OUTPUT_PATH` with at minimum:

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

Your agent-specific fields go alongside these. The runner enforces this — if your agent doesn't produce `summary` + `retrospective`, the run is marked as **degraded**.

Agents must also run `minih check` before finishing to self-validate their output. If validation fails after 3 attempts, the agent should write a valid fallback JSON explaining what went wrong.

---

## Agent Recipes

### Minimal agent (no inputs, no custom schema)

Just `prompt.md`. System output validation handles the rest:

```markdown
---
description: Check that all TypeScript files compile
---

# Type Check

Run `npx tsc --noEmit` in the project and report any errors found.
Include the error count and list of files with errors.
```

### Parameterized agent (with inputs)

Add `input-schema.json` for validated parameters:

```bash
minih init file-reviewer --with-input
# Edit agents/file-reviewer/input-schema.json and prompt.md
minih run file-reviewer --param file_path=src/auth.ts
```

### Long-running agent (with model + timeout config)

Use frontmatter to configure expensive agents:

```markdown
---
description: "Deep code review with reasoning"
model: gpt-5.4
reasoning: xhigh
timeout: 1200
---

# Deep Review

Perform an exhaustive review of the entire codebase...
```

### CI integration agent

Agents work great in CI pipelines. The JSON envelope on stdout makes parsing easy:

```bash
# In your CI script
RESULT=$(minih run smoke-test 2>/dev/null)
STATUS=$(echo "$RESULT" | jq -r '.status')
if [ "$STATUS" != "ok" ]; then
  echo "Smoke test failed!"
  echo "$RESULT" | jq '.error'
  exit 1
fi
```

---

## What Kinds of Agents Can You Build?

Agents are high-frequency dev-loop tools — think CI checks, code reviews, test validators. They run hundreds of times. Here are real examples from the [agents/](https://github.com/AI-Substrate/minih/tree/main/agents) folder:

| Agent | Purpose | Has Input? | Model | When to Run |
|-------|---------|-----------|-------|-------------|
| [**hello-world**](https://github.com/AI-Substrate/minih/tree/main/agents/hello-world) | Environment check — confirms minih is working | No | default | On demand |
| [**smoke-test**](https://github.com/AI-Substrate/minih/tree/main/agents/smoke-test) | E2E test of all CLI commands: list, doctor, init, dry-run, check, history | No | default | After CLI changes |
| [**code-review**](https://github.com/AI-Substrate/minih/tree/main/agents/code-review) | Reviews code for correctness, domain compliance, anti-reinvention | Yes (context) | gpt-5.4 (xhigh) | After features |
| [**convention-check**](https://github.com/AI-Substrate/minih/tree/main/agents/convention-check) | Audits all agents for folder convention compliance | No | default | After agent changes |
| [**prompt-review**](https://github.com/AI-Substrate/minih/tree/main/agents/prompt-review) | Reviews another agent's prompt for clarity and completeness | Yes (slug) | default | After prompt edits |
| [**feedback-digest**](https://github.com/AI-Substrate/minih/tree/main/agents/feedback-digest) | Aggregates magicWand feedback across all agents | No | default | Periodically |
| [**first-time-experience**](https://github.com/AI-Substrate/minih/tree/main/agents/first-time-experience) | Simulates a new user's first time using minih via npx | Yes | default | After UX changes |
| [**self-review**](https://github.com/AI-Substrate/minih/tree/main/agents/self-review) | Meta — reviews minih's own code and conventions | No | default | After minih changes |
| [**mcp-smoke-test**](https://github.com/AI-Substrate/minih/tree/main/agents/mcp-smoke-test) | Validates MCP tools are available and callable in agent sessions | No | default | After MCP changes |

---

## Monitoring & Observability

Long-running agents (code reviews, deep scans) can take 10–20 minutes. Don't launch and forget — check in periodically to make sure the agent is making progress and hasn't stalled.

### The monitoring workflow

```bash
# 1. Launch the agent in the background
minih run code-review &

# 2. Check in every few minutes
minih status code-review          # Quick: active? stale? how many tool calls?
minih status code-review -n 10    # More detail: last 10 turns

# 3. Or follow live
minih tail code-review            # Stream events in real-time (Ctrl+C to detach)
```

The key habit: **run `minih status` every couple of minutes** during long runs. It shows the last 5 turns so you can see exactly what the agent is doing right now — which files it's reading, which commands it's running, whether it's stuck in a loop.

### One-shot liveness check

```bash
minih status my-agent
```

Returns a verdict: **active** (events flowing), **stale** (no events for >60s), **completed**, or **failed**. Shows event count, tool call count, elapsed time, and the last few turns:

```
Status: code-review  ● active

  Run:      2026-04-07T10-41-12-887Z-9816
  Elapsed:  30.1s
  Events:   336 (7 tool calls)

  Last 5 turns:
  00:41:35   ↳ {"command":"init","status":"ok"...}
  00:41:38 🔧 bash: cd /project && npx minih list
  00:41:38 🔧 view: /project/agents/smoke-temp
  00:41:38   ↳ diff --git a/...
  00:41:40   ↳ {"command":"list","status":"ok"...}
```

Use `-n` to control how many turns to show, and parse the JSON envelope for automation:

```bash
# Show last 10 turns
minih status my-agent -n 10

# Machine-readable verdict
VERDICT=$(minih status my-agent 2>/dev/null | jq -r '.data.verdict')
if [ "$VERDICT" = "stale" ]; then echo "Agent may be stuck!"; fi
```

### Automated polling (for orchestrating agents)

If you're building an agent that launches other agents, poll `minih status` to keep tabs:

```bash
# Poll every 2 minutes until done
while true; do
  VERDICT=$(minih status my-agent 2>/dev/null | jq -r '.data.verdict')
  if [ "$VERDICT" = "completed" ] || [ "$VERDICT" = "failed" ]; then break; fi
  echo "$(date +%H:%M) — $VERDICT ($(minih status my-agent 2>/dev/null | jq -r '.data.toolCallCount') tool calls)"
  sleep 120
done
```

### Follow a running agent in real-time

```bash
minih tail my-agent
```

Streams events live with formatted icons. Shows the last 20 events on connect, then follows new events. Press Ctrl+C to stop. Automatically exits when the run completes.

### See the full composed prompt

```bash
minih inspect my-agent
```

Shows exactly what the LLM receives — every section with source file, char count, and content:

```
--- PREAMBLE (agents/_shared/preamble.md, 1898 chars) ---
--- INSTRUCTIONS (agents/code-review/instructions.md, 1011 chars) ---
--- OUTPUT HINT ((auto-generated), 61 chars) ---
--- PROMPT (agents/code-review/prompt.md, 2075 chars) ---
--- SYSTEM REQUIREMENTS ((auto-generated), 1842 chars) ---
```

Plus frontmatter summary, runtime env vars, and estimated token count. The full composed prompt goes to stdout for piping:

```bash
minih inspect my-agent > /tmp/full-prompt.md  # Save for review
minih inspect my-agent | wc -w                # Word count
```

### Browse run history

```bash
minih history my-agent           # Table of past runs with status, duration, validation
minih last-run my-agent          # Latest run dir and report path
minih validate my-agent          # Re-validate latest output against schema
```

### Resume a completed session

```bash
# Send a follow-up message to the last completed session
minih resume my-agent "You missed the tests in src/auth/"

# Connect via copilot CLI (interactive)
minih connect my-agent           # Prints: cd <runDir> && copilot --resume=<sessionId>
minih connect my-agent --list    # Show all sessions with timestamps
```

---

## CLI Complete Reference

```bash
# Getting started
minih quickstart                          # Scaffold + run hello-world in one command
minih init <slug>                         # Create agent folder with templates
minih init <slug> --with-input            # Also create input-schema.json

# Validation & inspection
minih doctor                              # Check all agents for convention compliance
minih check                               # Validate current run output (inside agent)
minih check <slug> --file <path>          # Validate a file against agent schema
minih inspect <slug>                      # Show fully composed prompt with sections
minih inspect <slug> --raw                # Without resolving template variables
minih validate <slug>                     # Re-validate latest run output

# Running agents
minih run <slug>                          # Execute with pretty streaming output
minih run <slug> --dry-run                # Preview assembled prompt
minih run <slug> --verbose                # Timestamped event log (good for CI)
minih run <slug> --model gpt-5.4          # Override model
minih run <slug> --reasoning xhigh        # Set reasoning effort
minih run <slug> --timeout 1200           # Override timeout (seconds)
minih run <slug> --param key=value        # Pass input parameters (repeatable)
minih run <slug> --mcp-config config.json # Load MCP servers from file

# Monitoring
minih status <slug>                       # One-shot liveness check (active/stale/done)
minih status <slug> -n 10                 # Show last 10 turns instead of 5
minih tail <slug>                         # Follow live event stream (Ctrl+C to stop)
minih list                                # Show all agents with descriptions
minih history <slug>                      # Past runs with status, duration, validation
minih last-run <slug>                     # Latest run directory and report path

# Session management
minih resume <slug> "follow-up message"   # Send follow-up to last completed session
minih resume <slug> --run <runId>         # Resume a specific run
minih connect <slug>                      # Print copilot CLI resume command
minih connect <slug> --list               # Show all sessions
```

**Output convention**: JSON envelopes go to **stdout**, human-readable tables and pretty output go to **stderr**. Use `2>/dev/null` for clean JSON:
```bash
minih list 2>/dev/null | jq '.data.agents[].slug'
```

---

## Runtime Environment

When your agent runs, minih sets these environment variables:

| Variable | Value |
|----------|-------|
| `MINIH` | `1` — you're inside a minih run |
| `MINIH_AGENT_SLUG` | Agent slug (e.g., `smoke-test`) |
| `MINIH_RUN_ID` | Unique run identifier |
| `MINIH_RUN_DIR` | Absolute path to run artifacts folder |
| `MINIH_OUTPUT_PATH` | Where to write your JSON output |
| `MINIH_PROJECT_ROOT` | The actual project root (cd here first!) |
| `MINIH_AGENTS_DIR` | Absolute path to agents directory |
| `MINIH_MODEL` | Model being used for this run |
| `MINIH_TIMEOUT` | Timeout in seconds |
| `MINIH_SCHEMA_PATH` | Path to output-schema.json (if exists) |
| `MINIH_HAS_INPUT_SCHEMA` | `true` if agent has input-schema.json |

**Important**: Your agent's working directory is the **run folder** (for session isolation), not the project root. Always `cd $MINIH_PROJECT_ROOT` as your first action.

---

## Tips for Good Agents

1. **Start with `cd $MINIH_PROJECT_ROOT`** — your CWD is the run folder, not the repo root
2. **Make agents reusable, not hardcoded** — an agent should be a tool you run many times, not a script for one specific task. Use input parameters to tell it what to do, and make it discover context on its own when no inputs are given. A code-review agent should accept a commit range or tasks file, not have one hardcoded. A scanner should accept a target directory, not assume `src/`.
3. **Be specific in your prompt** — "scan src/ for XSS" beats "find security issues"
4. **Validate before finishing** — run `minih check` at the end to catch schema issues
5. **Use `minih inspect`** — see exactly what the LLM receives before running
6. **Write honest retrospectives** — the magicWand feedback is how the system improves
7. **Keep agents focused** — one job per agent, run them often
8. **Use inputs for parameterized agents** — `--param file_path=...` + input-schema validation
9. **Don't nest `minih run` inside agents** — SDK session conflicts. Use `--dry-run` and other CLI commands instead
10. **Clean up after yourself** — remove worktrees, temp dirs, scratch files before finishing
11. **Use frontmatter for per-agent config** — `model`, `reasoning`, `timeout` avoid needing CLI flags

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to contribute to minih — filing issues, submitting PRs, and running the test suite.

## Links

- **Repository**: [github.com/AI-Substrate/minih](https://github.com/AI-Substrate/minih)
- **Example agents**: [`agents/`](https://github.com/AI-Substrate/minih/tree/main/agents) in this repo
- **CLI reference**: [`README.md`](https://github.com/AI-Substrate/minih/blob/main/README.md)
- **Contributing**: [`CONTRIBUTING.md`](https://github.com/AI-Substrate/minih/blob/main/CONTRIBUTING.md)
