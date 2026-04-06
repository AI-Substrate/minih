# Domain: cli

**Purpose**: User-facing CLI commands and composition root. Only place that directly imports `@github/copilot-sdk` (via dynamic import for the `run` command).

## Boundary

**Owns**: Command definitions (init, run, resume, connect, list, doctor, check, history, validate, tail, last-run), argument parsing, JSON output envelope, SDK client instantiation (composition root), agent scaffolding (init), SDK runtime helper (shared by run + resume)

**Excludes**: Execution logic (runner), SDK communication (adapter), schema validation (runner)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/cli/index.ts` | internal | CLI entry point (shebang, commander program) |
| `src/cli/output.ts` | contract | MinihEnvelope — JSON output format (Phase 4) |
| `src/cli/commands/run.ts` | internal | Composition root — dynamic SDK import (Phase 4) |
| `src/cli/commands/resume.ts` | internal | Resume session — follow-up messages (003-resume-prompt) |
| `src/cli/commands/connect.ts` | internal | Print copilot CLI resume command (003-resume-prompt) |
| `src/cli/commands/sdk-runtime.ts` | internal | Shared SDK bootstrap: auth, import, client, SIGINT (003-resume-prompt) |
| `src/cli/commands/list.ts` | internal | List agents with descriptions (Phase 4) |
| `src/cli/commands/doctor.ts` | internal | Structural validation (Phase 5) |
| `src/cli/commands/check.ts` | internal | File validation against schema (Phase 5) |
| `src/cli/commands/init.ts` | internal | Agent scaffolding (Phase 5) |
| `src/cli/commands/history.ts` | internal | Past runs display (Phase 4) |
| `src/cli/commands/validate.ts` | internal | Re-validate latest output (Phase 4) |
| `src/cli/commands/last-run.ts` | internal | Latest run info (Phase 4) |
| `src/cli/commands/tail.ts` | internal | Follow event stream (Phase 4) |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `MinihEnvelope` | Type | External agents, CI, humans (JSON output) |
| Error codes | Constants | All CLI consumers |

## Concepts

| Concept | Definition |
|---------|-----------|
| Composition root | `sdk-runtime.ts` owns shared SDK bootstrap (auth check, dynamic import, CopilotClient, SIGINT). Used by both `run.ts` and `resume.ts`. |
| stdout = machine | JSON envelope on stdout. Human formatting on stderr. TTY-detected. |
| Three consumers | Agent inside minih, external coding agents, humans/CI. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Placeholder entry point only. |
| Phase 4 | Full CLI implementation. Commander program with 6 commands (run, list, history, validate, last-run, tail). Output envelope (MinihEnvelope). Composition root with dynamic SDK import. Session isolation (CWD=runDir). chalk + cli-table3 for display. hello-world agent. |
| Phase 5 | Added `doctor`, `check`, `init`, and `run --dry-run`. Scaffolded `_shared/preamble.md`. `check` supports zero-arg via MINIH_* env vars. `init` creates output-schema with system fields. `dry-run` works without GH_TOKEN. |
| 002-pretty-mode | Added `--verbose` flag. Default display switched to PrettyDisplay (pretty.ts). SIGINT handler calls PrettyDisplay.cleanup(). |
| 003-resume-prompt | Added `resume` command (follow-up messages to completed sessions), `connect` command (print copilot CLI resume command). Extracted shared `sdk-runtime.ts` from `run.ts`. Updated `history` with `↩` indicator for resumed runs. |
