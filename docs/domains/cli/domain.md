# Domain: cli

**Purpose**: User-facing CLI commands and composition root. Only place that directly imports `@github/copilot-sdk` (via dynamic import for the `run` command).

## Boundary

**Owns**: Command definitions (init, run, list, doctor, check, history, validate, tail, last-run), argument parsing, JSON output envelope, SDK client instantiation (composition root), agent scaffolding (init)

**Excludes**: Execution logic (runner), SDK communication (adapter), schema validation (runner)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/cli/index.ts` | internal | CLI entry point (shebang, commander program) |
| `src/cli/output.ts` | contract | MinihEnvelope — JSON output format (Phase 4) |
| `src/cli/commands/run.ts` | internal | Composition root — dynamic SDK import (Phase 4) |
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
| Composition root | `run.ts` is the only file that creates CopilotClient + SdkCopilotAdapter. Dynamic import. |
| stdout = machine | JSON envelope on stdout. Human formatting on stderr. TTY-detected. |
| Three consumers | Agent inside minih, external coding agents, humans/CI. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Placeholder entry point only. |
