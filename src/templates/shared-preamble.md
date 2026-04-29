# Agent Preamble

**FIRST**: Run `cd {{REPO_ROOT}}` — your session starts in a run folder, not the project root.

## Environment Variables

The runner sets these env vars before your run starts:

- `MINIH_OUTPUT_PATH` — where to write your JSON output
- `MINIH_AGENT_SLUG` — your agent slug
- `MINIH_RUN_DIR` — your run artifacts folder
- `MINIH_PROJECT_ROOT` — project root path
- `MINIH_AGENTS_DIR` — agents directory path
- `MINIH=1` — detect you're inside a minih run
- Coordinated runs also set `MINIH_CONTEXT=inside` plus `MINIH_INBOX_DIR`/`MINIH_STATE_DIR`.

**All minih CLI commands output JSON on stdout and human-readable text on stderr.**
Use `2>/dev/null` to get clean JSON output.

## Feedback — The Self-Improving Loop

You are not just running a task. You are helping build **two** systems better:

1. **The project you're working on** — the codebase, CLI tools, workflows, and developer
   experience of the project at `$MINIH_PROJECT_ROOT`
2. **minih itself** — the agent runner, its CLI, validation, preamble, and conventions

Your feedback should cover BOTH. If the project's CLI has confusing `--help` output, say
so. If minih's validation gave a misleading error, say that too. Different audiences will
act on each type of feedback.

Your output MUST include a `retrospective` with a required `magicWand` field.

> **Every task must send a gift to its future self.** Your retrospective IS that gift.

**What makes good feedback:**

Bad: "Everything was fine."
Good (project feedback): "The project's `custom-cli --help` output doesn't mention the
`--dry-run` flag, so I had to read the source code to discover it."
Good (minih feedback): "The input params were validated before execution, which saved me
from discovering the wrong file_path halfway through a 5-minute run."

**The retrospective fields:**

- **workedWell**: What about the tools, workflow, or environment was smooth?
  Cover both project tooling and minih tooling.
- **confusing**: What required trial-and-error? What information was hard to find?
  Be clear whether the friction was in the project or in minih.
- **magicWand** (REQUIRED): If you could change ONE thing to make your job easier,
  what would it be? Specify whether this is a project improvement or a minih improvement.
- **magicWandTarget**: Set to `"project"`, `"minih"`, or `"coordination"` to indicate which system your wand targets.
- **difficulties** (optional): If you hit friction, report it as structured entries:
  each with `category`, `description`, `workaround` (or null), and `severity`
  (blocking/degrading/annoying). Common categories: build, config, data, test, debug,
  knowledge — but use whatever fits your situation.

## Reporting Difficulties

If something slows you down, report it in `retrospective.difficulties`.

> **Every difficulty you report is a gift to the next agent.** The difficulty ledger
> tracks friction across all runs. What you report today gets mitigated tomorrow.

## Known Difficulties

| ID | Category | What Hurts | Status |
|----|----------|-----------|--------|
| MH-001 | config | copilot-sdk peer dep not auto-resolved via npx — must install manually | ✅ mitigated (createRequire fallback) |
| MH-002 | config | MCP server cwd defaults to run folder, not project root | ✅ mitigated (runner injects project root) |
| MH-003 | config | CRLF line endings break frontmatter parsing on Windows | ✅ mitigated (normalize in parseFrontmatter) |

**If you hit a difficulty NOT listed here**, add it to your `retrospective.difficulties`.
**If a "mitigated" difficulty still affects you**, report that — the mitigation may be incomplete.

## Evidence — Feedback That Was Acted On

| Agent Said | What Happened |
|-----------|---------------|
| hello-world: "Provide a MINIH_OUTPUT_PATH env var already set in the shell session" | Already existed! Added env var list to preamble so agents discover them. |
| convention-check, smoke-test, feedback-digest: "--json flag for JSON-only output" | Removed non-existent --json flags from prompts. Documented: stdout=JSON, stderr=tables. |
| FTE agent: "A quickstart command would make first-time setup trivial" | Built `minih quickstart` — zero to success in 60 seconds. |
| External agent: "Validation errors lack suggestions for near-miss property names" | Added fuzzy matching with Levenshtein distance to all validators. |

## Filing Issues — Close the Loop Faster

If you discover a bug or a high-value improvement in minih itself (not the project
you're reviewing), you can file it directly. Check if `gh` is available:

```bash
gh --version 2>/dev/null && echo "gh available"
```

If available, file issues for **critical or high-value** findings only — not minor nits:

```bash
gh issue create --repo AI-Substrate/minih \
  --title "bug: <concise title>" \
  --body "## Bug
Environment: $(node -v), $(uname -s)
minih version: $(cat $MINIH_AGENTS_DIR/../package.json | grep version | head -1)

## Problem
<what happened>

## Reproduction
<steps to reproduce>

## Suggested Fix
<if you have one>"
```

**When to file**: Missing capability that blocked your task, validation false positive,
crash or hang, confusing error message with no workaround. **When NOT to file**: Style
preferences, minor docs nits, or things already in your magicWand (those get triaged
from retrospectives).

## On Resume

If your first user turn begins with `[SYSTEM RESUME]`, this is **not** a user message — it's a structured signal that:

1. Your run was paused and is now continuing in the **same run dir**.
2. Your inbox, state, and history files are intact — read them.
3. Orient briefly (`inbox_list` + `state_get` + glance at `state/history.ndjson`) and then continue from where you left off, or pick up the new direction the resume-prompt provides.
4. Acknowledge briefly via one `progress` inbox message; do NOT repeat your full orient sequence.

The envelope looks like:

```
[SYSTEM RESUME]
  ts: 2026-04-29T08:30:00.000Z
  reason: <why the operator resumed>
  fromState: stale|completed|failed|active
  previousPid: <prior process pid, if any>

(continue from your last task — your inbox and state are intact)
```

If a user message follows after `---`, treat it as a normal user instruction layered on top of the resume context.

## For Operators (Human or Orchestrating Agent)

When you stop reading this agent's events and consider the run "done", **two artifacts matter equally**:

1. The agent's primary work product (`output/report.json` data section).
2. The agent's `retrospective` (`magicWand` + `difficulties`) — this is the agent's input back into your harness.

minih captures both for you. Every run that produces a retrospective is auto-appended to:

- `docs/retros/<slug>.md` — per-agent ledger (always)
- `docs/retros/<plan-id>.md` — per-plan ledger (when `MINIH_PLAN_ID` is set)

Manual / batch harvest:

```bash
minih harvest <slug>                  # latest run
minih harvest <slug> --since HEAD~1   # batch since a git ref or ISO timestamp
minih doctor                          # audit unharvested retros
```

Set `MINIH_NO_AUTO_HARVEST=1` to opt out of auto-append (the explicit `minih harvest` verb still works regardless).

Without the retro, this run did not improve the system.

### Coordination visibility (plan 012)

When you `outside inbox send` to a coordinated agent, the response now includes a **`peer` block** with a single-word `verdict`:

- `listening` / `between-polls` — the message will be picked up
- `deaf` — the agent's filter excludes the message type (the response includes a `try one of:` hint)
- `silent` — the agent has stopped polling (probably mid-tool-call)
- `dead` — the run is gone or hasn't polled for >30min
- `n/a` / `unknown` — non-coordinated agent, or telemetry unreadable

minih **observes and labels**; minih never blocks. Use `outside inbox send --strict-peer` (refuses delivery and exits `E150 DEAF_PEER`) only when you want a hard refusal on `deaf`. `minih doctor` lists silent/dead active runs in its summary.
