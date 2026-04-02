# Workshop: Agent Folder Convention

**Type**: Storage Design
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-02T01:58:00Z
**Status**: Draft

**Related Documents**:
- [Research Dossier](../research-dossier.md) — Agent Definition Convention section
- [001 Magic Wand Feedback Loop](./001-magic-wand-feedback-loop.md) — retrospective in output schema
- [002 CLI Command Design](./002-cli-command-design.md) — commands that interact with folders

---

## Purpose

Define the agent folder convention — the foundational protocol that makes minih work. An agent IS a folder. This workshop specifies the folder structure, file contracts, discovery mechanism, run artifact layout, and how `minih init` scaffolds new agents.

## Key Questions Addressed

- What is the minimum viable agent folder?
- Should runs be co-located inside the agent folder or stored separately?
- How does agent discovery work?
- What does the preamble discovery mechanism look like?
- How are run artifacts structured and what's frozen?

---

## The Folder Protocol

An agent is a folder containing at least `prompt.md`. Everything else is optional. No registration, no config, no boilerplate — if a folder has `prompt.md`, it's an agent.

### Directory Structure

```
<agents-dir>/                           ← Default: ./agents/
├── _shared/                            ← Shared resources (not an agent)
│   └── preamble.md                     ← Global preamble injected into ALL agents
├── smoke-test/                         ← Agent: "smoke-test"
│   ├── prompt.md                       ← REQUIRED — the task definition
│   ├── output-schema.json              ← OPTIONAL — JSON Schema 2020-12 for output
│   ├── input-schema.json               ← OPTIONAL — JSON Schema 2020-12 for --param
│   ├── instructions.md                 ← OPTIONAL — agent identity & behavioral rules
│   └── runs/                           ← AUTO-CREATED — one subfolder per execution
│       ├── 2026-04-02T10-30-00-000Z-a1b2/
│       └── 2026-04-01T14-20-00-000Z-c3d4/
├── code-review/                        ← Agent: "code-review"
│   ├── prompt.md
│   ├── output-schema.json
│   ├── input-schema.json
│   └── instructions.md
└── hello-world/                        ← Agent: "hello-world"
    └── prompt.md                       ← Minimum viable agent
```

### File Contracts

| File | Required | Format | Purpose |
|------|:---:|--------|---------|
| `prompt.md` | ✅ | Markdown with YAML frontmatter | The task definition — what the agent should do |
| `output-schema.json` | ❌ | JSON Schema 2020-12 | Validates agent output; includes retrospective |
| `input-schema.json` | ❌ | JSON Schema 2020-12 | Validates `--param` flags before execution |
| `instructions.md` | ❌ | Markdown | Agent identity, behavioral rules, persona |
| `runs/` | Auto | Directory | Created on first run; contains run artifacts |

### prompt.md Frontmatter (Required)

Every `prompt.md` MUST begin with YAML frontmatter containing at least a `description` field. This is how agents describe themselves for discovery (`minih list`) and for other agents/humans to understand what they do.

```yaml
---
description: "Verify the system is fully operational by running diagnostics, capturing screenshots, and checking for console errors"
tags: [health, ci, smoke]           # optional — for filtering/grouping
---
```

**Required fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `description` | string | One-line summary shown in `minih list`. What does this agent do? |

**Optional fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `tags` | string[] | Categorization for filtering (e.g., `minih list --tag ci`) |
| `author` | string | Who created this agent |
| `version` | string | Agent version (for tracking prompt evolution) |

**Enforcement:** `minih run` and `minih validate` check for frontmatter. Missing frontmatter = warning (not a hard error in V1, but visible). `minih init` always scaffolds valid frontmatter.

### Minimum Viable Agent

```
agents/hello-world/
└── prompt.md
```

```markdown
---
description: "Say hello and report what you observe about your environment"
---

# Hello World

Say hello and report what you observe about your environment.
```

That's it. One file with frontmatter. Run with `minih run hello-world`. No schema, no instructions, no config.

**What you get with just `prompt.md`:**
- Agent discovery works (`minih list` shows it with description)
- Agent execution works (prompt sent to SDK — frontmatter is stripped before prompt assembly)
- Run artifacts created (events.ndjson, completed.json)
- No input validation (no input-schema.json)
- No output validation (no output-schema.json → `validated: null`)
- No instructions/identity (agent gets default SDK behavior)
- No preamble injection (unless `_shared/preamble.md` exists)

### Full Agent

```
agents/code-review/
├── prompt.md               ← frontmatter + "Review the code at the specified path..."
├── output-schema.json      ← Validates findings, verdict, retrospective
├── input-schema.json       ← Requires file_path parameter
└── instructions.md         ← "You are a senior code reviewer..."
```

---

## Agent Discovery

Discovery is filesystem-based: scan the agents directory for folders containing `prompt.md`.

```typescript
function listAgents(agentsDir: string): AgentDefinition[] {
  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  const agents: AgentDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;  // Skip _shared, _templates, etc.
    
    const slugError = validateSlug(entry.name);
    if (slugError) continue;  // Skip invalid folder names
    
    const dir = path.join(agentsDir, entry.name);
    const promptPath = path.join(dir, 'prompt.md');
    if (!fs.existsSync(promptPath)) continue;  // Must have prompt.md
    
    agents.push({
      slug: entry.name,
      dir,
      promptPath,
      schemaPath: existsOrNull(dir, 'output-schema.json'),
      instructionsPath: existsOrNull(dir, 'instructions.md'),
      inputSchemaPath: existsOrNull(dir, 'input-schema.json'),
    });
  }
  
  return agents.sort((a, b) => a.slug.localeCompare(b.slug));
}
```

### Slug Validation

Slugs are folder names. They must be safe for filesystem paths and URL segments:

```
Pattern: /^[a-zA-Z0-9_-]{1,64}$/

Valid:    smoke-test, code_review, my-agent-v2, test123
Invalid:  ../evil, my agent, hello/world, .hidden, (empty), a-very-long-slug-that-exceeds-64-characters-which-is-way-too-much
```

Validation rejects:
- Empty strings
- Path traversal (`..`, `/`, `\`, null bytes)
- Characters outside `[a-zA-Z0-9_-]`
- Length > 64

### Discovery Rules

1. **Only direct children** of agents-dir — no recursive scan
2. **Underscore-prefixed** folders are skipped (`_shared`, `_templates`)
3. **Must have `prompt.md`** — folder without it is not an agent
4. **Invalid slug names** are silently skipped (logged at debug level)
5. **Sorted alphabetically** for consistent output

```
agents/
├── _shared/        ← SKIPPED (underscore prefix)
├── .hidden/        ← SKIPPED (invalid slug)
├── code-review/    ← ✅ DISCOVERED (has prompt.md)
├── drafts/         ← SKIPPED (no prompt.md inside)
├── hello-world/    ← ✅ DISCOVERED (has prompt.md)
└── smoke-test/     ← ✅ DISCOVERED (has prompt.md)

Result: ["code-review", "hello-world", "smoke-test"]
```

---

## AgentDefinition Type

```typescript
interface AgentDefinition {
  /** Agent slug (folder name) */
  slug: string;
  /** One-line description from prompt.md frontmatter */
  description: string;
  /** Tags from prompt.md frontmatter (optional) */
  tags: string[];
  /** Absolute path to the agent folder */
  dir: string;
  /** Absolute path to prompt.md */
  promptPath: string;
  /** Absolute path to output-schema.json, or null */
  schemaPath: string | null;
  /** Absolute path to instructions.md, or null */
  instructionsPath: string | null;
  /** Absolute path to input-schema.json, or null */
  inputSchemaPath: string | null;
}
```

---

## Prompt Assembly

When an agent runs, the full prompt is assembled from multiple parts joined by `\n\n---\n\n`:

```
┌─────────────────────────────────────────────────────────────┐
│  1. PREAMBLE (_shared/preamble.md)          [if exists]     │
│     Global orientation, environment notes, feedback rules   │
│     {{REPO_ROOT}} → replaced with actual cwd                │
├─────────────────────────────────────────────────────────────┤
│  2. INSTRUCTIONS (instructions.md)          [if exists]     │
│     Agent identity, behavioral rules, persona               │
├─────────────────────────────────────────────────────────────┤
│  3. OUTPUT HINT                             [if schema]     │
│     "Write your final JSON report to: <absolute-path>"      │
├─────────────────────────────────────────────────────────────┤
│  4. INPUT PARAMS (from --param flags)       [if params]     │
│     ## Input Parameters                                     │
│     file_path: /src/main.ts                                 │
│     severity: high                                          │
├─────────────────────────────────────────────────────────────┤
│  5. PROMPT (prompt.md)                      [always]        │
│     The actual task definition                              │
└─────────────────────────────────────────────────────────────┘
```

**Assembly code:**

```typescript
const fullPrompt = [preamble, instructions, outputHint, paramsHint, prompt]
  .filter(Boolean)
  .join('\n\n---\n\n');
```

**Key details:**
- Parts are joined with `\n\n---\n\n` (double newline + horizontal rule + double newline)
- `null`/`undefined` parts are filtered out (a minimum agent only has part 5)
- **Frontmatter is stripped** from `prompt.md` before assembly — only the markdown body is sent to the LLM
- The output hint tells the agent WHERE to write — this is critical for the runner to find the output
- Params are formatted as `key: value` lines under an `## Input Parameters` header
- `{{REPO_ROOT}}` in preamble is replaced with `config.cwd` or the working directory

---

## Preamble Discovery

The global preamble (`_shared/preamble.md`) is optional and convention-based:

```
Resolution order:
1. <agents-dir>/_shared/preamble.md    ← Convention location
2. (not found → no preamble injected)
```

**Template variable:**
- `{{REPO_ROOT}}` → replaced with the agent's working directory at runtime

**Minih preamble vs Chainglass preamble:**
- Chainglass preamble is product-specific (Docker, CDP, just commands, port allocation)
- Minih ships a **template** preamble focused on the self-improving feedback loop
- Users create/customize their own `_shared/preamble.md` for their project

### Default preamble created by `minih init` (first time only)

When `minih init` is first run and `_shared/preamble.md` doesn't exist, minih creates a minimal one:

```markdown
# Agent Preamble

Your working directory is: {{REPO_ROOT}}

## Feedback — The Self-Improving Loop

[...feedback section from Magic Wand workshop...]
```

Subsequent `minih init` calls do NOT overwrite an existing preamble.

---

## Run Artifacts

### Run Folder Structure

Each execution creates a timestamped folder under `<agent>/runs/`:

```
agents/smoke-test/runs/2026-04-02T10-30-00-000Z-a1b2/
├── prompt.md               ← Frozen copy of prompt at run time
├── instructions.md         ← Frozen copy (if existed at run time)
├── output-schema.json      ← Frozen copy (if existed at run time)
├── input-schema.json       ← Frozen copy (if existed at run time)
├── events.ndjson           ← Incremental event stream (append-only)
├── stderr.log              ← Error output (if any errors occurred)
├── completed.json          ← Run metadata (written at end)
└── output/
    └── report.json         ← Agent's structured output
```

### Run ID Format

```
YYYY-MM-DDThh-mm-ss-mmmZ-XXXX

Where:
  YYYY-MM-DD   = date
  hh-mm-ss     = time (hyphens not colons — filesystem safe)
  mmm          = milliseconds
  Z            = UTC indicator
  XXXX         = 4 hex chars from crypto.randomBytes(2)

Example: 2026-04-02T10-30-00-000Z-a1b2
```

**Why this format?**
- **Sortable**: Lexicographic sort = chronological sort
- **Filesystem safe**: No colons (Windows compat), no spaces
- **Collision resistant**: Milliseconds + 4 hex chars (65,536 combos per millisecond)
- **Human readable**: You can tell when a run happened by glancing at the folder name

### Frozen Inputs

At run start, the runner copies ALL agent definition files into the run folder:

```typescript
fs.copyFileSync(agentDef.promptPath, path.join(runDir, 'prompt.md'));
if (agentDef.instructionsPath) {
  fs.copyFileSync(agentDef.instructionsPath, path.join(runDir, 'instructions.md'));
}
if (agentDef.schemaPath) {
  fs.copyFileSync(agentDef.schemaPath, path.join(runDir, 'output-schema.json'));
}
if (agentDef.inputSchemaPath) {
  fs.copyFileSync(agentDef.inputSchemaPath, path.join(runDir, 'input-schema.json'));
}
```

**Why freeze?** You can always reconstruct exactly what was sent to the LLM for any historical run, even if the agent definition has since changed. This is critical for debugging why a run produced unexpected output.

### Events (NDJSON)

Events are written incrementally as they arrive from the adapter:

```typescript
fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
```

Each line is a complete JSON object (Newline-Delimited JSON). This enables:
- `minih tail` to follow in real-time (read new bytes, parse new lines)
- Post-mortem analysis with `jq` or streaming parsers
- No memory buildup (append-only, never read back during run)

**Example events.ndjson:**

```jsonl
{"type":"session_start","timestamp":"2026-04-02T10:30:01.000Z","data":{"sessionId":"sess_abc123"}}
{"type":"thinking","timestamp":"2026-04-02T10:30:01.200Z","data":{"content":"I need to check the system status first..."}}
{"type":"tool_call","timestamp":"2026-04-02T10:30:02.000Z","data":{"toolName":"bash","input":{"command":"echo hello"},"toolCallId":"tc_001"}}
{"type":"tool_result","timestamp":"2026-04-02T10:30:02.300Z","data":{"toolCallId":"tc_001","output":"hello","isError":false}}
{"type":"message","timestamp":"2026-04-02T10:30:15.000Z","data":{"content":"I've completed the smoke test..."}}
{"type":"usage","timestamp":"2026-04-02T10:30:15.100Z","data":{"inputTokens":1234,"outputTokens":5678}}
```

### CompletedMetadata

Written atomically at end of run:

```typescript
interface CompletedMetadata {
  slug: string;                    // "smoke-test"
  runId: string;                   // "2026-04-02T10-30-00-000Z-a1b2"
  startedAt: string;               // "2026-04-02T10:30:00.000Z"
  completedAt: string;             // "2026-04-02T10:30:15.200Z"
  durationMs: number;              // 15200
  sessionId: string;               // "sess_abc123"
  result: 'completed' | 'failed' | 'timeout' | 'degraded';
  exitCode: number;                // 0 or 1 or 124 (timeout)
  validated: boolean | null;       // true/false/null (no schema)
  validationErrors: string[];      // [] if valid or no schema
  eventCount: number;              // 47
  toolCallCount: number;           // 12
  artifacts: string[];             // ["prompt.md", "events.ndjson", ...]
}
```

### Output (report.json)

The agent writes structured output to `output/report.json`. Two paths:

1. **Agent writes file directly** (via tool call): Runner detects the file exists and doesn't overwrite
2. **Agent returns output as text**: Runner writes `agentResult.output` to `report.json` as fallback

```typescript
if (agentResult.output && !fs.existsSync(outputPath)) {
  fs.writeFileSync(outputPath, agentResult.output);
}
```

---

## Runs Location Decision

### RESOLVED: Co-located (inside agent folder)

Runs live at `agents/<slug>/runs/` — same as Chainglass.

**Why co-located:**

| Factor | Co-located (`agents/<slug>/runs/`) | Separate (`.minih/runs/<slug>/`) |
|--------|:---:|:---:|
| Everything in one place | ✅ | ❌ |
| `git status` shows agent + runs together | ✅ | ❌ |
| Easy to understand | ✅ | ❌ |
| Clean agent definition folder | ❌ | ✅ |
| Gitignore is simple | ❌ `agents/*/runs/` | ✅ `.minih/` |
| Proven in production | ✅ (Chainglass) | ❌ (untested) |

**Gitignore recommendation:**

```gitignore
# Agent run artifacts (large, generated)
agents/*/runs/
```

Users who want to commit run history (for audit trails) can remove this line.

---

## Schema Validation Detail

### Input Validation (Pre-execution)

When `input-schema.json` exists:

```
minih run code-review --param file_path=/src/main.ts
    │
    ├── Read input-schema.json
    ├── Parse --param flags into Record<string, string>
    ├── Validate params against schema (AJV 2020-12)
    │
    ├── ✅ Valid → continue to prompt assembly
    └── ❌ Invalid → immediate error (no run created)
```

**Example input-schema.json:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Code Review Input",
  "type": "object",
  "required": ["file_path"],
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the file or diff to review."
    }
  }
}
```

**Note**: All param values are strings (from CLI `--param key=value`). The schema should expect `"type": "string"` for all properties. Type coercion may be added in a future version.

### Output Validation (Post-execution)

When `output-schema.json` exists:

```
Agent completes → Runner reads output/report.json
    │
    ├── Pre-validate:
    │   ├── File exists?
    │   ├── File not empty?
    │   └── Valid JSON?
    │
    ├── Schema validate (AJV 2020-12, allErrors: true)
    │
    ├── ✅ Valid → result: "completed"
    └── ❌ Invalid → result: "degraded" (NOT "failed")
```

---

## Three Reference Patterns

From Chainglass source — three agent definitions that demonstrate the convention:

### Pattern 1: No-Input Agent (smoke-test)

```
agents/smoke-test/
├── prompt.md           ← Multi-step diagnostic task
├── output-schema.json  ← health, screenshots, verdict, retrospective
└── instructions.md     ← "You are a smoke test agent..."
```

- No input params needed
- Output schema validates structured diagnostic report
- Retrospective required in schema

### Pattern 2: Input-Accepting Agent (code-review)

```
agents/code-review/
├── prompt.md           ← "Review the code at the specified path"
├── output-schema.json  ← findings[], verdict, domainCompliance, retrospective
├── input-schema.json   ← requires file_path
└── instructions.md     ← "You are a senior code reviewer..."
```

- Takes `--param file_path=/path/to/file`
- Input validated before execution
- Richer output schema with findings, compliance checks

### Pattern 3: Minimal Agent (hello-world)

```
agents/hello-world/
└── prompt.md           ← "Say hello and report your environment"
```

- Just the prompt
- No validation, no instructions
- Still gets full run artifact capture

---

## Open Questions

### Q1: Should agents support additional static files?

**OPEN**: Some agents might want to include reference files (examples, templates, data). Options:
- Option A: Anything in the agent folder is available — agent can read sibling files via tool calls
- Option B: Define a `resources/` subfolder convention for static files
- **Recommendation**: Option A for V1 — the agent has filesystem access and can read its own folder. No special convention needed.

### Q2: Should `minih init` create `_shared/preamble.md`?

**RESOLVED**: Yes, on first `minih init` only. If it already exists, don't overwrite. The template includes the feedback loop section from Workshop 001.

### Q3: Should there be a `minih clean <slug>` command?

**OPEN**: Runs can accumulate unboundedly. Options:
- Option A: No cleanup in V1 — users `rm -rf` old runs
- Option B: `minih clean <slug> --keep 5` keeps N most recent
- **Recommendation**: Option A for V1. Document the gitignore pattern. Clean command is a post-V1 nice-to-have.

---

## Summary

| Aspect | Design |
|--------|--------|
| Minimum agent | Folder with `prompt.md` |
| Discovery | Scan for `prompt.md` in direct children of agents-dir |
| Slug format | `[a-zA-Z0-9_-]{1,64}` |
| Skip convention | Underscore-prefixed folders (`_shared`) |
| Runs location | Co-located: `agents/<slug>/runs/<runId>/` |
| Run ID | `YYYY-MM-DDThh-mm-ss-mmmZ-XXXX` (sortable, collision-resistant) |
| Frozen inputs | prompt.md, instructions.md, schemas copied to run folder |
| Event stream | NDJSON, incremental append, enables tail -f |
| Output | `output/report.json` (agent writes or runner writes) |
| Metadata | `completed.json` (written atomically at end) |
| Prompt assembly | preamble → instructions → output hint → params → prompt |
| Join separator | `\n\n---\n\n` |
| Preamble | `_shared/preamble.md`, optional, `{{REPO_ROOT}}` replaced |
| Input validation | Pre-execution, AJV 2020-12, fail fast |
| Output validation | Post-execution, AJV 2020-12, degraded not failed |
