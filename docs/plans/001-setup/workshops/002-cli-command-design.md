# Workshop: CLI Command Design

**Type**: CLI Flow
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-02T01:58:00Z
**Status**: Draft

**Related Documents**:
- [Research Dossier](../research-dossier.md) — CLI section
- [001 Magic Wand Feedback Loop](./001-magic-wand-feedback-loop.md)
- [003 Agent Folder Convention](./003-agent-folder-convention.md)

---

## Purpose

Design the complete CLI surface for minih: commands, flags, output formats, error codes, and the composition root pattern. This is the primary user interface — getting it right means fast adoption, clear mental model, and scriptable automation.

## Key Questions Addressed

- What are all minih commands and their exact syntax?
- What's the JSON output envelope shape?
- How do commands share agents-dir resolution?
- What does `minih init` scaffold?
- How does the composition root pattern work for dynamic SDK import?
- Who are the three consumer classes and how does each interact with minih?

---

## Overview

Minih's CLI follows a flat command structure (no `minih agent run` nesting — just `minih run`). All commands return JSON to stdout via the output envelope. Human-readable status goes to stderr (when TTY is detected).

### Design Principles

1. **stdout = machine, stderr = human** — JSON envelope on stdout, progress/formatting on stderr
2. **Fast by default** — SDK only loaded for `run` command (dynamic import)
3. **Exit 0 for success + degraded** — only exit 1 for command-level failures
4. **Scriptable** — every command returns parseable JSON; `jq` works out of the box
5. **Convention over config** — agents dir, preamble location discovered automatically

---

## Command Summary

| Command | Purpose | Requires SDK | Requires GH_TOKEN |
|---------|---------|:---:|:---:|
| `minih init <slug>` | Scaffold a new agent folder | ❌ | ❌ |
| `minih run <slug>` | Execute an agent | ✅ | ✅ |
| `minih list` | List available agents | ❌ | ❌ |
| `minih doctor` | Validate all agents and harness structure | ❌ | ❌ |
| `minih history <slug>` | View past runs | ❌ | ❌ |
| `minih validate <slug>` | Re-validate latest output | ❌ | ❌ |
| `minih last-run <slug>` | Get latest run info | ❌ | ❌ |
| `minih tail <slug>` | Follow event stream live | ❌ | ❌ |

---

## Output Envelope

Every command returns this shape to stdout:

```typescript
interface MinihEnvelope {
  command: string;           // e.g., "run", "list", "init"
  status: 'ok' | 'error' | 'degraded';
  timestamp: string;         // ISO-8601
  data?: unknown;            // Command-specific payload
  error?: {
    code: string;            // E-prefixed error code
    message: string;         // Human-readable error
    details?: unknown;       // Additional context
  };
}
```

**Exit codes:**
- `0` — `ok` or `degraded` (command succeeded, possibly with quality issues)
- `1` — `error` (command failed)

**Example success:**

```json
{
  "command": "run",
  "status": "ok",
  "timestamp": "2026-04-02T10:30:00.000Z",
  "data": {
    "slug": "code-review",
    "runId": "2026-04-02T10-30-00-000Z-a1b2",
    "runDir": "/project/agents/code-review/runs/2026-04-02T10-30-00-000Z-a1b2",
    "result": "completed",
    "durationMs": 45200,
    "validated": true,
    "validationErrors": [],
    "eventCount": 47,
    "toolCallCount": 12
  }
}
```

**Example error:**

```json
{
  "command": "run",
  "status": "error",
  "timestamp": "2026-04-02T10:30:00.000Z",
  "error": {
    "code": "E122",
    "message": "GH_TOKEN environment variable is not set. Required for Copilot SDK.",
    "details": { "fix": "export GH_TOKEN=$(gh auth token)" }
  }
}
```

---

## Error Codes

| Code | Name | Trigger |
|------|------|---------|
| `E100` | `UNKNOWN` | Unexpected error |
| `E108` | `INVALID_ARGS` | Bad slug, malformed --param, invalid flag value |
| `E120` | `AGENT_EXECUTION_FAILED` | Agent run failed (adapter error) |
| `E121` | `AGENT_NOT_FOUND` | Slug doesn't match any agent folder |
| `E122` | `AGENT_AUTH_MISSING` | GH_TOKEN not set |
| `E123` | `AGENT_TIMEOUT` | Agent exceeded timeout |
| `E124` | `AGENT_VALIDATION_FAILED` | Schema validation failed (for `validate` command) |
| `E125` | `AGENT_INPUT_INVALID` | Input params failed schema validation |
| `E130` | `INIT_ALREADY_EXISTS` | Agent folder already exists during init |

**Why this subset**: Chainglass has E101-E110 for Docker/container/screenshot errors. Minih drops those entirely — only agent-relevant codes remain.

---

## Command Details

### `minih init <slug>`

Scaffold a new agent folder with template files.

```
$ minih init my-agent

┌─────────────────────────────────────────────────────────────┐
│ SCAFFOLDING                                                 │
│                                                             │
│   Creating agent: my-agent                                  │
│   Directory: agents/my-agent/                               │
│                                                             │
│   ✓ prompt.md              (task template)                  │
│   ✓ output-schema.json     (with retrospective)             │
│   ✓ instructions.md        (agent identity)                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```
$ minih init my-agent --json

{
  "command": "init",
  "status": "ok",
  "timestamp": "2026-04-02T10:30:00.000Z",
  "data": {
    "slug": "my-agent",
    "dir": "agents/my-agent",
    "files": ["prompt.md", "output-schema.json", "instructions.md"]
  }
}
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--with-input` | false | Also create `input-schema.json` |
| `--no-output` | false | Skip `output-schema.json` |
| `--no-instructions` | false | Skip `instructions.md` |
| `--agents-dir <path>` | `agents/` | Override agents directory |

**Scaffolded `prompt.md` template:**

```markdown
# <Slug> Agent

## Objective

Describe what this agent should accomplish.

## Tasks

### 1. [First Task]

Describe the first step the agent should take.

### 2. [Next Task]

Continue with additional steps.

## Output

Write your structured JSON report to the path provided in the output hint
above. The report must conform to the output-schema.json in this agent's folder.

## Retrospective

After completing your tasks, include a `retrospective` in your output with
honest feedback. Your `magicWand` wish is the most valuable thing you produce.
```

**Scaffolded `instructions.md` template:**

```markdown
# <Slug> Agent

You are a [describe role]. Your job is to [describe purpose].

## Rules

1. [Rule 1]
2. [Rule 2]
```

**Error cases:**

```
$ minih init my-agent     # already exists

{
  "command": "init",
  "status": "error",
  "error": {
    "code": "E130",
    "message": "Agent \"my-agent\" already exists at agents/my-agent/"
  }
}
```

---

### `minih run <slug>`

Execute an agent. This is the **composition root** — the only command that imports `@github/copilot-sdk`.

```
$ minih run smoke-test --model gpt-5.4

╭──────────────────────────────────────────────────╮
│  Agent: smoke-test                               │
│  Run:   2026-04-02T10-30-00-000Z-a1b2            │
│  Model: gpt-5.4                                  │
╰──────────────────────────────────────────────────╯

  ✓ GH_TOKEN
  ✓ Agent definition (agents/smoke-test/)

[10:30:01.234] 💭 Planning approach for smoke test...
[10:30:02.567] 🔧 bash echo "hello world"
[10:30:02.890]    ✓ hello world
[10:30:15.123] 📝 (2847 chars)
[10:30:15.456] 📊 tokens: in=1234 out=5678

─── Summary ───
  Status:     completed
  Duration:   15.2s
  Session:    sess_abc123
  Events:     47 (12 tool calls)
  Validation: ✓ passed
  Run dir:    agents/smoke-test/runs/2026-04-02T10-30-00-000Z-a1b2
  Artifacts:  prompt.md, instructions.md, output-schema.json, events.ndjson, completed.json, output/report.json
```

**Flags:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--model <model>` | `-m` | SDK default | Model to use |
| `--reasoning <effort>` | `-r` | none | Reasoning effort: low, medium, high, xhigh |
| `--timeout <seconds>` | `-t` | 300 | Execution timeout |
| `--param <key=value>` | `-p` | none | Input parameter (repeatable) |
| `--dry-run` | | false | Preview assembled prompt, don't execute |
| `--agents-dir <path>` | | `agents/` | Override agents directory |

**Composition Root Flow:**

```
minih run <slug>
    │
    ├── 1. Validate slug (no SDK needed)
    ├── 2. Check GH_TOKEN
    ├── 3. resolveAgent(slug)
    ├── 4. Parse --param flags
    ├── 5. Build AgentRunConfig
    │
    ├── 6. ─── DYNAMIC IMPORT ───────────────────
    │       const { CopilotClient } = await import('@github/copilot-sdk');
    │       const client = new CopilotClient();
    │       const adapter = new SdkCopilotAdapter(client);
    │   ──────────────────────────────────────────
    │
    ├── 7. runAgent(adapter, definition, config, onEvent)
    │       └── (runner handles prompt assembly, events, artifacts)
    │
    ├── 8. Display summary (stderr)
    ├── 9. client.stop()
    └── 10. Emit envelope (stdout)
```

**Why dynamic import?** Steps 1-5 run without loading the SDK (~50ms). If the slug is invalid or GH_TOKEN is missing, the user gets instant feedback. SDK loading adds ~500ms+ and requires auth — only pay that cost when actually running.

**Dry run output:**

```
$ minih run smoke-test --dry-run

─── Assembled Prompt Preview ───

[PREAMBLE] (agents/_shared/preamble.md — 1,247 chars)
You are not just running a task. You are helping build a better system...

---

[INSTRUCTIONS] (agents/smoke-test/instructions.md — 342 chars)
You are a smoke test agent...

---

[OUTPUT HINT]
Write your final JSON report to: agents/smoke-test/runs/DRY-RUN/output/report.json

---

[PROMPT] (agents/smoke-test/prompt.md — 2,105 chars)
## Objective
Verify the system is fully operational...

─── Stats ───
  Total length: 3,694 chars
  Parts: preamble + instructions + output hint + prompt
  Model: (default)
  Timeout: 300s
```

---

### `minih list`

List available agents with descriptions from frontmatter.

```
$ minih list

  Agents (3 found):

  smoke-test          Verify the system is fully operational by running diagnostics
  code-review         Review the code at the specified path and produce findings
  mobile-ux-audit     Assess mobile viewport experience and responsive design quality
```

```
$ minih list --json

{
  "command": "list",
  "status": "ok",
  "timestamp": "2026-04-02T10:30:00.000Z",
  "data": {
    "agents": [
      {
        "slug": "smoke-test",
        "description": "Verify the system is fully operational by running diagnostics",
        "tags": ["health", "ci", "smoke"],
        "hasOutputSchema": true,
        "hasInstructions": true,
        "hasInputSchema": false
      }
    ],
    "count": 3
  }
}
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | auto (non-TTY) | Force JSON output |
| `--tag <tag>` | none | Filter agents by tag (from frontmatter) |
| `--agents-dir <path>` | `agents/` | Override agents directory |

**Input contract discoverability:**

When an agent has `input-schema.json`, `minih list` shows what it needs:

```
$ minih list

  Agents (3 found):

  smoke-test          Verify the system is fully operational by running diagnostics
  code-review         Review the code at the specified path and produce findings
                        requires: file_path (string)
  mobile-ux-audit     Assess mobile viewport experience and responsive design quality
```

JSON output includes input schema details:

```json
{
  "slug": "code-review",
  "description": "Review the code at the specified path and produce findings",
  "tags": ["review", "ci"],
  "hasOutputSchema": true,
  "hasInstructions": true,
  "hasInputSchema": true,
  "requiredParams": ["file_path"],
  "params": {
    "file_path": { "type": "string", "description": "Path to the file or diff to review" }
  }
}
```

This lets all three consumer classes (agents inside, external agents, humans) discover what params to pass without reading raw schema files.

**Input validation flow:**

```
minih run code-review --param file_path=/src/main.ts
    │
    ├── 1. Read input-schema.json
    ├── 2. Parse --param flags → { "file_path": "/src/main.ts" }
    ├── 3. Validate against schema (AJV 2020-12)
    │
    ├── ✅ Valid → continue to prompt assembly
    │     → params injected as:
    │       ## Input Parameters
    │       file_path: /src/main.ts
    │
    └── ❌ Invalid → immediate error (exit 1, no run created)
          {
            "command": "run",
            "status": "error",
            "error": {
              "code": "E125",
              "message": "Input validation failed: /: must have required property 'file_path'"
            }
          }
```

**Missing params give actionable errors:**

```
$ minih run code-review

  ✗ Input validation failed:

    Agent "code-review" requires parameters:
      file_path (string) — Path to the file or diff to review

    Usage: minih run code-review --param file_path=<value>
```

---

### `minih history <slug>`

View past runs for an agent.

```
$ minih history smoke-test

  Run History: smoke-test (3 runs)

  2026-04-02T10-30-00-000Z-a1b2   completed   15.2s   ✓ validated
  2026-04-01T14-20-00-000Z-c3d4   degraded    22.1s   ✗ validated
  2026-03-31T09-00-00-000Z-e5f6   failed       3.4s   — no schema
```

```
$ minih history smoke-test --json

{
  "command": "history",
  "status": "ok",
  "timestamp": "2026-04-02T10:30:00.000Z",
  "data": {
    "runs": [
      {
        "slug": "smoke-test",
        "runId": "2026-04-02T10-30-00-000Z-a1b2",
        "result": "completed",
        "durationMs": 15200,
        "validated": true,
        "validationErrors": [],
        "eventCount": 47,
        "toolCallCount": 12
      }
    ],
    "count": 3
  }
}
```

---

### `minih doctor`

Validate the entire agents directory — structure, frontmatter, schemas, and conventions. Run this to make sure everything is healthy before executing agents.

```
$ minih doctor

  Checking agents directory: agents/

  smoke-test
    ✓ prompt.md exists
    ✓ frontmatter valid (description: "Verify the system is fully operational...")
    ✓ output-schema.json compiles (JSON Schema 2020-12)
    ✓ instructions.md exists
    ✓ retrospective required in output schema

  code-review
    ✓ prompt.md exists
    ✓ frontmatter valid (description: "Review the code at the specified path...")
    ✓ output-schema.json compiles (JSON Schema 2020-12)
    ✓ input-schema.json compiles (JSON Schema 2020-12)
    ✓ instructions.md exists
    ✓ retrospective required in output schema

  hello-world
    ✓ prompt.md exists
    ✗ frontmatter missing — add YAML frontmatter with description field
    — no output-schema.json (optional)
    — no instructions.md (optional)

  _shared/
    ✓ preamble.md exists

  ─── Results ───
  Agents:  3 found
  Healthy: 2
  Warnings: 1 (hello-world: missing frontmatter)
  Errors:  0
```

```
$ minih doctor --json

{
  "command": "doctor",
  "status": "degraded",
  "timestamp": "2026-04-02T10:30:00.000Z",
  "data": {
    "agentsDir": "agents/",
    "agents": [
      {
        "slug": "smoke-test",
        "checks": [
          { "check": "prompt.md", "status": "pass" },
          { "check": "frontmatter", "status": "pass", "description": "Verify the system..." },
          { "check": "output-schema", "status": "pass" },
          { "check": "instructions", "status": "pass" },
          { "check": "retrospective", "status": "pass" }
        ]
      },
      {
        "slug": "hello-world",
        "checks": [
          { "check": "prompt.md", "status": "pass" },
          { "check": "frontmatter", "status": "fail", "message": "Missing YAML frontmatter with description" },
          { "check": "output-schema", "status": "skip", "message": "No output-schema.json" },
          { "check": "instructions", "status": "skip", "message": "No instructions.md" }
        ]
      }
    ],
    "preamble": { "exists": true, "path": "agents/_shared/preamble.md" },
    "summary": { "total": 3, "healthy": 2, "warnings": 1, "errors": 0 }
  }
}
```

**What doctor checks per agent:**

| Check | Severity | What |
|-------|----------|------|
| `prompt.md` exists | Error | Agent won't be discovered without it |
| Frontmatter present | Warning | `minih list` won't show description |
| Frontmatter has `description` | Warning | Required field missing |
| `output-schema.json` compiles | Error | AJV can't parse the schema — will fail at runtime |
| `input-schema.json` compiles | Error | AJV can't parse the schema — will fail at runtime |
| `retrospective` in output schema | Warning | Self-improving feedback not enforced |
| Slug valid | Error | Folder name fails slug validation |

**What doctor checks globally:**

| Check | Severity | What |
|-------|----------|------|
| Agents directory exists | Error | No agents dir found |
| `_shared/preamble.md` exists | Info | Optional but recommended |
| Duplicate slugs | Error | Two folders resolve to same slug |

**Exit codes:**
- `0` — all pass or warnings only (`ok` or `degraded`)
- `1` — errors found (`error`)

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | auto (non-TTY) | Force JSON output |
| `--agents-dir <path>` | `agents/` | Override agents directory |
| `--strict` | false | Treat warnings as errors (useful for CI) |

---

### `minih check <slug>`

Validate a file against an agent's output or input schema. Designed to be called **mid-run by the agent itself** to self-check before finishing, or by humans/scripts to test output files.

```
$ minih check smoke-test --file agents/smoke-test/runs/latest/output/report.json

  Checking: report.json against smoke-test output-schema.json

  ✓ Valid JSON
  ✓ Schema validation passed

  All checks passed.
```

```
$ minih check smoke-test --file bad-output.json

  Checking: bad-output.json against smoke-test output-schema.json

  ✓ Valid JSON
  ✗ Schema validation failed:
    /retrospective: must have required property 'magicWand'
    /verdict: must be equal to one of the allowed values

  2 validation errors found.
```

```
$ minih check code-review --input --file params.json

  Checking: params.json against code-review input-schema.json

  ✓ Valid JSON
  ✗ Schema validation failed:
    /: must have required property 'file_path'

  1 validation error found.
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | required | Path to the file to validate |
| `--input` | false | Validate against input-schema.json instead of output-schema.json |
| `--json` | auto | Force JSON output |

**JSON output:**

```json
{
  "command": "check",
  "status": "ok",
  "data": {
    "slug": "smoke-test",
    "schema": "output-schema.json",
    "file": "report.json",
    "valid": true,
    "errors": []
  }
}
```

**How the agent uses this mid-run:**

The preamble can instruct agents to self-validate:

```markdown
## Output Validation

After writing your report, verify it passes schema validation:

    minih check <your-slug> --file <your-output-path>

If validation fails, fix the issues and write the file again before finishing.
```

This means the agent can:
1. Write `output/report.json`
2. Run `minih check my-agent --file output/report.json`
3. See validation errors
4. Fix and rewrite
5. Finish with a `completed` status instead of `degraded`

---

### `minih validate <slug>`

Re-validate the most recent **completed** run's output against the **current** schema (useful after schema changes).

Note: `validate` checks a completed run retroactively. `check` validates any file on demand (including mid-run). They complement each other.

```
$ minih validate code-review

  Validating: code-review (run 2026-04-02T10-30-00-000Z-a1b2)

  ✓ Output validates against current schema

  Updated completed.json: degraded → completed
```

```
$ minih validate code-review --json

{
  "command": "validate",
  "status": "ok",
  "data": {
    "runId": "2026-04-02T10-30-00-000Z-a1b2",
    "validated": true,
    "errors": [],
    "previousResult": "degraded",
    "updatedResult": "completed"
  }
}
```

**Notable behavior**: If re-validation passes and the run was previously `degraded`, the `completed.json` is updated to `completed`. This is the only command that mutates past run artifacts.

---

### `minih last-run <slug>`

Get info about the most recent run.

```
$ minih last-run smoke-test --json

{
  "command": "last-run",
  "status": "ok",
  "data": {
    "runId": "2026-04-02T10-30-00-000Z-a1b2",
    "runDir": "agents/smoke-test/runs/2026-04-02T10-30-00-000Z-a1b2",
    "reportPath": "agents/smoke-test/runs/2026-04-02T10-30-00-000Z-a1b2/output/report.json",
    "result": "completed"
  }
}
```

---

### `minih tail <slug>`

Follow a running (or completed) agent's event stream in real-time.

```
$ minih tail smoke-test

  Tailing: smoke-test / 2026-04-02T10-30-00-000Z-a1b2
  Events:  agents/smoke-test/runs/2026-04-02T10-30-00-000Z-a1b2/events.ndjson
  Press Ctrl+C to stop

  ... (5 earlier events)

[10:30:12.345] 🔧 bash ls -la /project
[10:30:12.678]    ✓ total 48 drwxr-xr-x  12 user  staff  384 Apr  2 10:30...
[10:30:15.123] 📝 (2847 chars)

─── Run Complete ───
  Result:     completed
  Duration:   15.2s
  Events:     47 (12 tool calls)
  Validated:  ✓
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--run <runId>` | latest | Follow a specific run |

**Behavior:**
- Shows last 20 existing events for context
- Polls every 200ms for new events (tail -f style)
- Auto-exits when `completed.json` appears
- Ctrl+C exits gracefully

---

## Global Flags

These flags work on every command:

| Flag | Default | Description |
|------|---------|-------------|
| `--agents-dir <path>` | `agents/` | Override agents directory |
| `--json` | auto | Force JSON output (auto when stdout is not TTY) |
| `--help` | | Show command help |
| `--version` | | Show minih version |

### Agents Directory Resolution

```
1. --agents-dir flag (explicit)
      │
      ▼
2. MINIH_AGENTS_DIR environment variable
      │
      ▼
3. minih.config agents-dir (if config exists)
      │
      ▼
4. Default: ./agents/ (relative to cwd)
```

---

## Event Display Formatting

Events from `events.ndjson` are formatted for terminal display:

| Event Type | Icon | Display |
|-----------|------|---------|
| `text_delta` | (none) | Dim text content |
| `message` | 📝 | Message length in chars |
| `thinking` | 💭 | First 80 chars of thinking |
| `tool_call` | 🔧 | Tool name + input preview (100 chars) |
| `tool_result` | ✓/✗ | Success/error + output preview (80 chars) |
| `usage` | 📊 | Input/output token counts |
| `session_idle` | ⏸ | "session idle" |
| `session_error` | ❌ | Error message in red |
| `raw` | (skip) | Not displayed |
| `session_start` | (skip) | Not displayed |

---

## Quick Reference

```bash
# Scaffold a new agent
minih init my-agent
minih init my-agent --with-input

# Check everything is healthy
minih doctor
minih doctor --strict            # CI: treat warnings as errors

# Run an agent
minih run my-agent
minih run my-agent -m gpt-5.4 -r high -t 600
minih run my-agent -p file_path=/src/main.ts
minih run my-agent --dry-run

# Validate (before, during, after)
minih doctor                     # before: check all agents are well-formed
minih check my-agent --file out.json   # during: agent self-checks mid-run
minih validate my-agent          # after: re-validate against updated schema

# Observe
minih tail my-agent
minih tail my-agent --run 2026-04-02T10-30-00-000Z-a1b2

# Manage
minih list
minih history my-agent
minih last-run my-agent

# Pipe to jq
minih list --json | jq '.data.agents[].slug'
minih run my-agent | jq '.data.result'
minih history my-agent --json | jq '.data.runs[] | select(.result == "degraded")'
minih doctor --json | jq '.data.agents[] | select(.checks[] | .status == "fail")'
```

---

## Consumer Model: Three Classes of Caller

Minih has three distinct consumer classes. Each interacts differently with the CLI surface.

```
┌───────────────────────────────────────────────────────────────────────┐
│                        minih CLI / API                                │
│                                                                       │
│   ┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐  │
│   │  Consumer 1  │     │   Consumer 2      │     │   Consumer 3    │  │
│   │  THE AGENT   │     │  EXTERNAL AGENTS  │     │  HUMANS / CI    │  │
│   │  INSIDE      │     │  (Copilot CLI,    │     │  (terminal,     │  │
│   │              │     │   Cursor, Aider,  │     │   scripts,      │  │
│   │  Running     │     │   orchestrators)  │     │   pipelines)    │  │
│   │  inside a    │     │                   │     │                 │  │
│   │  minih run   │     │  Invoke minih     │     │  Run minih      │  │
│   │  session     │     │  from outside     │     │  interactively  │  │
│   └──────┬───────┘     └────────┬──────────┘     └────────┬────────┘  │
│          │                      │                         │           │
│    filesystem +            CLI + JSON              CLI + TTY /        │
│    tool calls              envelope                JSON envelope      │
└───────────────────────────────────────────────────────────────────────┘
```

### Consumer 1: The Agent Running Inside Minih

The LLM executing inside `minih run` has full filesystem and tool-call access. It can interact with minih in two ways:

**A. Direct filesystem access (primary path)**

The agent can read its own agent folder, other agents' outputs, and run artifacts directly:

```bash
# The agent running inside minih run code-review can:
cat agents/smoke-test/runs/$(ls -t agents/smoke-test/runs/ | head -1)/output/report.json
#   → Read another agent's latest output

ls agents/
#   → Discover available agents

cat agents/code-review/runs/$(ls -t agents/code-review/runs/ | head -2 | tail -1)/output/report.json
#   → Read its OWN previous run's output (second-most-recent)
```

**B. CLI invocation via tool calls (composable path)**

The agent can also invoke minih commands as tool calls:

```bash
# The agent can call minih from within its own run:
minih list --json
#   → Machine-parseable agent inventory

minih history code-review --json
#   → Its own run history (including current run-in-progress)

minih last-run smoke-test --json | jq '.data.reportPath'
#   → Get path to another agent's output, then read it
```

**What the preamble should teach:**

The preamble (or instructions) should orient the agent about its environment:

```markdown
## Your Environment

You are running inside minih. Your run folder is specified in the output hint.

Available commands (you can invoke these as tool calls):
- `minih list --json` — see what other agents exist
- `minih last-run <slug> --json` — get another agent's latest output path
- `minih history <slug> --json` — see another agent's run history

You can also read files directly — all agent folders are at ./agents/
```

**Design implication:** The JSON envelope and `--json` flag aren't just for external consumers — the agent itself is a first-class JSON consumer. This is why every command returns structured data.

**Cross-agent workflows:**

This enables agent-to-agent information flow within a single minih project:

```
minih run smoke-test              → produces health report
minih run code-review -p file=... → reads smoke-test's latest output for context
minih run planning-agent          → reads ALL agents' magic wand feedback to prioritize fixes
```

The preamble or instructions can make these relationships explicit:

```markdown
## Context from Other Agents

Before starting your review, check if the smoke-test agent has run recently:
- Run `minih last-run smoke-test --json`
- If a recent run exists, read its report for current system health context
```

### Consumer 2: External Agents (Coding Agents, Orchestrators)

External agents (Copilot CLI, Cursor, Aider, custom orchestrators) invoke minih as a subprocess. They need:

**A. Machine-parseable output**

The JSON envelope is already designed for this. Non-TTY stdout produces pure JSON:

```bash
# External agent runs minih as subprocess
output=$(minih run code-review -p file_path=/src/auth.ts 2>/dev/null)
result=$(echo "$output" | jq -r '.data.result')
report_path=$(echo "$output" | jq -r '.data.runDir')/output/report.json
magic_wand=$(cat "$report_path" | jq -r '.retrospective.magicWand')
```

**B. Discovery and introspection**

An external agent needs to know what minih can do before invoking it:

```bash
# "What agents are available?"
minih list --json | jq '.data.agents[].slug'

# "What does this agent need?"
cat agents/code-review/input-schema.json
#   → external agent reads schema to know what --param flags to pass

# "How has this agent performed historically?"
minih history smoke-test --json | jq '.data.runs[] | {runId, result, durationMs}'

# "What feedback has accumulated?"
for run_dir in agents/*/runs/*/output/report.json; do
  jq -r '.retrospective.magicWand // empty' "$run_dir" 2>/dev/null
done
```

**C. Programmatic API (future — not V1 CLI scope)**

For tighter integration, minih exports its core as a library:

```typescript
// Future: external agent imports minih programmatically
import { listAgents, resolveAgent, runAgent } from 'minih';
import { SdkCopilotAdapter } from 'minih/adapter';

const agents = listAgents('./agents');
const def = resolveAgent('code-review', './agents');
const result = await runAgent(adapter, def, { params: { file_path: '/src/auth.ts' } });
console.log(result.metadata.result);  // 'completed'
```

V1 focuses on CLI; the programmatic API is a natural extension because the CLI is already a thin shell over library functions.

**D. MCP tool exposure (future consideration)**

External agents that support MCP could invoke minih as an MCP tool server:

```
# Hypothetical future: minih as MCP server
minih serve --mcp
#   → Exposes run, list, history, validate as MCP tools
#   → External agents discover and call them via MCP protocol
```

This is not V1 scope but the architecture supports it — the CLI commands are already structured as discrete operations with typed inputs and outputs.

### Consumer 3: Humans and CI/CD

**A. Interactive terminal (human at keyboard)**

TTY-detected output: rich formatting to stderr, envelope to stdout.

```bash
# Human runs interactively — sees pretty output
minih run smoke-test
#   stderr: ╭─── Agent: smoke-test ───╮  ...progress...  ─── Summary ───
#   stdout: {"command":"run","status":"ok","data":{...}}

# Human reads the magic wand
cat agents/smoke-test/runs/$(ls -t agents/smoke-test/runs/ | head -1)/output/report.json \
  | jq '.retrospective'
```

**B. CI/CD pipelines**

```yaml
# GitHub Actions example
- name: Run smoke test
  run: |
    result=$(minih run smoke-test --quiet 2>/dev/null)
    status=$(echo "$result" | jq -r '.status')
    if [ "$status" = "error" ]; then
      echo "::error::Smoke test failed"
      echo "$result" | jq '.error'
      exit 1
    fi
    # Degraded is exit 0 but CI might want to warn
    if [ "$status" = "degraded" ]; then
      echo "::warning::Smoke test completed but output validation failed"
    fi
```

**C. Multi-run orchestration scripts**

```bash
#!/bin/bash
# Run all agents and collect magic wand feedback
for slug in $(minih list --json | jq -r '.data.agents[].slug'); do
  echo "Running $slug..."
  minih run "$slug" --quiet 2>/dev/null
done

# Aggregate magic wand wishes
echo "=== Magic Wand Wishes ==="
for report in agents/*/runs/*/output/report.json; do
  slug=$(echo "$report" | cut -d'/' -f2)
  wand=$(jq -r '.retrospective.magicWand // empty' "$report" 2>/dev/null)
  if [ -n "$wand" ]; then
    echo "[$slug] $wand"
  fi
done
```

**D. Feedback-driven improvement workflow (the full loop)**

```bash
# A human or CI script that closes the self-improving loop:

# 1. Run agents
minih run smoke-test
minih run code-review -p file_path=src/main.ts

# 2. Collect feedback
minih history smoke-test --json | jq '[.data.runs[].runId]' > recent_runs.json
for run in $(cat recent_runs.json | jq -r '.[]'); do
  jq '.retrospective' "agents/smoke-test/runs/$run/output/report.json"
done

# 3. Human reads magic wands → creates issues → ships fixes
# 4. Update preamble evidence table:
#    | Agent Said | What Happened |
#    | "Need a --dry-run flag" | Added in v1.2 |

# 5. Next run benefits from the fix, provides new feedback
```

### Consumer Model Summary

| Capability | Consumer 1 (Agent Inside) | Consumer 2 (External Agent) | Consumer 3 (Human/CI) |
|-----------|:---:|:---:|:---:|
| Filesystem read | ✅ direct | ✅ via subprocess | ✅ direct |
| CLI commands | ✅ via tool calls | ✅ via subprocess | ✅ direct |
| JSON envelope | ✅ `--json` | ✅ automatic (non-TTY) | ✅ `--json` or pipe |
| TTY formatting | ❌ not needed | ❌ not needed | ✅ automatic |
| Schema introspection | ✅ read files | ✅ read files | ✅ read files |
| Cross-agent data flow | ✅ read other agents' outputs | ✅ orchestrate runs + read outputs | ✅ scripts |
| Programmatic API | ❌ (uses CLI/files) | 🔮 future import | ❌ (uses CLI) |
| MCP integration | ❌ | 🔮 future MCP server | ❌ |

### Design Implications

1. **Every command must have `--json`**: Not just for piping — the agent inside minih is a JSON consumer too
2. **Exit codes matter for all three**: 0=ok/degraded, 1=error. CI gates and external agents both rely on this
3. **`--quiet` flag needed**: Consumer 2 and 3 (CI) want stdout-only with no stderr noise
4. **Preamble should include minih CLI reference**: Consumer 1 needs to know what commands it can invoke
5. **Input schemas are public contracts**: Consumer 2 reads `input-schema.json` to know what params to pass
6. **Report structure is a public contract**: All three consumers read `output/report.json` — the retrospective shape must be stable
7. **Agent-to-agent flow is filesystem-based**: No special IPC needed — agents read each other's run artifacts via filesystem

---

## Open Questions

### Q1: Should `--json` be the default or should TTY detection control it?

**RESOLVED**: TTY detection controls it. If stdout is a TTY, show human-formatted output to stderr and envelope to stdout. If piped, JSON only. `--json` flag forces JSON regardless. This matches Chainglass behavior.

### Q2: Should there be a `minih config` command?

**OPEN**: The spec mentions `minih config` for setting agents-dir, preamble path, default model. Options:
- Option A: Config file (`minih.config.json` or `.minihrc`) + `minih config` command to manage it
- Option B: Environment variables only (MINIH_AGENTS_DIR, MINIH_PREAMBLE, MINIH_MODEL)
- Option C: Both — config file as default, env vars override, CLI flags override all
- **Recommendation**: Option C, but defer `minih config` command to post-V1. For V1, support config file + env vars + flags.

### Q3: Should `run` support `--quiet` to suppress stderr output?

**OPEN**: Could be useful for CI/scripts that only want the JSON envelope.
- **Recommendation**: Yes, add `--quiet` / `-q` flag to suppress stderr progress. Low effort, high value for automation. All three consumer classes benefit.

### Q4: Should preamble include minih CLI reference for the agent inside?

**RESOLVED**: Yes. The default preamble template should include a "Your Environment" section listing available minih commands the agent can invoke. This enables cross-agent data flow (Consumer 1) without custom instructions per agent.

### Q5: Should `minih serve --mcp` be a V1 or post-V1 concern?

**OPEN**: MCP tool exposure would make minih a first-class tool for any MCP-capable coding agent.
- **Recommendation**: Post-V1. The CLI architecture already supports it (discrete operations with typed I/O), but V1 should ship CLI-only and validate the model before adding another protocol surface.
