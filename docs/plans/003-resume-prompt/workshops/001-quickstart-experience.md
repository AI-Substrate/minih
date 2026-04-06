# Workshop: Quickstart Experience

**Type**: CLI Flow
**Plan**: 003-resume-prompt
**Spec**: resume-prompt-spec.md (adjacent feature — quickstart from FTE agent feedback)
**Created**: 2026-04-06T06:06:00Z
**Updated**: 2026-04-06T06:06:00Z
**Status**: Draft

**Related Documents**:
- FTE agent report: `agents/first-time-experience/` — scored 8.5/10, magic wand: "quickstart"
- Current init: `src/cli/commands/init.ts` — scaffold-only, requires manual editing
- hello-world agent: `agents/hello-world/prompt.md` — minimal env check

**Domain Context**:
- **Primary Domain**: cli (new command)
- **Related Domains**: runner (agent resolution, execution)

---

## Purpose

Design a `minih quickstart` command that gets a brand-new user from zero to a successful agent run in under 60 seconds — no file editing required. The FTE agent found that `init` requires manual editing of 3-4 files before you can run, which delays the "first success moment."

## Key Questions Addressed

- What does quickstart create vs init?
- Does quickstart also RUN the agent, or just scaffold a runnable one?
- How does it differ from `init` + editing + `run`?
- What agent does it scaffold? Generic or purposeful?
- Does it need GH_TOKEN, or should the first success be possible without it?

---

## The Problem

Current first-time flow (5 steps, ~5 minutes):
```
minih init my-agent          # scaffold
# manually edit prompt.md    # unclear what to write
# manually edit output-schema.json  # unclear what fields to add
# manually edit instructions.md     # vague template
minih doctor                 # validate
minih run my-agent           # finally run
```

The FTE agent noted: *"The init templates require manual editing before they produce meaningful output, which adds friction to the 'first success' moment."*

---

## Design: `minih quickstart`

### Command Overview

```
$ minih quickstart

┌─────────────────────────────────────────────────────────────┐
│ 🚀 minih quickstart                                        │
│                                                             │
│ Creating your first agent...                                │
│                                                             │
│   ✓ agents/hello-world/prompt.md                            │
│   ✓ agents/_shared/preamble.md                              │
│                                                             │
│ Running hello-world...                                      │
│                                                             │
│   ▸ Checking your environment                               │
│   💭 I'll examine the project...                            │
│   🔧 bash  pwd && ls                                        │
│   📝 Writing report...                                      │
│                                                             │
│ ─── Summary ───                                             │
│   Status:     completed ✓                                   │
│   Duration:   18.2s                                         │
│   Run dir:    agents/hello-world/runs/2026-04-06T.../       │
│                                                             │
│ 🎉 Your first agent ran successfully!                       │
│                                                             │
│ What just happened:                                         │
│   1. Created agents/hello-world/ with a simple prompt       │
│   2. Ran the agent against Copilot SDK                      │
│   3. Agent explored your project and wrote a report         │
│   4. Report saved to agents/hello-world/runs/.../           │
│                                                             │
│ Next steps:                                                 │
│   minih init my-agent        # Create your own agent        │
│   minih history hello-world  # See past runs                │
│   minih resume hello-world "Tell me more about the tests"   │
│                                                             │
│ Docs: https://github.com/AI-Substrate/minih                 │
╰─────────────────────────────────────────────────────────────╯
```

### What It Does

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Pre-flight checks                                   │
│   • GH_TOKEN set?                                           │
│   • agents/ dir writable?                                   │
│   • hello-world agent already exists? (skip scaffold)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Scaffold hello-world (if not exists)                │
│   • Create agents/hello-world/prompt.md (built-in)          │
│   • Create agents/_shared/preamble.md (if not exists)       │
│   • NO output-schema, NO instructions — minimal             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Run the agent                                       │
│   • Same as `minih run hello-world --timeout 120`           │
│   • Pretty mode (default)                                   │
│   • Stream output live                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Success celebration + next steps                    │
│   • "🎉 Your first agent ran successfully!"                 │
│   • Explain what happened (numbered steps)                  │
│   • Show next commands to try                               │
│   • Link to docs                                            │
└─────────────────────────────────────────────────────────────┘
```

### CLI Specification

```
Usage: minih quickstart [options]

Create and run your first agent in one command

Options:
  -h, --help    display help for command

Examples:
  minih quickstart                    # Create and run hello-world
  GH_TOKEN=$(gh auth token) minih quickstart   # With auth
```

**No flags.** Quickstart is opinionated:
- Always creates `hello-world`
- Always uses default model
- Always uses pretty mode
- Always 120s timeout
- No params, no dry-run, no verbose

### Hello-World Prompt (Built-In)

The quickstart creates a hello-world prompt that's designed to succeed quickly and produce interesting output:

```markdown
---
description: Confirm minih is working by reporting your environment and capabilities
tags: [smoke, minimal]
---

# Hello World

You are running inside minih. Confirm this by:

1. Run `cd {{REPO_ROOT}} && pwd` and report your working directory
2. Run `ls` to see what files are in the project root
3. Report the current date and time
4. Describe what tools you have available

Include your findings in the `summary` field of your JSON output.
```

This is the existing `agents/hello-world/prompt.md` — no need to invent a new one. It's fast (~20s), uses tools, and produces readable output.

**Why no output-schema?** System validation (summary + retrospective) is always enforced. Adding an output-schema would add complexity and potential validation failures to the first run. Keep it minimal.

---

## Design Decisions

### Q1: Should quickstart RUN the agent, or just scaffold?

**DECISION: Scaffold + Run.**

Rationale:
- The whole point is "zero to success in 60 seconds"
- Scaffolding without running leaves the user at the same place as `init`
- Running proves the tool works and gives immediate gratification
- If the run fails (no GH_TOKEN), the scaffold is still useful

### Q2: What if hello-world already exists?

**DECISION: Skip scaffold, just run.**

```
$ minih quickstart
  ℹ agents/hello-world already exists — running it...
  
  [normal run output]
```

This means `quickstart` is idempotent and always runnable. Second time is just a fast re-run.

### Q3: What if GH_TOKEN is missing?

**DECISION: Scaffold anyway, then give an actionable error for the run step.**

```
$ minih quickstart

  ✓ agents/hello-world/prompt.md

  ✗ GH_TOKEN not set. To run your agent:

    export GH_TOKEN=$(gh auth token)
    minih run hello-world
```

The user gets value (scaffolded agent) even without auth. They can run it later.

### Q4: Should quickstart create a different agent than init?

**DECISION: No. Same hello-world agent, different packaging.**

- `quickstart` = scaffold hello-world + run it + celebrate
- `init <slug>` = scaffold a blank template for a custom agent

They're complementary, not competing.

### Q5: What about the onboarding text — how verbose?

**DECISION: Celebration + 3 next-step commands. No essay.**

Keep it under 10 lines of guidance. The user just watched an agent run successfully — they're motivated, not confused. Point them forward, don't lecture.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `hello-world` already exists | Skip scaffold, run directly |
| `_shared/preamble.md` already exists | Skip, don't overwrite |
| GH_TOKEN missing | Scaffold, then actionable auth error |
| SDK not installed | Scaffold, then actionable install error |
| Run fails (timeout, SDK error) | Show normal error, agent is still scaffolded |
| Run succeeds but degraded (validation fail) | Show celebration anyway — it ran! |
| `agents/` dir doesn't exist | Create it |
| Non-TTY environment | JSON envelope only, no celebration |

---

## Success Criteria

```bash
# Brand-new project, no agents/
$ export GH_TOKEN=$(gh auth token)
$ minih quickstart

# Should see:
# 1. Files created (✓ prompt.md, ✓ preamble.md)
# 2. Agent running (pretty mode streaming)
# 3. Success celebration (🎉 + next steps)
# Total time: <60 seconds
```

---

## Implementation Notes

### Estimated Scope

- **New file**: `src/cli/commands/quickstart.ts` (~80-120 LOC)
- **Modified**: `src/cli/index.ts` (register command)
- **Test**: CLI registration test
- **Docs**: Add to README Quick Start section

### Shares Infrastructure With

- `run.ts` — `createSdkRuntime()` for SDK bootstrap
- `init.ts` — hello-world prompt template (or just hardcode it)
- `run.ts` — display logic (pretty mode, summary)

### What Quickstart Does NOT Do

- Doesn't create `output-schema.json` (system validation is enough)
- Doesn't create `instructions.md` (prompt is self-contained)
- Doesn't create `input-schema.json` (no inputs for hello-world)
- Doesn't modify existing agents
- Doesn't support `--model`, `--verbose`, `--timeout` flags
- Doesn't replace `init` — they're different tools for different moments

---

## Quick Reference

```bash
# The one command a newcomer needs:
minih quickstart

# What they'll do next:
minih init my-real-agent       # Create their own
minih run my-real-agent        # Run it
minih resume my-real-agent "..." # Continue a conversation
minih history my-real-agent    # Check past runs
```

---

## Open Questions

### Q6: Should quickstart suppress the SQLite ExperimentalWarning?

**OPEN**: The FTE agent flagged this as confusing noise. We could suppress it with `NODE_OPTIONS=--no-warnings` for the subprocess, but that might hide real warnings.

Options:
- A: Suppress with `--no-warnings` — clean output for newcomers
- B: Leave it — it's a Node.js issue, not ours
- C: Suppress only in quickstart, not in regular run

### Q7: Should the built-in hello-world be the same as agents/hello-world?

**RESOLVED**: Yes. Quickstart uses the exact same prompt as the repo's hello-world agent. If hello-world already exists (from a prior `init` or `quickstart`), skip scaffold and run what's there.

### Q8: README Quick Start — should it start with quickstart?

**OPEN**: Currently README says `npm install minih` → `npx minih init` → edit files → `npx minih run`. Should it say `npx minih quickstart` instead?

Options:
- A: Lead with quickstart, then show the manual flow as "Customizing your agent"
- B: Keep current flow, mention quickstart as an alternative
- C: Replace the current 5-step Quick Start with just quickstart

### Q9: Cold-start agent context — the prompting gap

**CRITICAL INSIGHT**: The FTE agent worked because it had ~60 lines of detailed step-by-step instructions. A real agent coming in **cold** has zero context about minih. The shared preamble covers runtime orientation (CWD, env vars, feedback), but doesn't explain what minih IS, what kinds of agents exist, the self-improving ethos, or how to use the CLI.

**DECISION**: Create `AGENTS_README.md` in repo root — a stable GitHub URL (`https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md`) that anyone can point agents to for cold-start context. Distinct from `README.md` (package reference). This is for *"I want to build an agent — where do I start?"*

Contents:
1. Philosophy — self-improving feedback loops, magic wand ethos
2. Install — `npx github:AI-Substrate/minih` or npm link
3. Agent folder convention — prompt.md, schemas, instructions
4. What kinds of agents you can build (real examples from dogfood agents)
5. The output contract — summary + retrospective + magicWand
6. CLI quick reference
7. Links to example agents in the repo
