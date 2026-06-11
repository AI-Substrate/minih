---
schema_version: "1.0"
retro_id: "2026-06-11T11:14:29Z-claude-code-025fp"
agent: "claude-code"
plan_id: "025-dead-pid-liveness"
started_at: "2026-06-11T10:53:35Z"
ended_at: "2026-06-11T11:14:29Z"
summary: "Post-APPROVE review fix pass for plan 025: all six findings (4 MEDIUM + 2 LOW) closed TDD red→green — reconcile --all mutual exclusion (E108), race-hardened reconcile lock (lost steals → E190, never raw fs errors), forced-TTY render smoke through the built CLI, runner domain/map doc currency, plan-022 close-out deferred to its own commit. +5 tests, suite 1265/0. Two insights drained below at the plan-complete seam (stage-8 in-repo merge skipped — merging via GitHub PR)."
entries:
  - id: INS-001
    kind: insight
    description: "commander v13 detects the node -e eval context via process.execArgv and slices argv differently — a forced-TTY subprocess harness using -e gets the CLI path parsed as an unknown command"
    target: tooling
    workaround: "wrapper FILE instead of -e (test/cli/status-tty-render.test.ts) — argv[1] is a real script path, execArgv stays clean"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-11T11:10:49Z"
  - id: INS-002
    kind: insight
    description: "the injectable isProcessAlive probe fires exactly between reconcile-lock's stealability read and its unlink — its side effect simulates a competing stealer deterministically, no fs mocking needed for the unlink-side race test"
    target: project-sensor
    suggested_encoding: "pattern: injected predicates double as deterministic interleave points for race tests (write-side races still need vi.mock('node:fs'), isolated per file)"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-11T11:10:49Z"
---

# Retro — 025 dead-pid-liveness review fix pass

Stage 7 review (parallel agent) returned APPROVE with 4 MEDIUM + 2 LOW findings; the fix pass closed every code/doc finding in-session with red→green sensors (details: `docs/plans/025-dead-pid-liveness/dead-pid-liveness-plan.md` § Review Fix Pass and `execution.log.md`). Both insights above are already encoded as comments in the tests they shaped.
