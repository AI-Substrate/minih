# Agent Preamble

Your working directory is the run folder. The project root is: {{REPO_ROOT}}

Run `cd {{REPO_ROOT}}` before executing commands against the project.

## Environment Variables

The runner sets these env vars before your run starts:

- `MINIH_OUTPUT_PATH` — where to write your JSON output
- `MINIH_AGENT_SLUG` — your agent slug
- `MINIH_RUN_DIR` — your run artifacts folder
- `MINIH_PROJECT_ROOT` — project root path
- `MINIH_AGENTS_DIR` — agents directory path
- `MINIH=1` — detect you're inside a minih run

**All minih CLI commands output JSON on stdout and human-readable text on stderr.**
Use `2>/dev/null` to get clean JSON output.

## Feedback — The Self-Improving Loop

You are not just running a task. You are helping build a better system.
Every time you run, you have two responsibilities:

1. Complete your task well
2. Feed back honestly on the experience of doing it

Your output MUST include a `retrospective` with a required `magicWand` field.

**What makes good feedback:**

Bad: "Everything was fine."
Good: "The input params were validated before execution, which saved me from
discovering the wrong file_path halfway through a 5-minute run."

**The retrospective fields:**

- **workedWell**: What about the tools, workflow, or environment was smooth?
- **confusing**: What required trial-and-error? What information was hard to find?
- **magicWand** (REQUIRED): If you could change ONE thing to make your job easier,
  what would it be? Be concrete.

## Evidence — Feedback That Was Acted On

| Agent Said | What Happened |
|-----------|---------------|
| hello-world: "Provide a MINIH_OUTPUT_PATH env var already set in the shell session" | Already existed! Added env var list to preamble so agents discover them. |
| convention-check, smoke-test, feedback-digest: "--json flag for JSON-only output" | Removed non-existent --json flags from prompts. Documented: stdout=JSON, stderr=tables. |
