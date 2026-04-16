# minih

Standalone declarative agent runner with self-improving feedback.

> **⚠️ WARNING: minih runs agents in YOLO mode.** Agents have unrestricted tool access — they can read, write, and execute anything on your machine. There is no sandbox, no tool allowlist, no confirmation prompt. A plan to support tool restrictions exists but is not yet implemented. **Use at your own risk.** Run in containers or throwaway environments if you're executing untrusted agents.

Define AI agents as folders containing `prompt.md` + optional schemas + instructions, then run them against `@github/copilot-sdk`. Every agent produces structured retrospective feedback — what worked, what was confusing, and a **magic wand** wish for what should change. This feedback loop makes both the agents and the harness better over time.

## Quick Start

### The Fast Way

```bash
export GH_TOKEN=$(gh auth token)
npx github:AI-Substrate/minih quickstart
```

One command — scaffolds a hello-world agent, runs it, shows the results. Zero to success in 60 seconds.

> **Pin a specific version**: `npx github:AI-Substrate/minih#v0.x.y quickstart`

### The Manual Way

#### 1. Install

```bash
# Latest (HEAD)
npm install github:AI-Substrate/minih

# Or pin a release
npm install github:AI-Substrate/minih#v0.x.y

# minih uses @github/copilot-sdk as a peer dependency
npm install @github/copilot-sdk
```

#### 2. Create Your First Agent

```bash
npx minih init my-agent
```

This creates:
```
agents/my-agent/
├── prompt.md             # Your agent's prompt (with YAML frontmatter)
├── output-schema.json    # JSON Schema for structured output
└── instructions.md       # Agent identity and rules
```

### 3. Edit the Prompt

Open `agents/my-agent/prompt.md` and write what your agent should do:

```markdown
---
description: "Analyze code for common security issues"
tags: [security, review]
---

# Security Scan

## Objective
Scan the project for common security issues...
```

### 4. Run It

```bash
export GH_TOKEN=your-github-token
npx minih run my-agent
```

The agent executes, produces JSON output (with a self-improving retrospective), and stores everything in `agents/my-agent/runs/<timestamp>/`.

### 5. Check the Results

```bash
npx minih last-run my-agent    # Show latest run path
npx minih history my-agent     # List all past runs
npx minih validate my-agent    # Re-validate latest output against current schema
```

## Agent Folder Structure

```
agents/
├── _shared/
│   └── preamble.md            # Shared preamble prepended to every agent
├── my-agent/
│   ├── prompt.md              # Required — agent prompt with YAML frontmatter
│   ├── output-schema.json     # Optional — JSON Schema 2020-12 for output
│   ├── input-schema.json      # Optional — JSON Schema for input params
│   ├── instructions.md        # Optional — agent identity and rules
│   └── runs/                  # Auto-created — run artifacts (gitignored)
│       └── 2026-04-05T07-30-00-000Z/
│           ├── events.ndjson
│           ├── completed.json
│           └── output/
│               └── report.json
```

### Frontmatter

Every `prompt.md` must have YAML frontmatter with at least a `description`:

```yaml
---
description: "What this agent does — shown in `minih list`"
tags: [optional, categories]
---
```

## System Output Contract

Every agent must produce JSON output containing `summary` and `retrospective` fields. These are enforced by the runner regardless of whether you define an output schema. Your agent-specific fields go alongside them.

See [`src/schemas/system-output.json`](src/schemas/system-output.json) for the full contract schema.

**Minimal valid output:**

```json
{
  "summary": "Scanned 12 files, found 3 potential issues...",
  "retrospective": {
    "workedWell": "File discovery was fast and the project structure was clear.",
    "confusing": "Wasn't sure if I should scan node_modules or just src/.",
    "magicWand": "A MINIH_SCAN_PATHS env var listing which directories to scan would save me from guessing."
  }
}
```

The `retrospective.magicWand` is the most valuable thing an agent produces — it directly improves the system for every agent that runs after it.

## CLI Reference

### `minih quickstart`

Create and run your first agent in one command. No flags, no editing.

```bash
minih quickstart
```

Scaffolds `agents/hello-world/prompt.md` (if not exists), runs it, and shows next steps. Idempotent — safe to run multiple times.

### `minih run <slug>`

Execute an agent.

```bash
minih run my-agent
minih run my-agent --model claude-sonnet-4 --timeout 600
minih run my-agent --param file_path=src/main.ts --param depth=3
minih run my-agent --dry-run    # Preview prompt without executing
minih run my-agent --verbose    # Old-style timestamped event log
```

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Model to use (default: `claude-opus-4.6`, override: `MINIH_DEFAULT_MODEL`) |
| `-r, --reasoning <effort>` | Reasoning effort: low, medium, high, xhigh |
| `-t, --timeout <seconds>` | Timeout in seconds (default: 300) |
| `-p, --param <key=value>` | Input parameter (repeatable) |
| `--mcp-config <path>` | Load MCP servers from a JSON config file |
| `--dry-run` | Preview assembled prompt without executing |
| `--verbose` | Show all events with timestamps (default: pretty streaming) |

**Display modes**: By default, `minih run` shows clean streaming output — thinking in gray italic, tool calls formatted with names, intent changes highlighted. Use `--verbose` for the timestamped line-per-event log. Non-TTY environments always use verbose mode.

### `minih list`

List available agents with descriptions and required parameters.

```bash
minih list          # JSON envelope on stdout, table on stderr
```

### `minih doctor`

Validate all agents for convention compliance.

```bash
minih doctor           # JSON on stdout, human report on stderr
minih doctor --strict  # Treat warnings as errors
```

### `minih check [slug]`

Validate a file against an agent's output schema.

```bash
minih check my-agent --file output.json     # Validate specific file
minih check                                  # Inside a run — auto-detects via MINIH_* env vars
minih check my-agent --file input.json --input  # Validate against input schema
```

### `minih init <slug>`

Scaffold a new agent folder with templates.

```bash
minih init my-agent                # prompt + output-schema + instructions
minih init my-agent --with-input   # Also create input-schema.json
minih init my-agent --no-output    # Skip output-schema.json
```

### `minih history <slug>`

List past runs for an agent with timestamps and status. Resumed runs show a `↩` indicator.

### `minih resume <slug> <message>`

Send a follow-up message to a completed agent session. The session retains full conversation history — the agent remembers what it did in the original run.

```bash
minih resume smoke-test "You didn't validate the test output — check that too"
minih resume code-review --run 2026-04-06T10-04-29-715Z-e94a "Elaborate on the security concern"
```

| Flag | Description |
|------|-------------|
| `--run <runId>` | Resume a specific run (default: latest) |
| `-t, --timeout <seconds>` | Timeout in seconds (default: 300) |
| `--verbose` | Show all events with timestamps |

System output validation (summary + retrospective) is not enforced on resume — it's a quick follow-up, not a full agent report.

### `minih connect <slug>`

Print a ready-to-paste command to drop into the Copilot CLI with an agent's session history.

```bash
minih connect smoke-test              # Print command for latest run
minih connect smoke-test --run <id>   # Specific run
minih connect smoke-test --list       # Show all runs with session IDs
```

| Flag | Description |
|------|-------------|
| `--run <runId>` | Connect to a specific run (default: latest) |
| `--list` | List all runs with their session IDs |

### `minih validate <slug>`

Re-validate the most recent run's output against the current schema (useful after updating your schema).

### `minih last-run <slug>`

Print the latest run directory and report path.

### `minih tail <slug>`

Follow a running agent's event stream in real-time.

### Global Options

| Flag | Description |
|------|-------------|
| `--agents-dir <path>` | Agents directory (default: `agents`) |
| `-V, --version` | Show version |

## Environment Variables

The runner sets these during agent execution. Use them in scripts or to call `minih check` inside an agent with zero arguments.

| Variable | Description |
|----------|-------------|
| `MINIH` | Always `1` — detect you're inside a minih run |
| `MINIH_AGENT_SLUG` | Current agent slug |
| `MINIH_RUN_ID` | Unique run identifier (timestamp) |
| `MINIH_RUN_DIR` | Absolute path to run artifacts folder |
| `MINIH_OUTPUT_PATH` | Where to write output JSON |
| `MINIH_AGENTS_DIR` | Absolute path to agents directory |
| `MINIH_PROJECT_ROOT` | Absolute path to project root |
| `MINIH_MODEL` | Model being used |
| `MINIH_TIMEOUT` | Timeout in seconds |
| `MINIH_SCHEMA_PATH` | Path to output-schema.json (if exists) |
| `MINIH_INSTRUCTIONS_PATH` | Path to instructions.md (if exists) |
| `MINIH_PREAMBLE_PATH` | Path to preamble.md (if exists) |
| `MINIH_HAS_INPUT_SCHEMA` | `true` if input-schema.json exists, else `false` |
| `MINIH_PARAMS` | JSON-encoded input parameters |

**Default model**: `claude-opus-4.6`. Override with `MINIH_DEFAULT_MODEL` env var or `--model` flag.

## Examples

minih uses agents to test and improve itself. These are the best examples of how to write agents:

| Agent | Complexity | What It Demonstrates |
|-------|-----------|---------------------|
| [`hello-world`](agents/hello-world/) | Minimal | Just a prompt — the simplest possible agent |
| [`convention-check`](agents/convention-check/) | Basic | Output schema, instructions, `$ref` to retrospective, CLI invocation |
| [`prompt-review`](agents/prompt-review/) | Intermediate | Input params (`--param`), cross-agent file reading |
| [`smoke-test`](agents/smoke-test/) | Advanced | Full CLI lifecycle test (init, doctor, check, dry-run) |
| [`feedback-digest`](agents/feedback-digest/) | Advanced | Cross-agent aggregation, feedback loop |
| [`self-review`](agents/self-review/) | Complete | Production-grade code review with complex schema |

Start with `hello-world`, then read through in order. Each agent builds on the concepts introduced by the previous one.

## Why minih? Skills Do Most of This

Both Claude Code and Copilot CLI have skills — markdown files that give an LLM a prompt and get a response. You could build most of what minih does as individual skills. So why does minih exist?

**Skills are inline code. minih is shared infrastructure.**

With skills, each agent is a standalone markdown file that must define its own input handling, output format, validation, instructions, and feedback conventions. With minih, you define those once — schemas, preamble, system output requirements, validation rules — and every agent inherits them. When you improve the runner or add a capability like velocity tracking, every agent gets it for free without touching individual files.

### What minih adds beyond skills

| Capability | Skills | minih |
|---|---|---|
| **Validated output** | Freeform text — no enforcement | JSON Schema (AJV) validates every run |
| **Run independently** | Must run inside a Claude/Copilot session | Standalone CLI — `npx minih run` from any terminal, CI, or cron |
| **Run history** | Gone when session ends | Timestamped run folders with `history` and `last-run` |
| **Event-level observability** | Not available | `events.ndjson` captures every tool call, every message |
| **Session resume** | Not available | `resume` sends follow-ups; `connect` opens interactive sessions |
| **Velocity tracking** | Not available | Per-agent run-over-run timing with trend indicators |
| **Self-improving feedback** | Must be built per-skill | Mandatory `retrospective` with workedWell/confusing/magicWand on every run |
| **Difficulty aggregation** | Not available | `minih difficulties` aggregates friction reports across all agents |
| **Prompt inspection** | Can't see the composed prompt | `minih inspect` shows exactly what the LLM receives |
| **Health checks** | Not available | `minih doctor` validates all agents and harness structure |
| **Update propagation** | Edit every skill file | Change the runner, preamble, or schema once — all agents inherit |
| **Namespace** | Every agent is a `/slash` command in your skills list | Agents live in `agents/` — your skills stay clean for workflow commands |

### Where skills win

Skills have real advantages: **zero setup** (drop a markdown file, it works), **conversation context** (they see your files, git state, current session), **native tools** (the host's grep, edit, bash), and **orchestration** (the LLM can auto-invoke them mid-conversation). minih agents start fresh and need explicit invocation.

### The complement

They're not competitors — they work together:

```
Skills (workflow layer)       →  /plan, /review, /research, /validate
                                       ↓ calls
minih (execution layer)       →  npx minih run smoke-test
                                       ↓ produces
Structured artifacts          →  report.json + events.ndjson + velocity + difficulties
                                       ↓ feeds back into
Skills + preamble + harness   →  self-improving loop
```

Skills are great for interactive workflow orchestration. minih is great for repeatable, observable, self-improving agent execution that persists beyond any single session.

The self-improving feedback loop described in the [Philosophy section](AGENTS_README.md#philosophy-the-harness-is-the-product) — where agents report friction, you fix it, and the next run is faster — is what makes minih more than a runner. Projects using this loop have seen complex multi-hour tasks compress to minutes over successive iterations, because every agent run leaves the system better than it found it. Skills don't have the infrastructure (run history, velocity tracking, difficulty ledger, mandatory retrospectives) to drive that loop automatically.

## Output Format

All commands (except `tail`) output a JSON envelope on stdout:

```json
{
  "command": "run",
  "status": "ok",
  "timestamp": "2026-04-05T07:30:00.000Z",
  "data": { ... }
}
```

Status values: `ok` (success), `degraded` (completed with validation issues), `error` (failure).

Human-readable formatting goes to stderr (when TTY is detected). Pipe stdout for programmatic consumption.

## License

MIT
