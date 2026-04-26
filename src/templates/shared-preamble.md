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
