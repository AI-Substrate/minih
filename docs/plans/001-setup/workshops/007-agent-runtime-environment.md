# Workshop: Agent Runtime Environment

**Type**: Integration Pattern
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-05T02:24:00Z
**Status**: Draft

**Related Documents**:
- [006 System Output Contract](./006-system-output-contract.md) — what agents must output
- [005 Session Isolation](./005-session-isolation-cwd-strategy.md) — CWD strategy
- [002 CLI Command Design](./002-cli-command-design.md) — consumer model

---

## Purpose

Design how the runner passes context to the agent via environment variables so the agent (and any minih CLI calls the agent makes) can self-orient without hardcoded paths or slug parsing. The agent runs `minih check` and it just works — no arguments needed — because the environment tells the CLI everything.

---

## The Problem

Currently, when the system output instructions tell the agent to self-validate:

```markdown
After writing your output, verify it:
  minih check smoke-test --file /full/path/to/runs/2026-04-05T.../output/report.json
```

The agent needs to:
1. Know its own slug
2. Know the full path to its output file
3. Know where the agents directory is
4. Construct the right CLI command

That's a lot of cognitive load for the agent. It has to parse paths from the output hint, remember its slug, and assemble the command correctly. Error-prone.

## The Solution: Runtime Environment Variables

The runner sets environment variables before executing the agent. The CLI detects them and fills in defaults automatically.

```
┌───────────────────────────────────────────────────────────────┐
│  Runner (before adapter.run())                                │
│                                                               │
│  Sets env vars:                                               │
│    MINIH_AGENT_SLUG    = "smoke-test"                         │
│    MINIH_RUN_DIR       = "/project/agents/smoke-test/runs/..."│
│    MINIH_OUTPUT_PATH   = "/project/agents/.../output/report.json" │
│    MINIH_AGENTS_DIR    = "/project/agents"                    │
│    MINIH_PROJECT_ROOT  = "/project"                           │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  Agent (inside the run)                                       │
│                                                               │
│  Can call:                                                    │
│    minih check              ← slug + file from env, just works│
│    minih list               ← agents-dir from env             │
│    minih last-run smoke-test ← or use $MINIH_AGENT_SLUG       │
│                                                               │
│  Can read:                                                    │
│    echo $MINIH_PROJECT_ROOT ← knows where the real project is │
│    echo $MINIH_OUTPUT_PATH  ← knows where to write output     │
│    echo $MINIH_RUN_DIR      ← knows its own run folder        │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  CLI (when called by agent)                                   │
│                                                               │
│  Detects env vars:                                            │
│    minih check (no args)                                      │
│      → slug = $MINIH_AGENT_SLUG                               │
│      → file = $MINIH_OUTPUT_PATH                              │
│      → agents-dir = $MINIH_AGENTS_DIR                         │
│                                                               │
│    minih list (no --agents-dir)                                │
│      → agents-dir = $MINIH_AGENTS_DIR                         │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## The Environment Variables

| Variable | Set By | Value | Used By |
|----------|--------|-------|---------|
| `MINIH` | runner | `1` | **Detection flag** — any script/tool checks `if [ -n "$MINIH" ]` to know it's inside a minih run |
| `MINIH_AGENT_SLUG` | runner | Agent slug (e.g., `smoke-test`) | CLI: default slug for `check`, `validate`. Agent: self-reference. |
| `MINIH_RUN_ID` | runner | Run ID (e.g., `2026-04-05T12-06-35-430Z-e152`) | Agent: reference in reports/logs |
| `MINIH_RUN_DIR` | runner | Absolute path to current run folder | Agent: knows its workspace. CLI: context. |
| `MINIH_OUTPUT_PATH` | runner | Absolute path to `output/report.json` | CLI: default `--file` for `check`. Agent: where to write. |
| `MINIH_AGENTS_DIR` | runner | Absolute path to agents directory | CLI: default `--agents-dir`. Agent: discovery. |
| `MINIH_PROJECT_ROOT` | runner | Absolute path to project root | Agent: `cd` target. Replaces `{{REPO_ROOT}}`. |
| `MINIH_MODEL` | runner | Model being used (e.g., `gpt-5.4`) or empty | Agent: can adjust behavior based on model capabilities |
| `MINIH_TIMEOUT` | runner | Timeout in seconds (e.g., `300`) | Agent: knows its time budget, can prioritize tasks |
| `MINIH_SCHEMA_PATH` | runner | Absolute path to output-schema.json, or empty | Agent: can read its own schema to understand expected output |
| `MINIH_INSTRUCTIONS_PATH` | runner | Absolute path to instructions.md, or empty | Agent: can re-read its own identity/rules mid-run |
| `MINIH_PREAMBLE_PATH` | runner | Absolute path to _shared/preamble.md, or empty | Agent: can inspect what preamble was injected |
| `MINIH_HAS_INPUT_SCHEMA` | runner | `true` or `false` | Agent: quick check without filesystem scan |
| `MINIH_PARAMS` | runner | JSON string of input params (e.g., `{"file_path":"/src/main.ts","count":3,"enabled":true}`) or `{}`. Values are typed per the agent's `input-schema.json` — may be strings, numbers, booleans, objects, or arrays. The CLI's `-p key=value` flag auto-coerces JSON values; an agent reading `MINIH_PARAMS` should not assume string values (Plan 019 FX001). | Agent: can re-read its own params programmatically |

---

## How It Changes the Agent Experience

### Before (manual paths)

```markdown
## Required Output Format

Write your JSON report to: /project/agents/smoke-test/runs/2026-04-05T12-06-35-430Z-e152/output/report.json

After writing, validate with:
  minih check smoke-test --file /project/agents/smoke-test/runs/2026-04-05T12-06-35-430Z-e152/output/report.json --agents-dir /project/agents
```

### After (env vars, zero-arg)

```markdown
## Required Output Format

Write your JSON report to: $MINIH_OUTPUT_PATH
(Environment variable is set — just use it directly.)

After writing, validate with:
  minih check
```

That's it. `minih check` with no arguments. The CLI reads `MINIH_AGENT_SLUG`, `MINIH_OUTPUT_PATH`, and `MINIH_AGENTS_DIR` from the environment.

---

## CLI Argument Resolution Order

When a CLI command needs a value, it resolves in this order:

```
1. Explicit CLI flag      (--agents-dir /path, --file report.json)
      │
      ▼
2. Environment variable   (MINIH_AGENTS_DIR, MINIH_OUTPUT_PATH)
      │
      ▼
3. Default                 (agents/, etc.)
```

Explicit flags always win. Env vars fill in gaps. Defaults are last resort.

### `minih check` resolution:

```typescript
// slug: explicit arg > MINIH_AGENT_SLUG > error
const slug = args.slug ?? process.env.MINIH_AGENT_SLUG;
if (!slug) exitWithError('Provide a slug or run inside a minih agent');

// file: --file flag > MINIH_OUTPUT_PATH > error  
const file = opts.file ?? process.env.MINIH_OUTPUT_PATH;
if (!file) exitWithError('Provide --file or run inside a minih agent');

// agents-dir: --agents-dir flag > MINIH_AGENTS_DIR > 'agents'
const agentsDir = program.opts().agentsDir 
  ?? process.env.MINIH_AGENTS_DIR 
  ?? 'agents';
```

### `minih list` resolution:

```typescript
// agents-dir: --agents-dir flag > MINIH_AGENTS_DIR > 'agents'
const agentsDir = program.opts().agentsDir 
  ?? process.env.MINIH_AGENTS_DIR 
  ?? 'agents';
```

---

## Runner Implementation

In `runner.ts`, before calling `adapter.run()`:

```typescript
// Set runtime environment for the agent
process.env.MINIH = '1';
process.env.MINIH_AGENT_SLUG = definition.slug;
process.env.MINIH_RUN_ID = runId;
process.env.MINIH_RUN_DIR = runDir;
process.env.MINIH_OUTPUT_PATH = outputPath;
process.env.MINIH_AGENTS_DIR = path.resolve(agentsDir);
process.env.MINIH_PROJECT_ROOT = config.cwd ?? process.cwd();
process.env.MINIH_MODEL = config.model ?? '';
process.env.MINIH_TIMEOUT = String(config.timeout ?? 300);
process.env.MINIH_SCHEMA_PATH = definition.schemaPath ?? '';
process.env.MINIH_INSTRUCTIONS_PATH = definition.instructionsPath ?? '';
process.env.MINIH_PREAMBLE_PATH = preamblePath ?? '';
process.env.MINIH_HAS_INPUT_SCHEMA = definition.inputSchemaPath ? 'true' : 'false';
process.env.MINIH_PARAMS = JSON.stringify(config.params ?? {});
```

And clean up after:

```typescript
// Clean up runtime environment
for (const key of [
  'MINIH', 'MINIH_AGENT_SLUG', 'MINIH_RUN_ID', 'MINIH_RUN_DIR',
  'MINIH_OUTPUT_PATH', 'MINIH_AGENTS_DIR', 'MINIH_PROJECT_ROOT',
  'MINIH_MODEL', 'MINIH_TIMEOUT', 'MINIH_SCHEMA_PATH',
  'MINIH_INSTRUCTIONS_PATH', 'MINIH_PREAMBLE_PATH',
  'MINIH_HAS_INPUT_SCHEMA', 'MINIH_PARAMS',
]) {
  delete process.env[key];
}
```

---

## What the System Output Instructions Become

With env vars, the system output instruction text simplifies dramatically:

```markdown
## Required Output Format

Your output MUST be a valid JSON object. Write it to the path in $MINIH_OUTPUT_PATH.

At minimum, your JSON must include:

{
  "summary": "A single paragraph describing what you did and what you found.",
  "retrospective": {
    "workedWell": "What was smooth? Be specific.",
    "confusing": "What was unclear or required trial-and-error?",
    "magicWand": "ONE thing you'd change to make your job easier. Be concrete."
  }
}

Your agent-specific output fields go alongside these in the same JSON object.

After writing your output, validate it:
  minih check

That's it — no arguments needed. The environment knows your slug and output path.
```

Clean. The agent doesn't need to parse paths or remember its slug.

---

## Preamble Orientation Simplification

The preamble can also use env vars:

```markdown
## Orientation

Your environment:
  Project root:  $MINIH_PROJECT_ROOT
  Run folder:    $MINIH_RUN_DIR  
  Output path:   $MINIH_OUTPUT_PATH
  Your slug:     $MINIH_AGENT_SLUG

Run `cd $MINIH_PROJECT_ROOT` before executing commands against the project.
```

Or use `{{REPO_ROOT}}` replacement as before — both work. The env var approach means the agent can reference these in tool calls without the preamble having to spell them out.

---

## Security Considerations

These env vars are set in the same process that runs the SDK. The agent executes tool calls (bash, file ops) in the SDK's subprocess, which inherits the parent's environment. So the env vars are available to the agent's tool calls.

This is by design — agents are yolo with full access. The env vars don't grant any additional capability the agent didn't already have.

---

## Open Questions

### Q1: Should env vars be set on process.env or passed to the adapter?

**RESOLVED**: Set on `process.env`. The SDK spawns subprocesses that inherit the environment. Passing through the adapter would require SDK support for custom env vars, which may not exist.

### Q2: Should env vars be cleaned up after the run?

**RESOLVED**: Yes — delete them in the runner's finally block. This prevents env var leakage if someone runs multiple agents in the same process (programmatic API use case).

### Q3: Should `MINIH_PROJECT_ROOT` replace `{{REPO_ROOT}}`?

**OPEN**: They serve the same purpose. Options:
- Option A: Keep both — `{{REPO_ROOT}}` in preamble template, env var for agent tool calls
- Option B: Drop `{{REPO_ROOT}}` — preamble uses `$MINIH_PROJECT_ROOT` directly
- **Recommendation**: Option A for now — `{{REPO_ROOT}}` is already implemented and works. The env var is additive. Can consolidate later.

---

## Summary

| Aspect | Design |
|--------|--------|
| Mechanism | `process.env` vars set by runner before `adapter.run()` |
| Variables | MINIH_AGENT_SLUG, MINIH_RUN_DIR, MINIH_OUTPUT_PATH, MINIH_AGENTS_DIR, MINIH_PROJECT_ROOT |
| CLI resolution | Explicit flag > env var > default |
| Agent experience | `minih check` with zero arguments — just works |
| Cleanup | Delete env vars in runner's finally block |
| Security | No additional capability granted — agents are already yolo |
| System output instructions | Simplified to reference `$MINIH_OUTPUT_PATH` and `minih check` (no args) |
