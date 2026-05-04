# Building Agents with minih

> **What is minih?** A standalone agent runner that executes declarative AI agents against `@github/copilot-sdk`. Every agent produces structured feedback about its own experience — what worked, what was confusing, and a **magic wand** wish for what should change. This feedback loop makes both the agents and the harness better over time.

---

## Philosophy: The Harness Is the Product

> *The harness isn't a testing tool. It's a product improvement engine that happens to test things along the way. Every agent that runs is a user of your developer tools. Every retrospective is a usability study. Every magicWand is a feature request from someone who actually used the thing.*

Most teams treat their developer tooling as a cost center — something you build once, maintain grudgingly, and replace when it rots. minih inverts this. **Your developer tools are your most important product**, because every other product you build passes through them. A bad harness makes everything slower. A good harness makes everything faster. A self-improving harness makes everything *accelerate*.

### The Core Principle

> **Every task must send a gift to its future self.**

If you hit a problem, don't just solve it — encode the solution. The agent that runs tomorrow should never hit the same problem you hit today. This is the core mechanism behind the velocity curve — 16 hours → 15 minutes across 5 iterations on the same codebase.

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

We call this progression **The Maturity Curve** — a named concept you can use to assess where your harness is. If you're still getting "I can't do X" wands after many runs, the basics are missing. If you're getting edge case wands, you're mature. If you're getting strategic wands, you've arrived.

### Encode, Don't Document

The harness doesn't *tell you* how to test things. It *tests things*. There's a difference.

A wiki page that says "to validate audit provenance, create an invoice and check the database" is documentation. It rots. A command that creates an invoice, checks the database, and reports pass/fail is *encoded knowledge*. It runs forever.

When your agents discover how something works — encode it. Make it a command, a recipe, a pre-flight check. Make it so the next agent (or human) never has to rediscover it.

### The Difficulty Ledger

Friction compounds — in the wrong direction. Every unresolved difficulty costs the next agent hours. The difficulty ledger is a project-level artifact that tracks what's hard and what's been fixed.

**Who maintains it**: The calling agent or human — not minih itself. minih agents are reporters; the harness owner maintains the ledger. The ledger should capture friction from ALL sources — minih agent runs AND the calling agent's own experience.

**The pipeline:**
1. **minih agents report**: difficulties in `retrospective.difficulties` (self-numbered MH-001, MH-002 per run)
2. **You (or your calling agent) review**: `minih difficulties` shows all reported friction across agent runs
3. **You maintain the ledger**: combine agent reports with your own friction, track mitigations, curate the preamble's Known Difficulties table

Future agents read the preamble, see what's known, and confirm mitigations work. The categories are suggested, not enforced — agents use `build`, `config`, `data`, `test`, `debug`, `knowledge`, or whatever fits.

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

### Install curated agents with `minih agent install`

Once `minih` is on `$PATH`, you can install agents from the bundled registry without hand-copying anything:

```bash
minih agent install code-review-companion        # bundled registry slug
minih agent list --available                     # what else is installable
minih agent install github:owner/repo#main:agents/x --yes  # any public repo
```

Each install copies the manifest-listed files into `agents/<slug>/` and writes a provenance sidecar (`.minih-source.json`) so re-running `install` upgrades idempotently. Full surface — manifest format, security model, error reference — in [`docs/how/agent-pack.md`](./docs/how/agent-pack.md).

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

Write your JSON report to the literal output path shown by minih. `$MINIH_OUTPUT_PATH` usually points at the same file; if your shell cannot see it, use the literal path from the prompt.
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
│   ├── outside.md               # Outside peer contract for coordinated agents (optional)
│   ├── inside-state.schema.json # Per-agent inside state enum/schema (optional)
│   ├── outside-state.schema.json # Per-agent outside state enum/schema (optional)
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

## Permissions

> Plan 018 — fine-grained permission policies replace the legacy `approveAll` posture.

Add a `permissions:` field to your agent's `prompt.md` frontmatter:

```yaml
---
description: My agent
permissions: read-only
---
```

Six built-in presets:

| Preset      | shell | write | read | mcp | url | custom-tool | memory | hook |
|-------------|-------|-------|------|-----|-----|-------------|--------|------|
| `yolo`      | ✅    | ✅    | ✅   | ✅  | ✅  | ✅          | ✅     | ✅   |
| `trusted`   | ✅    | ✅    | ✅   | ✅  | ✅  | ❌          | ❌     | ❌   |
| `restricted`| ❌    | ❌    | ✅   | ✅  | ❌  | ❌          | ❌     | ❌   |
| `read-only` | ❌    | ❌    | ✅   | ✅  | ❌  | ❌          | ❌     | ❌   |
| `network`   | ❌    | ❌    | ✅   | ✅  | ✅  | ❌          | ❌     | ❌   |
| `build-only`| ✅    | ✅    | ✅   | ❌  | ❌  | ❌          | ❌     | ❌   |

Object form supports `overrides` and `allowedRoots`:

```yaml
permissions:
  preset: read-only
  overrides:
    network: allow         # `network` is alias for `url`
    shell: allow
  allowedRoots:
    mode: extend
    roots: ["./repo", "./tmp"]
```

**On denial**: the agent terminates with exit code `126`, `terminalReason: 'permission-denied'` in `run.json`, and (for coordinated agents) a `permission-error` typed message on the outside inbox. Idempotent on `requestId`.

**Resolution chain**: frontmatter → `.minih-source.json` sidecar `lockedDefault` → `MINIH_PERMISSIONS_DEFAULT` env var → release default (`restricted` since R6).

**Inside MCP tool**: coordinated agents can call `permission_status` to self-introspect their resolved policy without firing a permission request.

**Full reference**: [`docs/how/permissions.md`](docs/how/permissions.md).

---

## Coordination-aware agents

Coordinated agents have a two-sided workflow:

- The **outside peer** is a human, CI job, host agent, or sibling process driving work from the project shell.
- The **inside agent** is the minih run. It receives peer context in its prompt and can use inside MCP inbox/state tools while it works.

Use coordination when the outside peer needs durable progress signals, review handoffs, or run-scoped inbox/state lanes for a long-running run. It is still one minih agent run, not a server-side rule engine.

### Scaffold a coordinated agent

```bash
minih init coordination-smoke-test --coordinated
```

This creates:

```text
agents/coordination-smoke-test/
├── prompt.md                  # includes coordination: enabled
├── outside.md                 # outside peer contract
├── inside-state.schema.json   # inside state enum/schema
├── outside-state.schema.json  # outside state enum/schema
├── instructions.md
└── output-schema.json
```

The required switch is frontmatter on `prompt.md`:

```yaml
---
description: "Dogfood the outside/inside coordination loop"
coordination: enabled
---
```

With coordination enabled, fresh runs get extra prompt sections for identity, available inside MCP tools, the peer contract from `outside.md`, and a pre-completion checklist. Non-coordinated agents keep the legacy prompt shape.

### outside.md behavior

`outside.md` is plain markdown for the outside peer. It is optional, but minih distinguishes three slug-specific states:

| State | What it means | Inside prompt behavior |
|-------|---------------|------------------------|
| `absent` | No `outside.md` file exists | No peer-contract section is injected |
| `empty` | The file exists but has no non-whitespace body | A present but empty peer-contract section is injected |
| `present` | The file has content | The markdown is quoted under `## Peer's Contract (from outside.md)` |

Run:

```bash
minih outside context coordination-smoke-test
```

With no slug, `minih outside-context` returns system-only coordination guidance. With a slug, the JSON envelope includes `contractStatus` and `hasOutsideContract`.

`minih doctor` checks coordinated `outside.md` files when present: it warns when the contract is older than `prompt.md`, warns above 4KB, fails above 8KB, and rejects symlink escapes through runner path guards. It leaves non-coordinated and absent outside contracts alone.

### Driving the outside side

The outside peer uses CLI commands from the project shell:

```bash
minih run coordination-smoke-test          # Start in another terminal/background shell
RUN_ID=$(minih status coordination-smoke-test 2>/dev/null | jq -r '.data.runId')

minih outside inbox send coordination-smoke-test \
  --run "$RUN_ID" \
  --subject "Smoke test request" \
  --body "Please acknowledge this, publish state, and report back."

minih state set coordination-smoke-test \
  --run "$RUN_ID" \
  --side outside \
  --status in-progress \
  --data-json '{"driver":"outside smoke test"}'
minih inside inbox list coordination-smoke-test --run "$RUN_ID"
minih state get coordination-smoke-test --run "$RUN_ID"
minih retros --agent coordination-smoke-test --run "$RUN_ID"
```

The inside agent can use six MCP tools during the run: `inbox_list`, `inbox_send`, `inbox_ack`, `state_get`, `state_set`, and `state_transition`. Outside CLI commands do not call those tools directly; they read and write runner-managed inbox/state files under the selected run folder. Pass `--run <runId>` when multiple runs exist; minih only defaults when the target run is unambiguous.

### Minimal vs rich coordination examples

Use [`agents/coordination-smoke-test/`](./agents/coordination-smoke-test/) for the minimal primitive check: one coordinated run that exercises the inbox, state, and retrospective tools.

Use [`agents/coordination-loop-validator/`](./agents/coordination-loop-validator/) for the richer canonical worked example: the outside side starts or attaches to an inside validator, watches with `minih status` and `minih tail`, sends exactly three manual milestone events, reads feedback, and validates final evidence. The full runbook lives in [`docs/how/coordination-loop-validator.md`](./docs/how/coordination-loop-validator.md).

### State schemas and retrospectives

Per-agent state schemas let you constrain status values for each side. The default coordinated scaffold uses simple inside statuses (`idle`, `working`, `reviewing`, `complete`, `blocked`) and outside statuses (`idle`, `in-progress`, `review-requested`, `done`, `blocked`); edit the schemas to match your workflow.

Agent reports may include `retrospective.coordination` for unresolved peer requests, state publication notes, and coordination-specific blockers. Set `retrospective.magicWandTarget` to `"coordination"` when the feedback is about the outside/inside loop.

See [`agents/coordination-smoke-test/`](./agents/coordination-smoke-test/) for the minimal dogfood example, including [`outside.md`](./agents/coordination-smoke-test/outside.md). See [`agents/coordination-loop-validator/`](./agents/coordination-loop-validator/) plus [`docs/how/coordination-loop-validator.md`](./docs/how/coordination-loop-validator.md) for the richer canonical loop worked example.

### Reply chains

Any inbox message can carry an optional `ackOf` field pointing at a prior message id. This makes the new message a **reply** to that one. Replies can themselves be replied to — chains form naturally because each reply's id is itself a valid `ackOf` target for the next reply.

- Inside agents pass `ackOf` to `inbox_send` for any `type` (not just `ack`). Use `inbox_ack` when you specifically want to acknowledge a peer message — that's its own dedicated tool.
- Outside operators pass `--ack-of <id>` to `outside inbox send` for any `--type`. (`--type ack` still requires `--ack-of`.)
- The next agent sees `In reply to: <id>` for non-ack replies in its prompt, or `Acknowledges: <id>` for `--type ack` (preserves today's ack semantics).

Worked example — three messages, two chain links:

```bash
# Outside asks a question
$ minih outside inbox send my-agent --type question \
    --subject "Status?" --body "where are we?"
# returns messageId: 01HAAA...

# Inside replies via inbox_send (not inbox_ack — this is a content reply)
# inbox_send({ type: 'note', subject: 'progress', body: '...', ackOf: '01HAAA...' })
# returns messageId: 01HBBB...

# Outside replies to the reply, forming a chain
$ minih outside inbox send my-agent --type note \
    --subject "ok keep going" --body "thanks" --ack-of 01HBBB...
# returns messageId: 01HCCC...  (ackOf: 01HBBB...)
```

No threads, no thread state, no enforcement — minih is the messenger, not the police. Stale `ackOf` ids are not validated; if you cite a non-existent message, the receiving agent will see it and surface that themselves.

### Wait for any (plan 014)

Coordinated agents have a long-poll MCP tool `wait_for_any` that wakes on any combination of inbox messages and state changes in a single call — replacing the "spin-loop on `state_get`" pattern when an agent is waiting for the outside operator to publish parameters or flip a status.

```js
wait_for_any({
  events: [
    { kind: 'inbox.message', filter: { types: ['task', 'question'] } },
    { kind: 'state.peer.changed' },
  ],
  waitMs: 30000
})
// → { events: [{ kind, ts, data }, ...], wait: { requestedMs, elapsedMs, timedOut, matched } }
```

Each returned event is a discriminated-union envelope `{ kind, ts, data }` so callers can dispatch on `kind` for type-narrowed access to `data`. A clean timeout returns `events: []` + `wait.timedOut: true` (no error thrown).

Supported event kinds in v1:

| Kind | Wakes when | Notes |
|---|---|---|
| `inbox.message` | A new message lands in the **peer** inbox lane | Optional `filter.types[]` to scope to specific message types. The agent's own `inbox_send` writes do not wake this watch (structurally — only the peer lane is watched). |
| `state.peer.changed` | The peer state file changes (mtime + JSON-diff dedup) | The full new state is delivered as `data.newState`. |
| `state.self.changed` | Another inside-side actor writes the agent's own state file | The agent's own `state_set` / `state_transition` calls are suppressed via `updatedBy` self-write filter. |

Limits: up to 8 watch entries per call, `waitMs` capped at 30 000 ms (same cap as `inbox_list`).

Forward compatibility: future event kinds (`fs.changed`, `tool.completed`, …) will plug into the same `{ kind, ts, data }` envelope without breaking v1 callers. v1 servers reject unknown kinds with `MCP_INVALID_ARGUMENT` — agents are responsible for capability detection.

---

## Companion mode

A **companion** is a coordinated minih agent that boots once, follows you through a long work session, reviews or watches each unit of work as you ship it, and writes a final **farewell envelope** when you tell it the session is over. It is the long-lived counterpart to a one-shot agent.

The canonical implementation lives at [`agents/code-review-companion/`](./agents/code-review-companion/) — a code reviewer that ships findings as you commit. The pattern generalises: a docs-drift watcher, a security companion, a metrics auditor, a test-coverage tracker.

This section is a **self-contained walkthrough** for any agent or orchestrator implementing or driving companion mode. The full runbook with deeper rationale lives in [`docs/how/companion-mode.md`](./docs/how/companion-mode.md).

### What companion mode is

A companion-mode agent:

1. Boots once at the start of a work session (a normal coordinated `minih run`).
2. Long-polls its inbox via `wait_for_any` (or `inbox_list --wait`) for messages from the outside operator.
3. Acts on each message **without exiting** — replies in-band when it has something to say, stays silent when the change is fine.
4. Receives a final `control:stop` signal when the operator decides the session is done.
5. Writes a **farewell envelope** to `$MINIH_OUTPUT_PATH` summarising the whole session — every finding, every retrospective insight, every magic-wand wish.

The opposite pattern — **one-shot agents** — boot, do one task, write output, exit. Companion mode is for work that's longer than one task and benefits from continuity (e.g., the reviewer remembers what it has already flagged so it doesn't repeat itself).

### When to use companion mode

Reach for companion mode when:

- You're doing multi-commit work (a plan implementation, a long refactor) and want continuous review without re-pasting full context every time.
- You want a **second pair of eyes** that fires findings asynchronously without blocking your main work.
- You want a single farewell artifact at the end (for retros, post-mortems, or auto-harvest into the project ledger).
- The agent benefits from in-session memory — knowing what it already flagged, what verdict it already gave, what the operator deferred.

Don't use companion mode when:

- The work is one task and one output. Use a normal one-shot agent.
- You need a synchronous gate (operator blocks on agent verdict). Use a one-shot or invert the pattern.
- You can't afford the idle compute cost. Companion mode keeps a session alive for the duration; the budget is bounded by `idleBudgetMs` (default 30 min) but it is non-zero.

### The Power On Mode protocol

"Power On Mode" is the orchestrator-side workflow that pairs with a companion. Five phases. The orchestrator drives; the companion follows.

#### 1. Boot

**First time per project**: install the canonical companion if you don't have it yet. Idempotent — re-running on an existing install upgrades or reports `unchanged`:

```bash
# Install the canonical companion from the bundled registry (one command, no clone)
minih agent install code-review-companion
```

If `agents/code-review-companion/` already exists in the project, this either upgrades it (when the source has changed) or reports `action: unchanged`. See [`docs/how/agent-pack.md`](./docs/how/agent-pack.md) for the full agent-pack surface.

**Then boot a run**:

```bash
# Boot the companion
npx minih run code-review-companion
```

Capture the run ID for use throughout the session:

```bash
RUN_ID=$(npx minih status code-review-companion 2>/dev/null | jq -r '.data.runId')
```

#### 2. Brief

Send one `briefing`-typed message naming the plan, the protocol expectations, and what to watch for:

```bash
# Brief the companion at session start
npx minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type briefing \
  --subject "Plan NNN — Power On Mode start" \
  --body "Plan: <path>
Spec: <path>

Protocol:
- I will ping at every commit boundary as type=task with subject 'review-request: T### <sha>'
- Fire-and-forget; reply only if you find issues
- I'll send control:stop when the session ends

Hazards to watch: <list>"
```

The companion long-polls with `waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']`. As long as one of those types arrives within its idle budget, it stays alive.

#### 3. Review at every commit boundary

After every meaningful commit during implementation:

```bash
# Review-request at every commit boundary
SHA=$(git rev-parse --short HEAD)
npx minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type task \
  --subject "review-request: T### $SHA" \
  --body "Diff: git show $SHA. Watch for: <specific concerns>. Reply if you find issues."
```

The companion either:

- Replies with one or more `finding`-typed messages targeting the review-request via `ackOf`, or
- Sends a `summary`-typed APPROVE message, or
- Stays silent if the change is fine.

Fire-and-forget — the orchestrator does NOT wait. If a finding arrives, address it in the next commit and ping the new SHA. Use `--ack-of <id>` (see [Reply chains](#reply-chains)) to thread responses to specific reviews.

#### 4. Drain (optional but recommended)

Before stopping, ping with the final SHA and ask for a full sweep:

```bash
npx minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type task \
  --subject "review-request: final $SHA — DONE" \
  --body "Final commit. Please scan the entire commit range for: <specific final checks>. I'll send control:stop after I read your reply."
```

This catches findings that only emerge from looking at the full diff, not individual commits.

#### 5. Stop and read the farewell

**Send `control:stop` BEFORE reporting back to your operator**:

```bash
# Stop signal — end the session
npx minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type control \
  --subject "stop — session done" \
  --body "stop — session complete. Please write your farewell envelope and exit."
```

The companion sees the `type:control` message, matches the body against `^stop\b`, transitions to `stopping`, writes a final report to `$MINIH_OUTPUT_PATH`, and exits. Then read the farewell:

```bash
RUN_DIR=agents/code-review-companion/runs/$RUN_ID
cat $RUN_DIR/output/report.json | jq
```

The farewell envelope contains the canonical session record. Fold any open findings or retro insights into your operator-facing report.

### Control signals

The companion's `prompt.md` defines which control signals it recognises. The canonical signals are:

| Signal | Body match | Effect |
|---|---|---|
| `control: stop` | `^stop\b` | Transition to `stopping`, write farewell envelope, exit. **Always wins** over an idle-budget shutdown until the farewell is committed. |
| `control: pause for <duration>` | starts with `pause for` | Implementation-defined (companion-specific). |

Other signals (e.g., a future `control: drain` distinct from `stop`) are a per-companion extension; check the agent's `prompt.md`.

### Farewell envelope shape

Companion-mode agents SHOULD emit a farewell envelope structurally similar to:

```jsonc
{
  "session": {
    "startedAt": "ISO-8601",
    "endedAt": "ISO-8601",
    "exitReason": "stop_requested | idle_budget | timeout | error",
    "messageCounts": {
      "tasksReceived": 0,
      "findingsSent": 0,
      "questionsAsked": 0
    }
  },
  "findings": [
    {
      "id": "F001",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "file": "path/to/file.ts",
      "category": "...",
      "issue": "...",
      "recommendation": "...",
      "ackOf": "01H...XYZ"
    }
  ],
  "summary": "Plain-prose recap of the session and verdict.",
  "retrospective": {
    "workedWell": "...",
    "confusing": "...",
    "magicWand": "...",
    "magicWandTarget": "coordination" | "minih" | "project",
    "coordination": { /* peer-flow notes */ }
  }
}
```

The exact schema lives in each companion's `output-schema.json`. The high-level structure (session metadata, findings array, summary, retrospective) is the contract orchestrators rely on.

### Pairing with `wait_for_any`

Companion implementations long-poll with [`wait_for_any`](#wait-for-any-plan-014) to wake on **both** inbox messages and state changes in a single call:

```jsonc
wait_for_any({
  events: [
    {
      kind: 'inbox.message',
      filter: { types: ['task', 'question', 'directive', 'control', 'briefing', 'review-request'] }
    },
    { kind: 'state.peer.changed' }
  ],
  waitMs: 30000
})
```

This means a companion can react to operator state-flips ("outside set status to `review-requested`") in addition to inbox traffic, without spin-polling. The clean-timeout path (no events within `waitMs`) returns `events: []` + `wait.timedOut: true` and is the natural moment to do periodic housekeeping (pulse a heartbeat, reset internal counters).

### Key rule

**Always send `control:stop` and read the farewell envelope before reporting back to your operator.** Three reasons:

1. The farewell is the canonical "everything I have to say" record. The companion may have findings that only surface in the final summary, not during live review.
2. Auto-harvest captures the retro for the project ledger only on run completion. Without the stop, the companion's `magicWand` and `difficulties` never reach `docs/retros/<slug>.md`.
3. It closes the loop deterministically. Without a stop, the companion idles for up to its `idleBudgetMs` (default 30 min) before self-terminating — wasted compute, fuzzy session boundary.

The pattern: orchestrator owns the lifecycle; the companion's idle budget is a safety net, not the primary exit condition.

### Upgrading an existing one-shot agent to companion mode

If you already have a coordinated or one-shot agent (say, a code reviewer that runs once per commit) and want to convert it to companion mode, the migration is editorial — five changes across at most four files. Walk through them in order.

#### Step 1: Mark the agent coordination-aware

In `agents/<slug>/prompt.md`, ensure the YAML frontmatter contains `coordination: enabled`:

```yaml
---
description: "..."
model: gpt-5.5
timeout: 7200          # bump — companions live longer than one-shots
coordination: enabled  # ← add this if missing
---
```

If your agent was previously a one-shot, also bump `timeout` (most companions sit idle far longer than a one-shot agent runs — 7200s = 2h is a reasonable default; the *real* lifetime is bounded by `idleBudgetMs`, not `timeout`).

#### Step 2: Add the long-poll loop and stop-handling to the prompt body

Insert (or extend) a section that tells the agent how to behave between tasks. The canonical shape:

```markdown
## Lifecycle

You are **long-running**. After every task, return to `idle` and long-poll for the next message:

```js
wait_for_any({
  events: [
    { kind: 'inbox.message', filter: { types: ['task', 'question', 'directive', 'control', 'briefing', 'review-request'] } },
    { kind: 'state.peer.changed' }
  ],
  waitMs: 30000
})
```

When a `type: control` message arrives whose body matches `^stop\b`, transition state to `stopping`, write your **farewell envelope** (see § Output) to `$MINIH_OUTPUT_PATH`, and exit. Until that happens, your idle budget (default 30 min) is a safety net — not the primary exit signal.
```

The exact prose can vary; what matters is that the agent (a) loops on `wait_for_any` (or `inbox_list --wait`), (b) recognises `^stop\b` in `type: control` bodies, and (c) writes the farewell on stop.

#### Step 3: Extend `output-schema.json` to the farewell shape

Replace (or extend) the agent's output schema with the canonical farewell envelope. Minimum-viable starter — copy this directly into `agents/<slug>/output-schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "<slug> Farewell Envelope",
  "type": "object",
  "additionalProperties": true,
  "required": ["session", "summary", "retrospective"],
  "properties": {
    "session": {
      "type": "object",
      "required": ["startedAt", "endedAt", "exitReason", "messageCounts"],
      "properties": {
        "startedAt": { "type": "string" },
        "endedAt": { "type": "string" },
        "exitReason": {
          "type": "string",
          "enum": ["stop_requested", "idle_budget", "timeout", "error"]
        },
        "messageCounts": {
          "type": "object",
          "properties": {
            "tasksReceived": { "type": "integer", "minimum": 0 },
            "findingsSent": { "type": "integer", "minimum": 0 },
            "questionsAsked": { "type": "integer", "minimum": 0 }
          }
        }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "severity", "issue"],
        "properties": {
          "id": { "type": "string" },
          "severity": { "type": "string", "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          "file": { "type": "string" },
          "issue": { "type": "string" },
          "recommendation": { "type": "string" },
          "ackOf": { "type": "string" }
        }
      }
    },
    "summary": { "type": "string" },
    "retrospective": {
      "type": "object",
      "properties": {
        "workedWell": { "type": "string" },
        "confusing": { "type": "string" },
        "magicWand": { "type": "string" },
        "magicWandTarget": { "type": "string" }
      }
    }
  }
}
```

The `findings` array is companion-specific (a reviewer collects findings; a docs-drift watcher collects drifts; a metrics watcher collects breaches). Rename or restructure that field to match your domain — keep `session`, `summary`, and `retrospective` as the contract.

#### Step 4: Add `outside.md` and the state schemas

Companion mode is coordinated, so the agent needs the operator-facing contract and per-side state schemas. Use `minih init --coordinated <throwaway-slug>` once in a scratch dir to generate canonical templates, then copy them into your existing agent directory:

```bash
# In a scratch dir
mkdir /tmp/scaffold && cd /tmp/scaffold
minih init --coordinated scaffolded
# Copy templates into your real agent
cp /tmp/scaffold/agents/scaffolded/outside.md            ~/your-project/agents/<slug>/
cp /tmp/scaffold/agents/scaffolded/inside-state.schema.json  ~/your-project/agents/<slug>/
cp /tmp/scaffold/agents/scaffolded/outside-state.schema.json ~/your-project/agents/<slug>/
```

Then edit `outside.md` to describe the contract for **your** agent (what `type: task` messages should contain, what state values mean in your domain, what reply types your agent emits) and prune the state-schema enums to your workflow.

#### Step 5: Verify

```bash
# Doctor catches missing-file / invalid-schema problems
minih doctor <slug>

# Smoke test: boot, send one briefing, send control:stop, read farewell
minih run <slug> &
RUN_ID=$(minih status <slug> 2>/dev/null | jq -r '.data.runId')

minih outside inbox send <slug> --run "$RUN_ID" \
  --type briefing --subject "smoke" --body "ping"

# (give it 10s to ack)
sleep 10

minih outside inbox send <slug> --run "$RUN_ID" \
  --type control --subject "stop" --body "stop"

sleep 5
cat agents/<slug>/runs/$RUN_ID/output/report.json | jq .session
# Expect: exitReason: "stop_requested"
```

If `report.json` shows `exitReason: "stop_requested"` and validates against your output schema, the migration is done. From there, plug it into your Power On Mode orchestrator (see § The Power On Mode protocol above).

#### What you do NOT need to change

- The agent's *core task logic* — companion mode is purely about lifecycle and contract; the per-task work is unchanged.
- `instructions.md` — keep it as-is; it still works.
- `input-schema.json` — only relevant for fresh-run params; companions usually don't need it after the first task (subsequent messages carry their own payload).
- The MCP tool surface — `wait_for_any`, `inbox_send`, `state_get`, etc. are baked into every coordinated run; no wiring needed.

### Pointers

- Full runbook + design rationale: [`docs/how/companion-mode.md`](./docs/how/companion-mode.md)
- Canonical implementation: [`agents/code-review-companion/`](./agents/code-review-companion/)
- Reply-chain primitive used by `ackOf`: [Reply chains](#reply-chains)
- Long-poll primitive used by companions: [Wait for any](#wait-for-any-plan-014)

---

## The Output Contract

Every agent must produce a JSON object written to the output path shown in the prompt. `$MINIH_OUTPUT_PATH` is the convenience variable for that path when the execution environment exposes it:

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

Agents must also run `minih check` before finishing to self-validate their output. If `$MINIH_OUTPUT_PATH` is unavailable in the agent shell, run `minih check <slug> --file <literal-output-path>` using the path from the prompt. If validation fails after 3 attempts, the agent should write a valid fallback JSON explaining what went wrong.

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
| [**coordination-smoke-test**](https://github.com/AI-Substrate/minih/tree/main/agents/coordination-smoke-test) | Minimal primitive check for outside/inside inbox, state, and retro coordination | No | default | After coordination CLI/MCP changes |
| [**coordination-loop-validator**](https://github.com/AI-Substrate/minih/tree/main/agents/coordination-loop-validator) | Rich worked example for a three-milestone outside/inside conversation loop | No | default | When validating coordination UX end to end |

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
minih init <slug> --coordinated           # Also create outside.md + state schemas

# Validation & inspection
minih doctor                              # Check all agents for convention compliance
minih check                               # Best-effort current output validation inside an agent
minih check <slug> --file <path>          # Validate a file against agent schema
minih inspect <slug>                      # Show fully composed prompt with sections
minih inspect <slug> --raw                # Without resolving template variables
minih validate <slug>                     # Re-validate latest completed run output
minih validate <slug> --run <runId>       # Re-validate a specific completed run output

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
minih tail <slug> --lines 20 --snapshot   # Print recent events and exit
minih list                                # Show all agents with descriptions
minih history <slug>                      # Past runs with status, duration, velocity trend
minih last-run <slug>                     # Latest run directory and report path
minih difficulties                        # Aggregate difficulty reports across all agents
minih difficulties --agent <slug>         # Filter to a specific agent

# Outside/inside coordination
minih outside context [slug]              # Show system guidance or a slug's outside contract
minih outside inbox send <slug> --run <runId> --subject ... --body ...
minih inside inbox list <slug> --run <runId> # Read inside replies from the outside lane
minih state get <slug> --run <runId>      # Read inside/outside state
minih state set <slug> --run <runId> --side outside --status in-progress
minih outside retro add <slug> --run <runId> --target coordination --body ...
minih retros --agent <slug> --run <runId> # Aggregate inside + outside retrospectives

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
| `MINIH_OUTPUT_PATH` | Where to write your JSON output when the execution environment exposes it; the prompt's literal output path is authoritative |
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
4. **Validate before finishing** — run `minih check` at the end to catch schema issues, or `minih check <slug> --file <literal-output-path>` if the shell cannot see `$MINIH_OUTPUT_PATH`
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

## The Improvement Loop

Every minih agent emits a **retrospective** on farewell — a `magicWand` (the one thing the agent wishes were different to make its job easier) and `difficulties` (structured friction reports). This is **the agent's input back into your harness**.

minih closes the loop by capturing those retrospectives into a project-level ledger:

```
docs/retros/
├── README.md                      # convention guide (scaffolded by `minih init`)
├── <agent-slug>.md                # per-agent ledger — auto-appended after every run
└── <plan-id>.md                   # per-plan ledger — appended when MINIH_PLAN_ID is set
```

### The flow

1. Agent emits `retrospective.magicWand` and `retrospective.difficulties` in its final `report.json`.
2. minih appends a canonical entry to `docs/retros/<slug>.md` automatically at run completion.
3. Operator (you) reviews the ledger before planning the next change.
4. The next plan's first task can be: "address the top 3 magicWand items from the last 10 runs".

### Manual harvest

```bash
minih harvest <slug>                  # capture latest run
minih harvest <slug> --since HEAD~1   # batch since a git ref / ISO timestamp
minih doctor                          # audit unharvested retros
```

### Opt-out

Set `MINIH_NO_AUTO_HARVEST=1` to suppress auto-append for the duration of a run (the explicit `minih harvest` verb still works).

### Privacy considerations

Retro content is generated by the LLM and committed to git by default. Review entries before pushing — `magicWand` and `difficulties` may include code snippets, file paths, or environment details. If your project handles secrets, set `MINIH_NO_AUTO_HARVEST=1` and add `docs/retros/` to `.gitignore` (or curate manually before commit).

### Why this matters

Without the harvest loop, agents emit retrospectives that vanish into run dirs. The compounding-velocity premise of agent harnesses depends on those retros surfacing. Closing this loop is what turns "I ran an agent" into "my agent harness got better".

## Coordination Visibility (peer activity)

Coordinated agents (those with an `outside.md` partner contract) are observed by minih every time you write to their inbox or state. Every `outside inbox send`, `outside state set/transition`, `outside retro add`, and `outside inbox list --wait` response now includes a **`peer` block** derived from the agent's `events.ndjson` tool-call telemetry:

```jsonc
{
  "data": {
    "messageId": "01K…",
    "peer": {
      "verdict": "deaf",                    // single-word contract
      "reason": "lastPollFilter [task,question] does not include 'review-request' — try one of: task, question",
      "willMatchType": false,
      "lastPollAt": "2026-04-29T08:35:01Z",
      "lastPollFilter": ["task", "question"],
      "currentlyPolling": true,
      "currentlyRunningTool": null,
      "selfReportedState": "idle",
      // ...behavioural facts
    }
  }
}
```

### The 7 verdict values

| Verdict | Meaning | Action |
|---|---|---|
| `listening` | Currently polling AND filter matches your message type | Proceed normally |
| `between-polls` | Healthy cadence, will pick up on next poll | Proceed normally |
| `deaf` | Polling but filter excludes your type | **Fix**: change `--type` (the `reason` includes a `try one of:` hint), or fix the agent's filter |
| `silent` | No poll for ≥5 min — likely mid-tool-call | **Wait** or check the agent |
| `dead` | Run terminated, or no poll for ≥30 min | **Resume or restart** |
| `n/a` | Agent is not coordination-enabled | No peer to evaluate |
| `unknown` | Telemetry unreadable | Investigate the run dir |

### Philosophy: minih is the messenger, not the police

minih **observes** what the agent is doing and labels it. minih never blocks, refuses, or coerces. The verdict is purely informational by default. If you want a hard refusal on `deaf`, opt in:

```bash
minih outside inbox send <slug> --type review-request --strict-peer ...
# Exits E150 DEAF_PEER if the agent's filter would reject the message.
```

`minih doctor` lists silent/dead active coordinated runs as part of its standard audit (healthy runs stay quiet). `deaf` is excluded because doctor doesn't have a target message type to evaluate filters against.

### Why this matters

State (what the agent says it's doing) can be stale, missing, or wrong. **Telemetry (what the agent is actually doing) is objective**. When you send a message into a deaf inbox, you previously found out via 30-minute timeout. Now you find out at send-time.
