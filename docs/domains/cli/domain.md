# Domain: cli

**Purpose**: User-facing CLI commands and composition root. Owns SDK runtime construction and wires domain-specific run configuration such as the inside MCP spawn factory.

## Boundary

**Owns**: Command definitions (init, run, resume, connect, list, doctor, check, history, validate, tail, last-run, outside coordination commands), argument parsing, JSON output envelope, SDK client instantiation (composition root), agent scaffolding (init), SDK runtime helper (shared by run + resume), cross-domain composition wiring, inside-context command blocking

**Excludes**: Execution logic (runner), SDK communication (adapter), schema validation (runner), MCP tool implementation (mcp)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/cli/index.ts` | internal | CLI entry point (shebang, commander program) |
| `src/cli/output.ts` | contract | MinihEnvelope — JSON output format (Phase 4) |
| `src/cli/commands/run.ts` | internal | Composition root — dynamic SDK import + inside MCP factory wiring + dry-run prompt preview through runner builder (Phase 4 / 007 P4/P6) |
| `src/cli/commands/resume.ts` | internal | Resume session — follow-up messages + inside MCP factory wiring (003-resume-prompt / 007 P4) |
| `src/cli/commands/connect.ts` | internal | Print copilot CLI resume command (003-resume-prompt) |
| `src/cli/commands/quickstart.ts` | internal | Scaffold + run hello-world in one command (FX001-quickstart) |
| `src/cli/commands/sdk-runtime.ts` | internal | Shared SDK bootstrap: auth, import, client, SIGINT (003-resume-prompt) |
| `src/cli/commands/list.ts` | internal | List agents with descriptions (Phase 4) |
| `src/cli/commands/doctor.ts` | internal | Structural validation plus coordinated `outside.md` drift/size checks (Phase 5 + 007 P6) |
| `src/cli/commands/check.ts` | internal | File validation against schema (Phase 5) |
| `src/cli/commands/init.ts` | internal | Agent scaffolding, including canonical shared-preamble creation and `--coordinated` outside/state-schema scaffold (Phase 5 + 007 P6) |
| `src/cli/commands/history.ts` | internal | Past runs display (Phase 4) |
| `src/cli/commands/validate.ts` | internal | Re-validate latest output (Phase 4) |
| `src/cli/commands/last-run.ts` | internal | Latest run info (Phase 4) |
| `src/cli/commands/tail.ts` | internal | Follow event stream (Phase 4) |
| `src/cli/commands/difficulties.ts` | internal | Aggregate difficulty reports across all agents (006-compounding-value) |
| `src/cli/preaction-context.ts` | internal | Reusable inside-context block for outside-only shell commands (007-backgrounding P5) |
| `src/cli/coordination.ts` | internal | Shared outside coordination CLI helpers: agent resolution, schema validation, inbox lane parsing/appending (007-backgrounding P5) |
| `src/cli/commands/outside-send.ts` | contract | Append outside-lane inbox messages, including ack records (007-backgrounding P5) |
| `src/cli/commands/outside-inbox-list.ts` | contract | Read/filter inside-lane replies for outside callers (007-backgrounding P5) |
| `src/cli/commands/state.ts` | contract | Outside state get/set/transition subcommands (007-backgrounding P5) |
| `src/cli/commands/outside-context.ts` | contract | Emit outside-side coordination markdown in a JSON envelope (007-backgrounding P5) |
| `src/cli/commands/outside-retro.ts` | contract | Record outside-side retro messages with target metadata (007-backgrounding P5) |
| `src/cli/commands/retros.ts` | contract | Aggregate inside report retros and outside retro messages (007-backgrounding P5) |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `MinihEnvelope` | Type | External agents, CI, humans (JSON output) |
| Error codes | Constants | All CLI consumers |
| Outside coordination commands | CLI | Outside callers coordinating with inside minih sessions |
| Inside-context block | CLI guard | Outside-only commands invoked from inside a minih session |
| `init --coordinated` | CLI | Agent authors creating two-sided coordinated agents |
| `doctor` outside-contract checks | CLI | Agent authors keeping `outside.md` current and bounded |

## Concepts

| Concept | Definition |
|---------|-----------|
| Composition root | `sdk-runtime.ts` owns shared SDK bootstrap (auth check, dynamic import, CopilotClient, SIGINT). Used by both `run.ts` and `resume.ts`. |
| Inside MCP wiring | `run.ts` and `resume.ts` import `mcp` spawn config and pass a generic factory to runner only at the CLI composition boundary. |
| stdout = machine | JSON envelope on stdout. Human formatting on stderr. TTY-detected. |
| Three consumers | Agent inside minih, external coding agents, humans/CI. |
| Outside commander surface | Humans, CI, and host agents coordinate with an inside session through `outside-send`, `outside-inbox-list`, `state`, `outside-context`, `outside-retro`, and `retros`. |
| Context block | `run`, `resume`, `quickstart`, `tail`, and `init` fail with `E128 INVALID_CONTEXT` under strict `MINIH=1`, while normal outside behavior is unchanged. |
| Cross-side retros | Inside managed `report.json.retrospective` entries and outside-lane `retro` messages flow into the same `retros` aggregation surface. |
| Coordinated scaffold | `init --coordinated` writes `coordination: enabled`, `outside.md`, and per-agent inside/outside state schemas without changing default init output. |
| Outside contract health | `doctor` warns when coordinated `outside.md` is stale or over 4KB and fails over 8KB after preserving realpath containment checks. |
| Dry-run prompt parity | `run --dry-run` uses `buildInsidePreamble()` and returns the assembled prompt in the JSON envelope, so coordinated previews include the same identity/tool/peer/checklist sections as real runs. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Placeholder entry point only. |
| Phase 4 | Full CLI implementation. Commander program with 6 commands (run, list, history, validate, last-run, tail). Output envelope (MinihEnvelope). Composition root with dynamic SDK import. Session isolation (CWD=runDir). chalk + cli-table3 for display. hello-world agent. |
| Phase 5 | Added `doctor`, `check`, `init`, and `run --dry-run`. Scaffolded `_shared/preamble.md`. `check` supports zero-arg via MINIH_* env vars. `init` creates output-schema with system fields. `dry-run` works without GH_TOKEN. |
| 002-pretty-mode | Added `--verbose` flag. Default display switched to PrettyDisplay (pretty.ts). SIGINT handler calls PrettyDisplay.cleanup(). |
| 003-resume-prompt | Added `resume` command (follow-up messages to completed sessions), `connect` command (print copilot CLI resume command). Extracted shared `sdk-runtime.ts` from `run.ts`. Updated `history` with `↩` indicator for resumed runs. |
| FX001-quickstart | Added `quickstart` command — scaffold + run hello-world in one command. Extracted `ensurePreamble()` from `init.ts`. |
| FX002-agent-ux | Suppressed SQLite ExperimentalWarning via `NODE_NO_WARNINGS`. Added tool elapsed timer to pretty mode. |
| 006-compounding-value | Added `difficulties` command (aggregates difficulty reports across all agents). Added velocity trend column + summary line to `history`. Run envelope now includes summary/magicWand/magicWandTarget/difficulties from parsed report.json. |
| 007-backgrounding P4 | Wired coordinated `run` and `resume` sessions to supply the inside MCP spawn config factory and reserved inbox/state tool namespace checks. |
| 007-backgrounding P5 | Added outside coordination CLI surface: context block guard, outside inbox send/list, outside state get/set/transition, outside-context, outside-retro, retros aggregation, command discovery, and run help guidance. |
| 007-backgrounding P6 | Extended `init` with `--coordinated` scaffolding and canonical shared-preamble creation, `doctor` with coordinated `outside.md` drift/size checks, and `run --dry-run` prompt preview parity while preserving default init and non-coordinated doctor behavior. |
