# Research Report: Outside/Inside Command Split + Notes/Inbox + State Schemas (prerequisites for future backgrounding)

**Generated**: 2026-04-26
**Research Query**: "Add outside/inside command split, notes/inbox messaging system, and first-class outside/inside state with schemas — these are prerequisites for a future plan to add a long-running background eventing system (e.g., a code-review agent that reacts to file-changed events while you edit)."
**Mode**: Plan-Associated (branch `007-backgrounding`)
**Location**: `docs/plans/007-backgrounding/research-dossier.md`
**FlowSpace**: Available (full graph indexed)
**Findings**: 80 across 8 specialized subagents (IA × 10, DC × 10, PS × 10, QT × 10, IC × 10, DE × 10, PL × 12, DB × 8)

---

## Executive Summary

### What It Does Today

minih is a synchronous, one-shot agent harness. Each `minih run <slug>` invocation spins up a Copilot SDK session, executes the agent's prompt to completion, validates the output, writes artifacts to a timestamped run folder, and exits. There is **no long-running process**, no inter-agent messaging, no shared state, and no event-driven trigger surface — every run is initiated by a human (or a tool acting as human) at a shell.

### Business Purpose of the New Capability

The user wants three concrete additions, framed as *prerequisites* for a follow-up backgrounding plan:

1. **Outside/inside command split** — agents need to know which CLI verbs are available to them based on whether they're running OUTSIDE minih (host caller, e.g. Claude Code or a human) or INSIDE minih (an agent currently being executed in a session). Today, both contexts get the same flat command list; some commands (`run`, `resume`, `quickstart`) are nonsensical and dangerous from inside a running agent.
2. **Notes/inbox messaging** — a filesystem-based inbox where outside and inside can append messages tagged with their sender. Each side checks its own inbox periodically. Use case: outside says "I just finished phase 2," inside replies "I just finished reviewing phase 2."
3. **First-class outside-state and inside-state with schemas** — schema-validated state files. Critical invariant the user named: *inside* cannot transition to "review-complete" until *outside* has signaled "edits-done." This is a coordination primitive.

The follow-up plan will add a long-running daemon mode that watches files (e.g., `src/**/*.ts` changed) and pushes events into the inside agent's session, so a code-review agent can be reviewing as you edit.

### Key Insights (the four things that change the design)

1. **Architecture decision (2026-04-26)**: the inside surface will be a small per-run MCP server that minih spawns and injects into the agent's session via the `mcpServers` plumbing Plan 005 already shipped. Per-session context (runId, runDir, agentSlug, paths) is baked into the MCP server's spawn config so agents invoke tools by name only — same hidden-context pattern as today's `MINIH_*` env vars but moved from "env vars + shellout" to "MCP tool calls." See Recommendations + Research Opportunity 2.
2. **The architecture cleanly supports adding messaging and state in the runner+cli domains** (with a new `mcp` module/domain for the inside server), but the future eventing/daemon mode requires another new domain because cli is "shell-and-exit" and runner is synchronous orchestration. (DB-05, DC-06, DC-10)
3. **A `check`-style dual-use pattern already exists in the codebase** (`src/cli/commands/check.ts:38-59`) — auto-detect slug + paths from `MINIH_*` env vars. This stays as-is for the existing legacy inside-shellout commands; new inside-only commands use MCP instead. (IA-10, PS-08)
4. **Sessions already persist on disk** at `~/.copilot/session-state/<uuid>/` and resume cleanly hours later because Plan 003 (`003-resume-prompt`) switched run completion from `destroy()` to `disconnect()`. This is the foundation for backgrounding: the agent's session lifetime is *decoupled* from the CLI process lifetime. (PL-01, DE-02)

### Quick Stats

- **Components**: ~25 source files across 3 domains (cli, runner, adapter)
- **CLI commands today**: 16 (run, resume, quickstart, list, inspect, check, validate, status, history, connect, doctor, difficulties, init, last-run, tail; plus `sdk-runtime` shared helper)
- **MINIH_* env vars exposed to inside agents**: 14
- **Schemas shipped**: 2 (retrospective.json, system-output.json)
- **Test files**: 12 (1929 LOC across runner/cli/adapter/helpers)
- **Dependencies**: 4 (ajv, chalk, cli-table3, commander) + peer `@github/copilot-sdk`
- **Prior plans**: 6 (001-setup → 006-compounding-value), 007 just opened
- **Prior learnings surfaced**: 12 directly relevant (mostly from 003-resume-prompt and 005-mcp-config)
- **External research opportunities**: 5 — **all completed 2026-04-26** (see `external-research/`); plus 1 empirical validation (MCP leak refuted for our usage pattern)
- **Empirical validations performed**: 1 (MCP server leak per Issue #1132 — NOT REPRODUCED in our SDK + `client.stop()`-in-finally pattern; see `external-research/mcp-leak-validation.md`)

---

## How It Currently Works

### Entry Points

| Entry Point | Type | Location | Purpose |
|------------|------|----------|---------|
| `minih run <slug>` | Command | `src/cli/commands/run.ts:38-363` | Fresh agent execution |
| `minih resume <slug> [msg]` | Command | `src/cli/commands/resume.ts:36-242` | Follow-up message to existing session |
| `minih connect <slug>` | Command | `src/cli/commands/connect.ts:26-192` | Print Copilot CLI handoff |
| `minih check [slug]` | Command (dual-use) | `src/cli/commands/check.ts:23-168` | Validate output JSON; auto-detects slug from `MINIH_AGENT_SLUG` |
| `minih validate [slug]` | Command (dual-use) | `src/cli/commands/validate.ts:21-147` | Re-validate latest output |
| `minih status / history / inspect / last-run / tail / list / doctor / difficulties / init / quickstart` | Commands | `src/cli/commands/*.ts` | Query and admin |
| Frontmatter parser | Internal | `src/runner/folder.ts:43-127` | Hand-rolled YAML for agent metadata |
| FakeAgentAdapter | Internal | `src/adapter/fake.ts` | Test double; never imports SDK |

### Core Execution Flow (fresh `minih run`)

1. **Parse & validate** (`run.ts:70-120`) — slug, --param k=v pairs, --model/--reasoning/--timeout, --mcp-config, --dry-run, --verbose.
2. **Resolve agent** — `resolveAgent(slug, agentsDir)` reads `agents/<slug>/prompt.md`, parses frontmatter (description required, optional model/reasoning/timeout/tags).
3. **Bootstrap SDK runtime** (`sdk-runtime.ts:46-205`) — check `GH_TOKEN`, dynamic `import('@github/copilot-sdk')`, instantiate `CopilotClient`, wrap in `SdkCopilotAdapter`, install SIGINT handler, validate model/reasoning combo against `client.listModels()`.
4. **Create run folder** (`folder.ts:201-244`) — `agents/<slug>/runs/<YYYY-MM-DDTHH-mm-ss-MSSZ-XXXX>/`. Copy (not symlink) prompt.md, instructions.md, output-schema.json, input-schema.json into folder ("frozen inputs").
5. **Assemble prompt** (`runner.ts:247-265`):
   ```
   preamble (agents/_shared/preamble.md, with {{REPO_ROOT}} substituted)
   ---
   instructions (optional, agents/<slug>/instructions.md)
   ---
   output hint ("Write your final JSON report to: <runDir>/output/report.json")
   ---
   input parameters (from --param)
   ---
   prompt body (frontmatter stripped from prompt.md)
   ---
   SYSTEM_OUTPUT_INSTRUCTIONS (defined in runner.ts:44-134; ~200 lines)
   ```
6. **Inject MINIH_* env vars** (`runner.ts:270-287`) — 14 vars including `MINIH=1`, `MINIH_AGENT_SLUG`, `MINIH_RUN_DIR`, `MINIH_OUTPUT_PATH`, `MINIH_AGENTS_DIR`, `MINIH_PROJECT_ROOT`, `MINIH_MODEL`, `MINIH_TIMEOUT`, `MINIH_SCHEMA_PATH`, `MINIH_INSTRUCTIONS_PATH`, `MINIH_PREAMBLE_PATH`, `MINIH_HAS_INPUT_SCHEMA`, `MINIH_PARAMS`. **All deleted in `finally`** — does not survive between CLI invocations.
7. **Execute** (`runner.ts:371-388`) — `adapter.run({ prompt, model, reasoningEffort, timeout, workingDirectory: runDir, mcpServers, sessionId? })`. Adapter creates session via `CopilotClient.createSession`, registers event handler, calls `session.sendAndWait(prompt, timeout)` racing a timeout promise. Events stream via `session.on(handler)` and are written line-by-line to `events.ndjson`.
8. **Validate** (`runner.ts:441-465`) — two stages: system (`validateSystemOutput` checks summary + retrospective.{workedWell,confusing,magicWand,magicWandTarget,difficulties}) then optional user schema (`validateOutput` against `output-schema.json`). Failures → `result: 'degraded'`, not hard failure.
9. **Write `completed.json`** with full metadata (see Contract IC-04 below) and exit envelope.
10. **Cleanup** — remove `MINIH_*` env vars, remove SIGINT handler, call `client.stop()`. Session remains preserved on disk via `disconnect()` (not `destroy()`).

### Resume Flow (skips most assembly)

`minih resume <slug> [message]` — `findRunSession(slug, agentsDir, runId?)` walks the runs/ folder (latest by lex sort if no runId), reads `completed.json` for `sessionId`, then calls `runAgent(adapter, def, { sessionId, promptOverride: message, ... })`. The runner sees `isResume = true`, *skips* preamble/instructions/system-instructions assembly, sends just the message via `session.sendAndWait`, and *skips* system validation (allows plain text follow-ups). A NEW run folder is created (`resumedFromRunId` field links back to predecessor).

### Run Folder Layout (filesystem contract — runner-owned)

```
agents/<slug>/runs/<YYYY-MM-DDTHH-mm-ss-MSSZ-XXXX>/
├── prompt.md                # Frozen copy
├── instructions.md          # Frozen copy (optional)
├── output-schema.json       # Frozen copy (optional)
├── input-schema.json        # Frozen copy (optional)
├── events.ndjson            # Stream of AgentEvent objects (one JSON per line)
├── stderr.log               # Captured stderr / agent error output
├── completed.json           # Final metadata (CompletedMetadata type)
└── output/
    └── report.json          # Agent's JSON report (must match system-output.json + optional user schema)
```

The runner enumerates everything in this folder via `listArtifacts()` (`runner.ts:526-538`) and stores the relative path list in `completed.json.artifacts`.

### Data Flow

```
[user shell]                        [agent inside session]
    │                                       │
    │ minih run <slug>                      │
    ▼                                       │
src/cli/commands/run.ts                     │
    │ parse flags, resolve agent            │
    ▼                                       │
src/cli/commands/sdk-runtime.ts             │
    │ GH_TOKEN, dynamic SDK import          │
    │ instantiate CopilotClient             │
    │ validateModelConfig                   │
    ▼                                       │
src/runner/runner.ts:runAgent               │
    │ createRunFolder + freeze inputs       │
    │ assemble prompt segments              │
    │ inject MINIH_* env vars               │
    ▼                                       │
src/adapter/sdk-copilot.ts                  │
    │ createSession({ workingDirectory,     │
    │                 mcpServers, model })  │
    │ session.sendAndWait(prompt, timeout) ─┤────► [agent reasoning]
    │                                       │      [tool calls: fs/bash/edit/...]
    │ session.on(handler) ──events──────────┤      [potential `npx minih check` shellouts]
    ▼                                       ▼
src/runner/runner.ts (event sink)    output/report.json (JSON written by agent)
    │ append to events.ndjson
    │ on completion: validate, write completed.json, exit envelope
```

### State Management

**Today there is none in the inter-agent sense.** Per-run state is a sequence of frozen artifacts on disk. The "state" of an agent's *thinking* lives entirely inside the SDK session (kept on disk by the SDK at `~/.copilot/session-state/<uuid>/`, but opaque to minih). Cross-run continuity exists only through `findRunSession` + sessionId resumption; nothing else persists.

---

## Architecture & Design

### Component Map (current)

```
┌─────────────────────────────────────────────────────┐
│ cli  (Commander.js commands; composition root)      │
│ ─ commands/{run,resume,connect,quickstart,list,...} │
│ ─ output.ts (MinihEnvelope, ErrorCodes E100–E127)   │
│ ─ commands/sdk-runtime.ts (shared bootstrap)        │
└────────────────────┬────────────────────────────────┘
                     │ resolveAgent, runAgent, validate*, display*
                     │ findRunSession, parseFrontmatter, listAgents
                     ▼
┌─────────────────────────────────────────────────────┐
│ runner (orchestration; SCHEMA-FIRST)                │
│ ─ runner.ts (runAgent + SYSTEM_OUTPUT_INSTRUCTIONS) │
│ ─ folder.ts (discovery, frontmatter, run folders)   │
│ ─ validator.ts (AJV 2020-12, fuzzy property hints)  │
│ ─ pretty.ts + display.ts (terminal output)          │
│ ─ types.ts (AgentDefinition, AgentRunConfig,        │
│             CompletedMetadata, VelocityData,        │
│             ParsedReport, RunSession)               │
│ + src/schemas/{retrospective,system-output}.json    │
└────────────────────┬────────────────────────────────┘
                     │ IAgentAdapter, AgentEvent, AgentResult
                     ▼
┌─────────────────────────────────────────────────────┐
│ adapter (SDK isolation)                             │
│ ─ interface.ts (IAgentAdapter)                      │
│ ─ events.ts (10-type AgentEvent discriminated union)│
│ ─ copilot-types.ts (local SDK facade)               │
│ ─ sdk-copilot.ts (real SdkCopilotAdapter)           │
│ ─ fake.ts (FakeAgentAdapter for tests)              │
└─────────────────────────────────────────────────────┘
```

Strict import direction `cli → runner → adapter`. The runner has zero SDK imports; the adapter has zero runner/cli imports. Cross-domain communication is via the typed interfaces.

### Design Patterns Identified

1. **Folder-as-agent convention** (`runner.ts`, `folder.ts`) — "an agent IS a folder with a prompt.md." All discovery, validation, and execution flow from this. PS-04 / DB-02.
2. **Schema-first artifacts (JSON Schema 2020-12 + AJV, fresh per call)** — `src/schemas/*.json` define the system contract; agent-local `output-schema.json` defines per-agent contract; same validator stack handles both. Fuzzy property suggestion via Levenshtein when validation fails. PS-01 / IC-02 / PL-10.
3. **Two-stage validation (system → user)** — system fields (summary + retrospective) are mandatory and enforced by minih; user schema is opt-in. Both fail-soft to `'degraded'`. PS-07 / PL-08.
4. **Dual-use commands via env-var auto-detection** — `check` and `validate` work outside (explicit args) AND inside (env-var fallback). The pattern `slug ?? process.env.MINIH_AGENT_SLUG` is the kernel of inside/outside support today. IA-10 / PS-08.
5. **Composition-root pattern** — `sdk-runtime.ts` is the single place that touches the SDK constructor; cli/runner/test code never `import '@github/copilot-sdk'` directly. DC-01.
6. **Stdout = machine, stderr = human** — every command emits a `MinihEnvelope` JSON to stdout and pretty/table output to stderr. Inside-callable commands MUST honor this (PL-11). PS-05 / IC-01.
7. **Frozen inputs for reproducibility** — every run *copies* prompt/instructions/schemas into the run folder so the run is reproducible even if the source is later edited. PS-04 / IA-07.
8. **Encode-don't-document pipeline** — agent friction → `retrospective.difficulties` → `minih difficulties` aggregates → human curates `_shared/preamble.md` → next agents see the mitigation. The preamble IS the documentation distribution mechanism. DE-06 / DE-07.
9. **Hand-rolled simple utilities, minimal deps** — frontmatter parser, YAML simple, Levenshtein, JSON envelope are all hand-written. No gray-matter, zod, joi, chokidar, child_process. PS-10 / DC-10.
10. **Config-threading template** — `--mcp-config` flag (Plan 005) established the canonical flow: CLI flag → `loadMcpConfig` → `AgentRunConfig.mcpServers` → adapter → SDK session. Mutually exclusive with auto-discovery (`.mcp.json` at project root). PL-06 / PL-07 / IC-03.

### System Boundaries

- **Internal boundaries**: cli ⇄ runner ⇄ adapter, with strict downward-only imports.
- **External interfaces**: `@github/copilot-sdk` (peer dep), shell (commander parses argv, writes stdout/stderr), filesystem (agents/, runs/), `GH_TOKEN` env var, optional `.mcp.json` and MCP servers.
- **Integration points**: agents themselves invoke `npx minih check`/`doctor`/`validate` from inside the session — *de facto* inside calls today, but undeclared as such.

---

## Dependencies & Integration

### What This Depends On

#### Internal Dependencies
| Dependency | Type | Purpose | Risk if Changed |
|------------|------|---------|-----------------|
| `IAgentAdapter` interface | Required | Runner→Adapter contract | High; runner cannot be tested without it |
| `AgentEvent` discriminated union (10 types) | Required | NDJSON streaming, pretty display | Medium; adding new event types is forward-compatible |
| Run folder filesystem layout | Convention | Reproducibility, history, resume | High; new files MUST follow naming conventions or break tools |
| `CompletedMetadata.result` enum | Required | History/validate/findRunSession | Medium; extending the union (e.g., `'running'`) is a breaking change unless `running.json` is used as a side-channel (IC-04) |
| `_shared/preamble.md` | Required (auto-scaffolded by `init`) | Agent discovery of conventions | Low; additive sections are safe |
| `SYSTEM_OUTPUT_INSTRUCTIONS` constant | Required | Mandates report.json shape | Medium; appending sections is safe; reordering fields is breaking |

#### External Dependencies
| Service/Library | Version | Purpose | Criticality |
|-----------------|---------|---------|-------------|
| `@github/copilot-sdk` | `>=0.1.32` (peer) | Session, model registry, MCP wiring | Critical |
| `ajv` | `^8.17.1` | JSON Schema 2020-12 validation | Critical |
| `commander` | `^13.1.0` | CLI parsing | Critical |
| `chalk` | `^5.6.2` | Pretty output (stderr) | Low |
| `cli-table3` | `^0.6.5` | History/difficulties tables (stderr) | Low |
| `GH_TOKEN` env var | n/a | SDK auth — checked in `sdk-runtime.ts` | Critical |

**Notably absent**: chokidar/watchman (file watching), nanomessage/zeromq (IPC), pm2/systemd (process supervision), any database. The minimalism is deliberate (PS-10 / DC-10). Adding a daemon mode will require either Node's native `fs.watch` or a new runtime dep.

### What Depends on This

#### Direct Consumers (today)
- **End users** via shell (Claude Code, Codex, humans, CI).
- **Agents themselves**, via `npx minih check`, `npx minih doctor`, `npx minih validate` shellouts inside their own sessions (DC-03). These calls are *inside* in spirit but *outside* in mechanism — they spawn a fresh process that re-imports minih, has no shared session, and pays per-call cold-start cost.
- **Programmatic export surface** at `src/index.ts` (~30 lines): `AgentEvent`, `AgentResult`, `FakeAgentAdapter`, `AgentDefinition`, `AgentRunConfig`, `AgentRunResult`, `CompletedMetadata`, etc. (IC-09)

#### Indirect Consumers
- `release-please` (CI) consumes `package.json` and conventional commits.
- Future consumers we should anticipate: a backgrounding daemon (which will *internally* call `runAgent` via the runner contract, not via the CLI).

### Integration Architecture

The new capability widens the integration surface in three places:

1. **CLI surface** — adds context-aware dispatch and new inbox/state subcommands. (cli domain)
2. **Filesystem layout** — adds `inbox/`, `state/` (or equivalent) under the run folder. (runner-owned convention)
3. **Future-only**: a new daemon process model orthogonal to the existing CLI command lifecycle. (new domain — see DB-05)

---

## Quality & Testing

### Current Test Coverage
- **Test files**: 12 (1929 LOC)
- **Runner**: 9 files, deepest coverage (prompt assembly, validation, env vars, frozen artifacts, session resume, velocity)
- **CLI**: 2 files using `execSync` against the built `dist/cli/index.js` (init, doctor, check, dry-run, run paths covered; resume/connect/tail/history NOT covered)
- **Adapter**: 1 file (FakeAgentAdapter unit tests)
- **Helpers**: `validSystemOutput` builder
- **Vitest config**: minimal — sequential by default, no concurrency limits, no setup files, default 30s timeout, no retries.

### Test Strategy Analysis
- Runner tests are *property-based*: assert observable outputs (files written, env vars set, NDJSON lines), not internals.
- Each test creates a unique tmpdir via `fs.mkdtempSync` and cleans up in `afterEach`. Safe for sequential, would mostly be safe for parallel.
- CLI tests rely on `dist/` being fresh. CI builds before testing; local `npm test` does not — a known papercut. (QT-01)
- Session/resume tests model state by writing fake `completed.json` files into temp run folders.
- FakeAgentAdapter exposes `emitToolCall`, `emitToolResult`, `emitThinking`, plus `assertRunCalled`/`assertTerminateCalled` — extensible to model inbox/state mocks (QT-02).

### Known Issues & Technical Debt
| Issue | Severity | Location | Impact |
|-------|----------|----------|---------|
| CLI tests need `npm run build` first | Medium | `test/cli/commands.test.ts` | Local `npm test` can give false negatives |
| No tests for resume/tail/history/status/connect commands | Medium | `test/cli/` | CLI regressions easy to miss |
| No concurrency tests (two agents sharing inbox/state) | High for new work | n/a | The new capability has no test infrastructure today |
| Event ordering not stress-tested | Low | `events.ndjson` | Could matter under high streaming throughput |
| `prepare` script runs `npm run build` on install — fragile on Windows | Low | `package.json` | Mitigated by Node-API build scripts (PS-10) |
| No coverage reporting in CI | Low | `.github/workflows/ci.yml` | Hard to track coverage over time |

### Performance Characteristics
- Runner unit tests: 50–100ms each (mostly fs I/O)
- CLI tests: 500–1000ms each (subprocess overhead)
- Full suite: ~5–10s sequential
- **Velocity tracking** (`computeVelocity`) caches per-run timing in `completed.json` for O(1) chained lookups; skips failed/degraded runs (PL-09).

### Quality Gate (`just fft`)
`lint → format → build → typecheck → test → audit`
CI matrix: Node 20 + 22 on Ubuntu, blocking PRs unless every step passes (npm audit is non-blocking via `|| true`).

---

## Modification Considerations

### ✅ Safe to Modify
1. **Adding optional fields to `AgentRunConfig`, `CompletedMetadata`, `MinihEnvelope.data`** — additive, type-compatible, semver-minor.
2. **Adding new event types to the `AgentEvent` discriminated union** — consumers that switch exhaustively will get a TS warning to handle the new case, but downstream parsing is forward-compatible (`AgentRawEvent` already exists as a catch-all).
3. **Adding new CLI commands** — `registerXCommand(program)` pattern is uniform. New commands trivially slot in (`src/cli/index.ts`).
4. **Adding new MINIH_* env vars** — backward compatible. Inside agents that don't read them are unaffected.
5. **Extending the preamble** — additive sections, distributed automatically.
6. **Adding new schemas under `src/schemas/`** — already-validated by build (`scripts/copy-schemas.js` copies them into `dist/`).
7. **Adding new error codes E128+** — next free code is E128 (IC-01).

### ⚠️ Modify with Caution
1. **The `result` enum on `CompletedMetadata`** — used by `history`, `validate`, `findRunSession`. Adding `'running'` would imply that runs in progress should be findable by status — but the current model assumes `completed.json` only exists for finished runs. Consider a side-channel `running.json` instead (IC-04).
2. **The strict `cli → runner → adapter` import direction** — anything that violates this will break the architecture. If the daemon mode needs file-watching, watcher code goes in a NEW domain (see DB-05/DB-06), not bolted onto runner.
3. **MINIH_* env var cleanup in `finally`** — currently aggressive (cleans all 14 vars). If background mode lets agents persist across CLI invocations, the cleanup model needs to change. (DC-05)
4. **Session destruction** — Plan 003 set the rule: ALL runs use `disconnect()` not `destroy()`. Adding any code path that calls `destroy()` will break resume/backgrounding (PL-04).
5. **Prompt assembly order** — adding new segments to the prompt prologue may bump prior agents' baseline behavior; consider feature-flagging or making segments opt-in via frontmatter (PS-03).

### 🚫 Danger Zones
1. **Allowing inside agents to call `minih run` recursively** — would create unbounded session nesting and consume tokens fast. The new outside/inside split should *block* `run`/`resume`/`quickstart`/`init` from inside contexts (IA-02 / DB-01).
2. **Changing the run folder layout in non-additive ways** — breaks history, resume, tail, validate. New artifacts MUST be additive (new subdirectories or new files) and ignored by older minih versions if downgraded.
3. **Schema breakage on `system-output.json` or `retrospective.json`** — every existing agent run depends on these. Versioning strategy needed before changes.
4. **Replacing the SDK's session lifecycle** — agents already shell-out to `minih check`/`doctor`. Background-mode messaging that bypasses the SDK risks a forked behavior model.

### Extension Points (designed for modification)
1. **Frontmatter fields** — adding `agentRole: outside | inside`, `stateSchema: ...`, `inboxPollEvery: 30s` is a clean extension; the parser already silently ignores unknown keys (`folder.ts:43-100`).
2. **`SYSTEM_OUTPUT_INSTRUCTIONS`** — append a new section (e.g., "If MINIH_INBOX_PATH is set, check it before completing each major task").
3. **CLI option-level mutual exclusion** — Plan 005 set the precedent for `--mcp-config` vs auto-discovery; the same applies for `--state-mode outside-driven` vs frontmatter-driven (PL-07).
4. **`FakeAgentAdapter`** — accepts pre-configured event sequences; can be extended to track inbox/state mutations as test assertions (QT-02).
5. **Run folder additions** — `inbox/`, `state/`, `running.json`, `snapshots/` all fit the existing convention.

---

## Prior Learnings (From Previous Implementations)

> The Prior Learnings Scout surfaced 12 relevant discoveries from plans 001-006 — all directly applicable. **Pay close attention to PL-01 through PL-05 from `003-resume-prompt`** — they encode the entire prior art on session lifecycle, which is the foundation of any backgrounding work.

### 📚 PL-01: Session persistence works regardless of `destroy()` vs `disconnect()`
**Source**: `docs/plans/003-resume-prompt/execution.log.md:26-36` · **Type**: discovery · **Date**: 2026-04-06

**Found**: Both `destroy()→resumeSession()` and `disconnect()→resumeSession()` succeed. SDK persists to `~/.copilot/session-state/<uuid>/` immediately on first activity. `destroy()` only releases the in-memory handle; it is not destructive on disk.

**Resolution**: Adopted `disconnect()` everywhere for *semantic clarity* (explicit "preserve") rather than relying on `destroy()`-but-it-still-works.

**Why this matters now**: Background agents and the future eventing system need long-lived session continuity across separate CLI invocations. The SDK already supports this; we don't need to invent persistence — we need to *not break* it.

**Action**: Use `disconnect()` for backgrounded agents. Treat `~/.copilot/session-state/<uuid>/` as the canonical session-state location. Do NOT add per-process session caching that would bypass it.

### 📚 PL-02: CWD isolation prevents minih sessions from polluting user's `copilot --resume` list
**Source**: `docs/plans/003-resume-prompt/research-dossier.md:215-220` · **Type**: decision

**Found**: Setting `workingDirectory` to the run folder makes the SDK file resume candidates by CWD — minih sessions stay invisible to user's interactive `copilot` workflow.

**Why this matters now**: When outside and inside coexist, both will create sessions. CWD isolation already gives us per-run separation. Outside/inside agents can use the same mechanism (each gets its own runDir → CWD → session bucket).

**Action**: Background daemon must continue setting `workingDirectory=runDir`. Do NOT centralize sessions in a single CWD or they'll all collide and pollute `copilot --resume`.

### 📚 PL-03: Multi-turn pattern is already proven via `compact()`
**Source**: `docs/plans/003-resume-prompt/research-dossier.md:227-231` · **Type**: insight

**Found**: `compact()` uses `disconnect()` to enable subsequent turns. This is the architectural template for any multi-turn flow.

**Why this matters now**: A backgrounded code-review agent that processes file-changed events is fundamentally a multi-turn agent — file change is "next message." Use the existing `compact()` template.

**Action**: Background event processing = `resumeSession(sessionId) + sendAndWait(eventDescription)`. Do not invent a parallel "event injection" mechanism; reuse the SDK's send pipeline.

### 📚 PL-04: Premature `destroy()` in `finally` breaks resumption — guard with `sessionDestroyed`
**Source**: `docs/plans/003-resume-prompt/research-dossier.md:233-237` · **Type**: gotcha

**Found**: A naive `finally { session.destroy() }` after every run will silently break resume because the second run will call `destroy()` on an already-destroyed session.

**Action**: Background runner must NOT auto-destroy in `finally`. Explicit cleanup only — on timeout, on user-requested stop, or on session expiry.

### 📚 PL-05: Session ID lookup needs `session_start` event capture for timeout tracking
**Source**: `docs/plans/003-resume-prompt/research-dossier.md:239-243` · **Type**: insight

**Found**: Runner extracts sessionId from the `session_start` event for timeout cleanup. This is the only authoritative point.

**Why this matters now**: A background daemon managing N concurrent agents needs a session registry: `sessionId → lastActivityAt → timeoutMs`. File-change events refresh `lastActivityAt`.

**Action**: Build a session registry in the future daemon domain, not in runner. Use `session_start` events to populate it.

### 📚 PL-06: Config threading pattern is canonical — CLI → AgentRunConfig → adapter → SDK
**Source**: `docs/plans/005-mcp-config/research-dossier.md:114-117` · **Type**: insight

**Action**: New inbox/state config (paths, schemas, poll intervals) follows the same pattern. Don't auto-discover from arbitrary locations; thread explicit values.

### 📚 PL-07: Mutually exclusive config modes prevent ambiguity (`--mcp-config` XOR auto-discovery)
**Source**: `docs/plans/005-mcp-config/mcp-config-plan.md:107-116` · **Type**: decision

**Action**: For state schemas, decide one rule: agent-defined (`agents/<slug>/outside-state.json`) OR project-default (`src/schemas/outside-state.json`), never merged. Document precedence clearly.

### 📚 PL-08: System output enforcement is universal — every agent emits summary + retrospective
**Source**: `docs/plans/001-setup/tasks/phase-5-doctor-check-init/001-subtask-system-output-enforcement.md:126-159` · **Type**: decision

**Action**: Inside agents called by the daemon must STILL produce system output (summary + retrospective + magicWand + difficulties). This is the contract for compounding-value (every run improves the system). Don't carve out exceptions for inbox/event-driven agents.

### 📚 PL-09: Velocity computation skips failed/degraded runs
**Source**: `docs/plans/006-compounding-value/compounding-value-spec.md:73-77` · **Type**: discovery

**Action**: Background-mode runs should also report velocity; the chain-skipping behavior is reusable.

### 📚 PL-10: AJV `$ref` URIs must be absolute (`https://minih.dev/schemas/...`)
**Source**: `docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md:250` · **Type**: insight

**Action**: New state and inbox schemas use absolute `$id` URIs. Don't use relative refs — they break when paths differ between outside and inside.

### 📚 PL-11: stdout = JSON envelope (machine), stderr = pretty (human)
**Source**: `docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md:251` · **Type**: gotcha

**Action**: Inside agents that shell out to outside `minih` commands MUST parse stdout only. Every new inside-callable command MUST guarantee valid JSON on stdout, even on error. Three-of-five dogfood agents independently asked for `--json`; the convention exists, agents just don't know it. Document in preamble + per-command help.

### 📚 PL-12: Inside agents need an enumerated MINIH_* env var table
**Source**: `docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md:252` · **Type**: gotcha

**Found**: hello-world agent asked for `MINIH_OUTPUT_PATH`. Until the preamble listed it, agents couldn't discover which vars existed.

**Action**: Add a new MINIH_* env vars table section to the preamble whenever new vars are introduced (`MINIH_CONTEXT`, `MINIH_INBOX_PATH`, `MINIH_STATE_PATH`, etc.). Consider adding `minih env --json` as a self-describing command for agents to query their own env.

### Prior Learnings Summary

| ID | Type | Source Plan | Key Insight | Action |
|----|------|-------------|-------------|--------|
| PL-01 | discovery | 003-resume-prompt | Sessions persist on disk regardless of destroy/disconnect | Use `disconnect()` for backgrounded sessions |
| PL-02 | decision | 003-resume-prompt | CWD-based session isolation prevents pollution | Each runDir = isolated session bucket |
| PL-03 | insight | 003-resume-prompt | `compact()` already proves multi-turn pattern | Backgrounded events = `resume + send`, not new mechanism |
| PL-04 | gotcha | 003-resume-prompt | Naive finally `destroy()` breaks resume | Background runner: no auto-destroy in finally |
| PL-05 | insight | 003-resume-prompt | sessionId arrives via `session_start` event | Daemon session registry keyed off this event |
| PL-06 | insight | 005-mcp-config | Explicit config threading; no auto-discovery surprises | Inbox/state config flows the same way |
| PL-07 | decision | 005-mcp-config | Mutually-exclusive modes; never merge | Pick one schema-source per artifact |
| PL-08 | decision | 001-setup | System output is universal | Background agents still emit retrospective |
| PL-09 | discovery | 006-compounding-value | Velocity skips failed/degraded | Same chain logic for background runs |
| PL-10 | insight | 001-setup | Absolute $id URIs in JSON Schema | New schemas all use `https://minih.dev/schemas/*` |
| PL-11 | gotcha | 001-setup | stdout=JSON, stderr=pretty | All inside-callable commands honor this |
| PL-12 | gotcha | 001-setup | Agents need enumerated env-var docs | Update preamble for every new MINIH_* var |

---

## Domain Context

### Existing Domains Relevant to This Research

| Domain | Relationship | Relevant Contracts | Key Components |
|--------|--------------|--------------------|----------------|
| `cli` | Directly relevant — outside/inside split is fundamentally a cli concern (commander structure + dispatch + envelope) | `MinihEnvelope`, `ErrorCodes` | `commands/run.ts`, `commands/resume.ts`, `commands/check.ts`, `commands/sdk-runtime.ts`, `output.ts` |
| `runner` | Directly relevant — owns the run-folder filesystem convention (where inbox/state files live), schema validation, env-var injection, prompt assembly | `AgentDefinition`, `AgentRunConfig`, `CompletedMetadata`, `RunSession`, `validateOutput`, `parseFrontmatter` | `runner.ts`, `folder.ts`, `validator.ts`, `types.ts`, `src/schemas/*` |
| `adapter` | Tangentially relevant — owns SDK session lifecycle and event union (the bus we'll forward state-changed/inbox-arrived events on, if we use this path) | `IAgentAdapter`, `AgentEvent`, `AgentResult`, `ICopilotSession` | `interface.ts`, `events.ts`, `sdk-copilot.ts`, `copilot-types.ts`, `fake.ts` |

### Domain Map Position (current)

```
cli ──listAgents, resolveAgent, findRunSession, runAgent, validate*, display*──> runner
cli ──SdkCopilotAdapter, ICopilotClient──> adapter
runner ──IAgentAdapter, AgentEvent, AgentResult──> adapter
```

The new capability sits primarily in **cli** (commands + context detection + envelope) and **runner** (filesystem conventions + schemas + state helpers), with NO new edges into adapter for the prerequisite work. The future eventing/daemon plan, however, requires a new domain — see Critical Discovery 03 below.

### Potential Domain Actions (from Domain & Boundary Scout)

- **Extend `runner`** with `state.ts` (state shape + transition helpers), `context.ts` (`detectContext()`, `MINIH_CONTEXT_ENV_VARS` constant), and additions to `folder.ts` (`getInboxPath`, `getStatePath`). Add `src/schemas/{outside-state,inside-state,inbox-message}.json`.
- **Extend `cli`** with new command files: `commands/inside.ts` and `commands/outside.ts` (or flat `inbox-*`, `state-*` commands — see Recommendations).
- **Defer**: a new `daemon` domain for the FUTURE eventing plan. Prerequisite work doesn't need it.

### Domain-map update (proposed for prerequisite work)

```
cli ──[+ context.ts, + state.ts]──> runner       (new helpers)
cli ──new inbox/state commands write/read──> runner's folder convention
runner ──no new dependencies──> adapter           (unchanged)
```

For the future eventing plan:
```
daemon (new) ──> runner ──> adapter
daemon ──spawns subprocess that calls──> runAgent
cli ──"daemon start/stop/status" commands──> daemon
```

---

## Critical Discoveries

### 🚨 Critical Finding 01: There is NO formal contract today for "is this command inside or outside?"
**Impact**: Critical to the new capability
**Sources**: IA-10, DB-01, PS-08
**What**: Today, `check.ts:38-59` and `validate.ts` are *de facto* dual-use, falling back to `process.env.MINIH_AGENT_SLUG` when the slug arg is omitted. There is no `isInside()` helper, no per-command metadata declaring valid contexts, no protection against `minih run <slug>` being called inside a session (which would create runaway nested sessions). Some commands (`list`, `tail`) require a TTY and would silently misbehave inside; others (`run`, `resume`, `quickstart`, `init`) are fundamentally unsafe inside.
**Why it matters**: The whole outside/inside design hinges on a clean, formal answer. Today it's implicit and accidentally correct only for two commands.
**Required action**: Define context detection and per-command context metadata as a foundation step before adding inbox/state commands.

### 🚨 Critical Finding 02: Inbox/state location decision has cascading reproducibility implications
**Impact**: Critical to design choice
**Sources**: PS-04, IC-07, DB-02
**What**: The runner's "frozen inputs" pattern means each run folder is a self-contained snapshot. Three plausible locations for inbox/state:
- **(A) Inside the run folder** (`runs/<runId>/inbox/`, `runs/<runId>/state/`) — preserves reproducibility, isolated per run, but inbox can't span across runs (the use case "outside writes during run #1 → inside reads during run #2 of the same agent" is harder).
- **(B) Per-agent shared** (`agents/<slug>/inbox/`, `agents/<slug>/state.json`) — supports cross-run continuity, but breaks "frozen artifact" reproducibility.
- **(C) Hybrid**: per-agent for state (mutable), per-run for inbox transcripts (frozen at run end via snapshot).

The user's stated use case ("outside finishes phase 2, inside finishes review of phase 2") implies **per-agent shared** state and inbox, with per-run snapshots for audit. But this is a philosophical break from the current "an agent IS a folder, runs are immutable" stance and needs explicit design ratification.
**Why it matters**: Picking the wrong default breaks either reproducibility (A) or per-run isolation (B); picking C adds complexity that needs design.
**Required action**: Specify a single canonical layout in `/plan-1b-specify` *before* writing code.

### 🚨 Critical Finding 03: The future eventing/daemon mode is a NEW domain, not a runner extension
**Impact**: Critical for the follow-up plan (defer for now)
**Sources**: DB-05, DB-06, DC-06, DC-10, DE-01
**What**: Today's CLI is `shell-and-exit` (DC-06: zero `child_process` use, only SIGINT handler). Today's runner is synchronous orchestration. Long-running file-watching is not just a new feature — it's a different *process model*. Bolting it onto cli or runner would violate domain boundaries and create cross-cutting state. A new `daemon` domain is the right home for: pidfile management, signal handling (SIGTERM/SIGHUP), file watcher (chokidar or `fs.watch`), session registry, supervisor.
**Why it matters**: Knowing this NOW shapes the prerequisite design. Inbox/state must be designed so a future daemon can drive them, not so they're locked into CLI command flow.
**Required action**: For the prerequisite plan, treat inbox/state as data structures + thin CLI wrappers. Do NOT couple them to commander internals. The future daemon should be able to read/write inbox/state files and call `runAgent()` directly, bypassing the CLI shell.

### 🚨 Critical Finding 04: SDK session TTL is unknown — we have no contract for how long backgrounded sessions stay resumable
**Impact**: Critical for the future eventing plan; relevant for prerequisite design
**Sources**: DC-04, IA-04, External Research Opportunity 1
**What**: `disconnect() → resumeSession()` works empirically (PL-01), but the SDK does not document a TTL. If the daemon resumes a session 24 hours after the last activity and the SDK has GC'd it, what happens? `findRunSession` doesn't probe for liveness — it just returns whatever sessionId is in `completed.json`.
**Why it matters**: Long-running file-watching agents will quietly stop working when sessions expire if we don't have a fallback ("session expired → start fresh, write to inbox to brief the new session").
**Required action**: Treat session resumption as best-effort. Design the inside agent so it can be reconstituted from inbox + state without requiring an alive SDK session.

### 🚨 Critical Finding 05: System output enforcement collides with backgrounded agents that "never complete"
**Impact**: Important for design
**Sources**: PL-08, IC-02, IC-04
**What**: Every minih run today MUST emit summary + retrospective + magicWand. A background code-review agent that runs for hours over many file-change events doesn't have one definitive "complete" moment to write a final report. The `result: 'completed' | 'degraded' | 'failed' | 'timeout'` enum doesn't accommodate `'running'`.
**Why it matters**: Either we extend `CompletedMetadata.result` (breaking change), use a side-channel `running.json` (suggested in IC-04), or define explicit "checkpoint" semantics where each event-driven turn writes its own mini-report.
**Required action**: Decide the lifecycle model in spec. Recommendation (preliminary): `running.json` while backgrounded, `completed.json` only when daemon stops the agent or the agent terminates itself; each turn appends to `events.ndjson` as today.

---

## Supporting Documentation

### Related Documentation
- `README.md` — explicit "When NOT to use minih" includes "Implementation — editing files, running tests, fixing errors in a feedback loop with you watching. That's a skill." This positions minih as deliberately *not* the long-running interactive companion that backgrounding partially flips. (DE-01)
- `AGENTS_README.md` — 602 lines; Philosophy section frames agents as users of developer tools and every retrospective as a usability study.
- `AGENTS.md` — Copilot/Claude instructions including the strict import direction.
- `CONTRIBUTING.md` — release-please / conventional commits / `feat:` minor / `feat!:` major.
- `docs/domains/{registry,domain-map}.md` and `docs/domains/{adapter,cli,runner}/domain.md` — current domain definitions.
- Plan dossiers `001-setup` through `006-compounding-value` — collectively the institutional memory; mined for PL findings.

### Key Code Comments
- `src/cli/commands/run.ts:1-9` documents "DYK" notes about session lifecycle and SDK isolation.
- `src/cli/commands/sdk-runtime.ts:38-45` documents "DYK #2: Extract shared composition root."
- `src/runner/runner.ts:44-134` is `SYSTEM_OUTPUT_INSTRUCTIONS` — the de facto agent system prompt.

### Historical Context
- Plan 001 set up the three-domain architecture and the system output contract.
- Plan 002 introduced pretty mode + delta accumulation (informs how new event types should display).
- Plan 003 enabled session resumption via `disconnect()` — the *foundation* for all future backgrounding.
- Plan 005 established the config-threading pattern (`--mcp-config`) — the canonical way to add new opt-in configuration.
- Plan 006 added the difficulties pipeline — the model for "agents report → minih aggregates → preamble curates" feedback loops.
- Issue #20 (just fixed in commit `a151e46` on this branch): pre-flight model/reasoning validation. Demonstrates the project's preference for failing fast at the CLI layer with actionable error messages.

---

## Recommendations

### If Implementing the Outside/Inside Split

> **Architecture decision (2026-04-26):** "Outside" remains commander subcommands. "Inside" is the per-run MCP server's tool surface. There is NO new family of `minih inside-*` shellout commands — the inside is a different protocol surface (MCP), not a CLI prefix.

1. **Add `detectContext()` helper in runner** (`src/runner/context.ts`). Still useful for the existing dual-use shellout commands (`check`, `validate`) and for safety-blocking commands like `run`/`resume` if accidentally invoked from inside. `process.env.MINIH === '1'` remains the gate. (DB-01)
2. **Mark each commander command with a `contexts: Array<'outside'|'inside-shellout-legacy'>` metadata field**. At command registration, a `preAction` hook consults `detectContext()` and exits with `E128 INVALID_CONTEXT` if mismatched. The "inside-shellout-legacy" tag covers the existing `check`/`validate` etc. that agents already shell out to today and that we won't migrate to MCP for the prerequisite work. (IA-10)
3. **Block from inside (existing CLI surface)**: `run`, `resume`, `quickstart`, `init`, `tail`, `connect` (most are nonsensical or require TTY). Anything stateful or session-spawning.
4. **Keep dual-use shellouts for**: `check`, `validate`, `status`, `last-run`, `inspect`, `history`, `doctor`, `difficulties`. Already inspection-style; no behavior change for inside agents that use them today.
5. **New inside surface (MCP tools, not CLI commands)**: `inbox.list`, `inbox.send`, `inbox.ack`, `state.get`, `state.set`, `state.transition`. Tool names are stable; per-session context (runId, runDir, agentSlug, side) is baked into the MCP server's spawn config so agents call tools by name only.
6. **New outside CLI commands** (peer to the MCP tools, for host callers): `minih outside-send`, `minih outside-inbox-list`, `minih state get/set/transition` (state CLI is dual: outside command form, with explicit slug + side args).

### If Implementing Notes/Inbox

> **Architecture decision (2026-04-26):** Inside surface is MCP, not shellouts. Inside agents call MCP tools (`inbox.list`, `inbox.send`, `inbox.ack`) by name only; per-session context (runId, runDir, agentSlug, inboxPath) is baked into the MCP server's spawn config — agents never see IDs or paths. The hidden-context pattern mirrors today's `MINIH_*` env vars but moves from "env vars + shellout" to "MCP tool calls with baked-in context."

1. **Use append-only NDJSON files** mirroring `events.ndjson`: `inbox/outside/messages.ndjson` (written by outside, read by inside) and `inbox/inside/messages.ndjson` (written by inside, read by outside). Atomic per-line writes via `fs.appendFile`. (PS-04, IC-07) — these are the *backing store*; the MCP server is the only thing that writes them in the inside direction.
2. **Define `InboxMessage` shape in runner** (with absolute `$id` URI per PL-10):
   ```jsonc
   { "id": "<uuid|sequence>", "sender": "outside|inside",
     "type": "note|status|directive|free", "subject": "...",
     "body": "...", "ts": "<ISO>", "ack"?: { "msgId": "...", "by": "outside|inside" } }
   ```
3. **Inbox location**: per-agent **shared** path (`agents/<slug>/inbox/`) — the user's stated use case ("phase 2 done") implies cross-run conversation. Take a snapshot into the run folder at run end for reproducibility. (Critical Finding 02)
4. **Inside surface = MCP tools** exposed by the per-run MCP server (not commander subcommands):
   - `inbox.list({ unread?: bool, type?: string })` → returns messages addressed to this agent's side
   - `inbox.send({ type, subject, body })` → writes to peer's inbox file (target side baked in by spawn config)
   - `inbox.ack({ msgId })` → marks a peer's message acknowledged
   - All take **no IDs or paths** — context is hidden via spawn config, identical to how `MINIH_AGENT_SLUG` works today.
5. **Outside surface = commander subcommands** (unchanged from research):
   - `minih outside-send <slug> --type note --subject "..." --body "..."` (host caller writes a note to an agent's inbox)
   - `minih outside-inbox-list <slug>` (host caller reads what agents have sent back)
6. **Preamble + SYSTEM_OUTPUT_INSTRUCTIONS** must instruct inside agents to call `inbox.list` periodically — MCP doesn't auto-trigger periodic polling; the prompt does. Server-push (notifications) is available with MCP and should be evaluated for the future eventing plan but is not required for the prerequisite work. (PS-02)

### If Implementing First-Class State

> **Architecture decision (2026-04-26):** Same MCP-with-baked-context pattern as inbox. Inside agents call `state.get`, `state.set`, `state.transition` by name; the MCP server knows which side ("inside") it represents and which paths to read/write because that's baked into its spawn config.

1. **Two state files** per agent at `agents/<slug>/state/{outside,inside}.json`. Each validated by `src/schemas/{outside-state,inside-state}.json` (system defaults) plus optional per-agent overrides. (DB-03, PS-01)
2. **Schema includes `phase` enum** (e.g., `[idle, in-progress, paused, complete]`) plus arbitrary `data` object for free-form payload.
3. **State-transition rules in runner** (`src/runner/state.ts`): pure function `isAllowedTransition(side, from, to, peerState): boolean`. The user's invariant "inside cannot transition to `complete` until outside is `done`" is encoded here. Both the MCP server's `state.transition` tool AND the outside `minih state set` CLI command call this rule — failed transitions return a typed error (E12X for CLI; MCP tool error for inside). (DB-07)
4. **Inside reads/writes**: via MCP tools `state.get({ key? })`, `state.set({ key, value })`, `state.transition({ to, reason })` — caller passes only intent; the MCP server knows which side it is and where the file lives.
5. **Outside reads/writes**: via commander commands `minih state get <slug> [--side outside|inside] [--key ...]`, `minih state set <slug> --key ... --value ...`, `minih state transition <slug> --to ... --reason ...`.
6. **Each transition appends to `state/history.ndjson`** for audit (written by whichever surface — MCP or CLI — applied the transition).

### If Designing for the Future Eventing/Daemon Plan (defer most decisions, but plant flags now)

1. **Don't couple inbox/state to commander internals.** A future daemon should be able to write inbox messages and read state by calling helpers in `src/runner/{state,inbox}.ts` directly, bypassing commander.
2. **Use `running.json` as a side-channel** for backgrounded runs in progress, leaving `completed.json` for terminal states. (IC-04)
3. **Add `MINIH_MODE=foreground|background` env var** even before the daemon exists — prepares agents to know which lifecycle they're in.
4. **The daemon belongs in a NEW `daemon` domain** with its own `domain.md`. Don't preemptively add files; flag the boundary in the spec. (DB-05, DB-06)

### If Refactoring This Area

1. **Extract `SYSTEM_OUTPUT_INSTRUCTIONS` to a markdown file** (`agents/_shared/system-output-instructions.md`) so it's editable without recompile and can be diffed against agent versions. Currently a 200-line `runner.ts` constant.
2. **Add a `minih env --json` command** (PL-12) so inside agents can self-discover `MINIH_*` without grep'ing the preamble.
3. **Add CI test coverage for resume/connect/tail/history/status** — they're untested today (QT-04).

---

## External Research Opportunities

During codebase exploration the following knowledge gaps emerged that cannot be answered by reading more code. They are ordered by how much they would change the prerequisite design (most impactful first).

### Research Opportunity 1: SDK session TTL and resumption failure modes — ✅ COMPLETED 2026-04-26
> **Result**: see `external-research/sdk-session-ttl.md` (Perplexity Sonar Deep Research, grounded with local copilot-sdk source). Key facts: 30-min idle = in-memory only; on-disk state survives until `client.deleteSession`; `client.listSessions(filter?)` is the canonical liveness probe; `infiniteSessions: true` is the right mode for backgrounded agents. **Plus** see `external-research/mcp-leak-validation.md` — empirical refutation of Issue #1132 for our usage pattern.

**Why Needed**: Without knowing how long sessions stay resumable, we can't decide whether the inside agent's identity is "the SDK session" (ephemeral) or "the inbox + state" (durable). This shapes the prerequisite spec, not just the future eventing plan.
**Impact on Plan**: Determines whether inbox messages must be designed to brief a *fresh* session that loses prior context, or whether they can rely on session continuity.
**Source Findings**: DC-04, IA-04, PL-01, Critical Finding 04

**Ready-to-use prompt:**
```
/deepresearch "What is the session lifetime contract for @github/copilot-sdk's CopilotClient sessions when used with disconnect() rather than destroy()? Specifically:

(a) How long do sessions persist on disk at ~/.copilot/session-state/<uuid>/ before the SDK or backend GC's them?
(b) When a stale session is passed to client.resumeSession(sessionId), what error or behavior do we get? Silent failure, exception, fresh-session creation, or a typed error?
(c) Is there any keep-alive or heartbeat we can issue to extend a session's life without consuming significant tokens?
(d) Are there limits on the number of concurrent live sessions per CopilotClient instance, or per process, or per GitHub user/token?
(e) What happens to outstanding MCP server processes when a session disconnects vs destroys vs expires?
(f) Does the SDK expose any API to query session liveness without attempting a full resume?

Context: We're building a CLI harness around copilot-sdk where each `run` invocation creates a session and `disconnect()`s; a separate `resume` invocation reads the sessionId from disk and calls resumeSession. We're now planning a long-running daemon mode that may resume sessions hours or days after creation, possibly with intervening file-change events. We need to design correctly for the failure mode where the session is gone.

Use authoritative sources: github.com/github/copilot-cli, GitHub Copilot SDK docs, npm @github/copilot-sdk readme, any GitHub blog posts. Avoid speculation — flag any answer you can't source. Recency window: prefer info from 2025+."
```

**Results location**: `docs/plans/007-backgrounding/external-research/sdk-session-ttl.md`

### Research Opportunity 2: ✅ DECIDED 2026-04-26 — small minih-spawned MCP server is the inside channel

> **Decision (user, 2026-04-26):** We are NOT going to add more shellouts. The new inside-only surface (inbox, state, future event-arrived notifications) will be implemented as a small purpose-built MCP server that minih spawns per-run and injects into the SDK session via the existing `mcpServers` plumbing from Plan 005.
>
> **Hidden-context pattern (per user direction):** Per-session parameters — `runId`, `agentSlug`, `runDir`, `inboxPath`, `statePath`, `sessionId`, etc. — get baked into the MCP server's startup config (CLI args or env to the spawned MCP process) at spawn time, the same way `MINIH_*` env vars hide context from agents today. Inside the session, the agent calls tools by name only (`inbox.send`, `state.set`, `state.transition`) without ever needing to know IDs or paths. The MCP server uses its baked-in context to do the right thing.
>
> **Implications carried forward into the spec:**
> - New module (likely `src/mcp/`) — own its own domain.md (probably a 4th domain alongside cli/runner/adapter, since it talks to BOTH runner internals AND the SDK protocol surface).
> - Tools defined as MCP tool definitions, not commander subcommands. Inside-only commander commands probably go away or become thin diagnostic wrappers.
> - Outside half of the split stays in cli (commander subcommands, JSON envelope on stdout).
> - The MCP server is spawned by `runAgent` (or by sdk-runtime) before `createSession`, with run-context passed via spawn args. Killed in `finally` alongside `client.stop()`.
> - Migration cost question is moot — we're starting with MCP from day one for the new surface; existing shellout commands (`check`, `validate`, `doctor`) remain as they are.
> - Server-push (notifications without polling) becomes available to the future eventing plan "for free" because MCP supports it.
>
> The research questions below remain useful as IMPLEMENTATION research (which library, how to spawn, auth pattern, failure handling, test ergonomics) — not as decision research. Keep them, but reframe target file as `inside-mcp-implementation.md`.

**Why Needed (now: implementation guidance, not decision)**: We've decided MCP-injected is the architecture. We still need to pick a library and pattern.
**Why Needed**: Today inside agents reach minih by shelling out (`npx minih check`, `npx minih doctor`). It works but has cold-start cost, no shared state, no streaming, and no server-push. The new inbox/state surface adds 4–8 more inside commands and the future eventing plan needs server-push semantics that shellouts can't deliver. **Important context (corrected)**: minih currently has *zero* MCP-server code — Plan 005 (`docs/plans/005-mcp-config/`) was strictly about minih *consuming* external MCP servers (forwarding `--mcp-config` / auto-discovered `.mcp.json` into `AgentRunConfig.mcpServers` → SDK `createSession`). The broader idea of `minih serve --mcp` (exposing the full CLI surface as MCP tools to *external* agents) was already considered and explicitly deferred post-V1 in `docs/plans/001-setup/workshops/002-cli-command-design.md` Q5 with the rationale "ship CLI-only and validate the model before adding another protocol surface." The question for THIS plan is narrower: should the new *inside-only* surface be added as more shellout commands (matching the current pattern), OR should minih grow a tiny purpose-built MCP server module that gets injected into each agent's session via the `mcpServers` plumbing Plan 005 already shipped? Choosing now matters because every shellout we add is a future migration cost.
**Impact on Plan**: If "MCP-injected inside tools" is the right answer, the spec changes meaningfully — inside commands become MCP tool definitions (not commander subcommands), we add a `src/mcp/` module, the dependency surface gains an MCP server SDK, and testing strategy changes. If "more shellouts is fine for the prerequisite work, evaluate MCP later," the spec stays cli-only and we accept the migration cost.
**Source Findings**: DC-02, DC-03, DC-09, IC-06; deferral history at `docs/plans/001-setup/workshops/002-cli-command-design.md` Q5; consumption-only context at `docs/plans/005-mcp-config/mcp-config-spec.md` Non-Goals (line 32) + research-dossier PL-02 (line 119–120: "this issue is about minih CONSUMING MCP servers during agent runs").

**Ready-to-use prompt:**
```
/deepresearch "Decision-support research for a CLI agent harness called 'minih'. Context: minih wraps @github/copilot-sdk to run LLM agents one-shot. Today, when an agent is executing inside a session and needs to call back to its host (e.g., to validate output), it shells out: `npx minih check`. The harness already CONSUMES external MCP servers (forwards `mcpServers` config to SDK createSession) but does NOT itself expose any MCP server. A larger idea — `minih serve --mcp` exposing the full CLI to external agents — was already explicitly deferred post-V1 with the rationale 'ship CLI-only and validate the model before adding another protocol surface'.

We are now adding ~4–8 new inside-only commands (inbox-send, inbox-list, inbox-ack, state-get, state-set, state-transition, plus future event-arrived notifications when we add a backgrounding daemon). Question: should these new inside-only commands be implemented as more shellouts (consistent with current pattern) or as a small minih-spawned MCP server module that gets registered into each agent's session via the SDK's existing mcpServers config?

Please research:

(a) Cold-start and per-call latency: typical numbers for spawning `npx <local-cli> <subcmd>` in Node 20+ vs invoking a tool on a long-running stdio MCP server registered in the same SDK session. Order of magnitude.
(b) MCP server libraries to consider for embedding in a Node CLI: @modelcontextprotocol/sdk for TypeScript, mcp-framework, others — pick the lightest and most stable as of 2025.
(c) Architecture pattern: does it make sense for a minih `run` invocation to: (i) start a child-process MCP server bound over stdio, (ii) inject it into the SDK session via a temporary entry in `mcpServers` config, (iii) the in-session agent calls it as a tool, (iv) the MCP server reads/writes minih's run-folder files (inbox/state) and returns results? Is anyone doing this pattern in published agent harnesses?
(d) Server-push semantics: with MCP can the *server* push notifications to the agent (e.g., 'new inbox message arrived') without the agent polling? If yes, this is a strong argument for MCP over shellouts because the future eventing plan needs this.
(e) Authentication / authorization: when an agent inside a minih session calls back to a minih-spawned MCP server, can we trust by process descent (the MCP server was spawned by THIS minih run for THIS session)? Or do we need handshake / per-session secrets?
(f) Test ergonomics: how do you mock an MCP-registered tool in tests vs how minih currently uses FakeAgentAdapter (a hand-written test double for the SDK adapter)?
(g) Failure modes if the MCP server crashes mid-session — does the SDK surface the error cleanly, does the agent get a typed tool error, or does the session hang?
(h) Migration cost: if we ship the prerequisite plan as more shellouts now and want to switch to MCP-injected later, what's the agent-prompt and testing migration?

Avoid speculation; flag what you can't source. Authoritative sources: modelcontextprotocol.io spec, @modelcontextprotocol/sdk readme, @github/copilot-sdk docs, github.com/anthropics/mcp examples. Recency: 2025+."
```

**Results location**: `docs/plans/007-backgrounding/external-research/inside-mcp-implementation.md`

### Research Opportunity 3: Best-practice patterns for a Node.js file-watching daemon that triggers subprocess work — ✅ COMPLETED 2026-04-26
> **Result**: see `external-research/file-watching-daemon-patterns.md`. **Decision overruled by chainglass evidence**: Perplexity recommended chokidar v4.2; chainglass empirical data (`~/substrate/chainglass`, Plan 060 "Replace Chokidar with Native File Watcher") shows chokidar opens 1 FD per file via kqueue on macOS → 25,341 FDs for 5,000 files → `spawn EBADF` failures. **Use native `node:fs.watch({ recursive: true })` with a custom event-normalization adapter** modeled on chainglass's `NativeFileWatcherAdapter` (~150 LOC, zero new deps). Other Perplexity advice (subprocess management, shutdown, supervision, pidfile, IPC, testing) still stands. Defer all of this to plan 008+; plan 007 just needs to avoid locking out this stack.

**Why Needed**: The future eventing plan needs a file watcher. The minih codebase has zero file-watch precedent and minimal dependencies (PS-10, DC-10). We need to choose between Node's native `fs.watch` (lightweight but inconsistent across platforms), `chokidar` (battle-tested but a new dep), and `node:fs/promises.watch` (newer async iteration). Plus debouncing strategy and tests.
**Impact on Plan**: Defers to the eventing plan, but sketches need to fit. Choosing now reduces re-architecting later.
**Source Findings**: DC-06, DC-10, DB-05, DB-06, QT-10

**Ready-to-use prompt:**
```
/deepresearch "What's the canonical 2025 pattern for a Node.js daemon (long-running process) that watches a directory tree for file changes and triggers subprocess work, with these requirements:

(a) Cross-platform (macOS, Linux, Windows) — must handle the well-known fs.watch inconsistencies on macOS (FSEvents) vs Linux (inotify) vs Windows.
(b) Debouncing — when a developer saves multiple files in rapid succession (editor autosave, formatter run), batch them into one trigger.
(c) Pattern matching — only react to files matching globs like `src/**/*.ts`, not node_modules or .git.
(d) Subprocess management — when a trigger fires, spawn work (could be running for minutes); the watcher should not block on it.
(e) Graceful shutdown on SIGTERM/SIGHUP/SIGINT — kill in-flight subprocesses, flush state, exit cleanly.
(f) Process supervision — survive crashes? Or exit and let the user/launchd/systemd restart?
(g) Testability — unit tests with fake timers and fake filesystem events.

Compare: chokidar 4.x, native node:fs.watch, native node:fs/promises.watch with AsyncIterator. Note dependency-weight tradeoffs.

Also: what's the standard pattern for storing the daemon's PID, communicating with it from the CLI ('start', 'stop', 'status' commands), and persisting its config across restarts?

Context: We have a CLI tool 'minih' (~4 deps, deliberately minimal) that runs LLM agents synchronously today. We want to add a daemon mode where the harness watches files and triggers an inside agent (e.g., a code-review agent) on each meaningful change. The daemon is opt-in.

Use authoritative sources: nodejs.org docs, chokidar README, blog posts from 2024-2025 on file-watching daemons. Recency: 2024+."
```

**Results location**: `docs/plans/007-backgrounding/external-research/file-watching-daemon-patterns.md`

### Research Opportunity 4: JSON Schema patterns for state-machine validation (allowed-transitions) — ✅ COMPLETED 2026-04-26
> **Result**: see `external-research/state-machine-jsonschema.md`. **Decision**: pattern (i) — pure TS rules in `src/runner/state.ts`. JSON Schema validates *data shape* (phase enum, data object); transition rules live in code as `isAllowedTransition(side, from, to, peerState)` called by both the inside MCP `state.transition` tool and the outside `minih state transition` CLI command. No surveyed agent harness uses JSON Schema for transition enforcement (XState, Conductor, ServiceNow, robot, machina-js all keep rules in code). AJV custom keyword approach rejected (cross-version maintenance pain, fights AJV's "fresh per call" pattern). Bonus: serialize the `TRANSITIONS` map to `state-machine.json` at build time for tooling/docs.

**Why Needed**: We need a way to express "outside can transition idle→in-progress→done; inside can transition idle→reviewing→complete BUT inside.complete requires outside.done." JSON Schema natively validates structure; transitions are a separate concern usually.
**Impact on Plan**: Determines whether transitions are encoded in JSON Schema (with custom keywords or external rule schemas) or in plain TS code in `state.ts`.
**Source Findings**: PS-01, PS-07, IC-10 (Gap 1), DB-07

**Ready-to-use prompt:**
```
/deepresearch "What are the prevailing patterns (in 2024-2025) for declaring and validating state-machine transitions in JSON Schema 2020-12, particularly when one state's allowed transitions depend on the value of a *separate* document?

Specifically:

(a) Are there standard JSON Schema vocabularies/extensions for finite state machines (allowed states, allowed transitions)? E.g., something like JSON Schema for State Machines, or a community pattern using `enum` + `if/then/else`.
(b) When two state documents are coupled (state A's transition is gated by state B's value), do people validate that with a single composed schema, with cross-document validators, or in application code?
(c) How do tools like Statelyai/XState, Stateless, or similar declarative state-machine libraries express this, and is any of it expressible in pure JSON Schema?
(d) Are there examples of CLI tools or agent harnesses that use JSON Schema to validate state transitions (vs. just data shape)?
(e) Trade-offs: schema-encoded transitions (declarative, tool-checkable, but limited expressiveness) vs application-code transitions (full expressiveness, but harder to introspect and document).

Context: We're designing a system where two agents ('outside' and 'inside') each have a JSON state file. Inside cannot transition to 'complete' until outside has transitioned to 'done'. We use AJV 2020-12 for validation today (for output schemas). We could validate transitions as: (i) plain TS rules in code, (ii) JSON Schema with custom keywords, (iii) a separate transitions-allowed.json document validated alongside.

Use authoritative sources: json-schema.org, ajv-validator.github.io, github.com/statelyai/xstate, blog posts. Recency: 2024+."
```

**Results location**: `docs/plans/007-backgrounding/external-research/state-machine-jsonschema.md`

### Research Opportunity 6: Mid-turn message injection — ✅ COMPLETED 2026-04-26 (empirical)
> **Result**: see `external-research/sdk-mid-turn-injection.md`. **Confirmed**: `session.send()` mid-turn queues cleanly (no throw, no abort). Each queued message gets its own turn with its own response. The SDK emits `pending_messages.modified` events for queue observability. **Footgun**: `sendAndWait` waits for `session.idle` which fires only after the queue fully drains — a daemon must use `session.send` + event subscription, NOT `sendAndWait`. No mid-stream merging or interruption (use `session.abort()` for cancel). Test artifacts at `scratch/midturn-test/test.mjs`.

### (Original Research Opportunity 6 framing — kept for reference)
**Why Needed**: Workshop 007 (user journey) surfaced a major UX axis: can `session.send({prompt: B})` succeed mid-stream while `sendAndWait({prompt: A})` is still waiting for `session.idle`? Local SDK source shows `session.send` is documented as async/non-blocking; behavior under concurrent calls is not documented. Perplexity declined (training cutoff before SDK existed). **Test empirically as a follow-up.** If yes, daemon plan (008+) gets server-push semantics "for free" via `session.send` from the watcher callback. If no, all coordination delivery happens at turn boundaries (this is what v1 assumes).
**Impact on Plan**: Doesn't block v1 (we assume turn-boundary delivery, which is sufficient for the user's stated journey). Strongly affects v2 daemon design.
**Source Findings**: Local source `~/github/copilot-sdk/nodejs/src/session.ts:180-191`; workshop 007 mid-turn-injection section.

**Test plan (do this in plan 008+):**
```
1. Start a session with sendAndWait({prompt: "loop slowly: count to 30, sleeping 1s between numbers, calling a tool each time"})
2. ~500ms later, call session.send({prompt: "ALSO mention the color blue at some point"})
3. Observe: does the agent's response acknowledge BOTH? Does session error? Does the message queue silently?
4. Repeat with abort() in between.
5. Document the behavior in external-research/sdk-mid-turn-injection.md
```

---

### Research Opportunity 5: How do other agent harnesses handle outside/inside command splits and inter-agent messaging? — ✅ COMPLETED 2026-04-26
> **Result**: see `external-research/agent-harness-survey.md`. **Strong validation**: Claude Code uses the same MCP-based inside-tool exposure pattern we've chosen. AutoGen validates filesystem-backed message logs. LangGraph validates state-as-coordination with checkpointed state schema. Git's `GIT_*` hook env vars validate our `MINIH_*` hidden-context pattern. **Anti-pattern confirmed**: don't build a separate "inside" CLI binary; env-var detection + MCP is the modern path. **Anti-pattern confirmed**: don't enforce state-machine rules in JSON Schema (no surveyed tool does). Specific cite-able-in-spec lines included in the file.

**Why Needed**: Sanity-check our design against precedent in Cursor, Aider, Claude Code, AutoGen, LangGraph, etc. Avoid reinventing wheels; spot anti-patterns.
**Impact on Plan**: Validates or challenges our design choices; surfaces patterns we'd miss reading code in isolation.
**Source Findings**: DE-10, External Research Gap (multiple subagents)

**Ready-to-use prompt:**
```
/deepresearch "Survey how modern LLM agent harnesses (2024-2025) handle:

(a) Distinguishing 'outside' vs 'inside' contexts — where the harness exposes different sets of commands/tools depending on whether the caller is a human at a shell vs an agent currently being executed inside a session. Patterns include: separate CLI binaries, subcommand prefixes, MCP servers, environment variable detection, etc.

(b) Inter-agent or agent-to-host messaging — how do agents communicate with their host (e.g., to announce 'phase 2 done' or to ask the host 'wait for me') and how does the host communicate back? Patterns include: filesystem inboxes, IPC sockets, MCP tool calls, shared state files, event buses.

(c) State/coordination primitives — how do harnesses model "the agent should pause until external condition X is met"? Patterns include: cooperative checkpointing, polling loops, event-driven wakes, state machines.

(d) Background/long-running agents — how do harnesses run an agent that observes file changes (or other events) and reacts continuously vs the synchronous one-shot model?

Compare specifically: Cursor (cursor.com), Aider (github.com/paul-gauthier/aider), Claude Code (github.com/anthropics/claude-code), AutoGen (microsoft.github.io/autogen), LangGraph (langchain-ai.github.io/langgraph), Codex CLI (github.com/openai/codex), goose (github.com/block/goose), and any others worth mentioning.

For each, note: their approach, why they chose it, what they got right, what they got wrong (if discoverable).

Context: We're building a CLI harness 'minih' with a deliberately minimal three-domain architecture (cli → runner → adapter). We're adding outside/inside command split, filesystem-based inboxes, and state schemas as prerequisites for a future eventing/backgrounding mode. Want to learn from prior art before we commit.

Recency: 2024-2025+. Authoritative sources: project READMEs, ADRs, design docs, recent blog posts, conference talks."
```

**Results location**: `docs/plans/007-backgrounding/external-research/agent-harness-survey.md`

---

**After External Research:**
- To conduct external research: Run the `/deepresearch` commands above, then either:
  - Paste results back to this conversation, OR
  - Save to `docs/plans/007-backgrounding/external-research/<topic-slug>.md`
- To skip and proceed: Run `/plan-1b-specify "..."` (unresolved opportunities will be noted as a soft warning).

---

## Appendix: File Inventory

### Core Files (most relevant to the new capability)
| File | Purpose | Lines |
|------|---------|-------|
| `src/cli/index.ts` | Commander program registration; preAction resolves --agents-dir | ~70 |
| `src/cli/output.ts` | MinihEnvelope, ErrorCodes (next free: E128) | 76 |
| `src/cli/commands/run.ts` | Composition root for run | 363 |
| `src/cli/commands/resume.ts` | Composition root for resume | 242 |
| `src/cli/commands/sdk-runtime.ts` | Shared SDK bootstrap | 205 |
| `src/cli/commands/check.ts` | Dual-use validator command | 168 |
| `src/cli/commands/validate.ts` | Dual-use re-validate command | 147 |
| `src/runner/runner.ts` | Core orchestration; SYSTEM_OUTPUT_INSTRUCTIONS const | ~540 |
| `src/runner/folder.ts` | Discovery, frontmatter, run folder, findRunSession | ~320 |
| `src/runner/validator.ts` | AJV validation, fuzzy property matching | ~270 |
| `src/runner/types.ts` | AgentDefinition, AgentRunConfig, CompletedMetadata | ~110 |
| `src/adapter/interface.ts` | IAgentAdapter contract | 22 |
| `src/adapter/events.ts` | AgentEvent discriminated union | ~145 |
| `src/adapter/copilot-types.ts` | Local SDK facade (ICopilotClient, ICopilotSession) | 68 |
| `src/adapter/sdk-copilot.ts` | SdkCopilotAdapter implementation | ~250 |
| `src/adapter/fake.ts` | FakeAgentAdapter for tests | 212 |
| `src/schemas/system-output.json` | System output contract | — |
| `src/schemas/retrospective.json` | Retrospective sub-schema | — |
| `agents/_shared/preamble.md` | Shared agent preamble | — |
| `src/index.ts` | Public programmatic export surface | 30 |

### Test Files
- `test/runner/{runner,session,velocity,validator,folder,...}.test.ts` (9 files, ~1500 LOC)
- `test/cli/commands.test.ts` + 1 more (~160 LOC)
- `test/adapter/fake.test.ts`
- `test/helpers/system-output.ts` (validSystemOutput builder)

### Configuration Files
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, `justfile`, `.github/workflows/ci.yml`, `scripts/copy-schemas.js`

---

## Next Steps

The research is complete. Five external research opportunities are flagged — at minimum, **Opportunity 1 (SDK session TTL)** and **Opportunity 2 (inside-channel: more shellouts vs minih-spawned MCP server)** materially affect the prerequisite design. Note for #2: minih has *zero* MCP-server code today and `minih serve --mcp` was already deferred post-V1; this opportunity is asking whether to introduce a small purpose-built MCP server *just for inside-only tools*, leveraging Plan 005's existing `mcpServers` consumption plumbing.

**Recommended path:**

1. Run `/deepresearch` for Opportunities 1 and 2 first — these directly shape whether inside agents talk via shellouts (current), MCP tool calls (better but unknown SDK support), or daemon-injected events (deferred to next plan).
2. *Optional*: also run Opportunity 3 (file-watcher patterns) to get a head start on the eventing plan, even though it's deferred.
3. Save results to `docs/plans/007-backgrounding/external-research/<slug>.md`.
4. Run `/plan-1b-specify "outside/inside command split + notes/inbox messaging + first-class outside/inside state with schemas"` to draft the prerequisite spec.
5. The follow-up plan (eventing/daemon) gets its own folder later — `008-eventing` or similar.

If you want to skip external research and go straight to spec, that's fine — `/plan-1b-specify` will note the unresolved gaps as a soft warning so they can be revisited during clarify/architect phases.

---

**Research Complete**: 2026-04-26
**Report Location**: `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/research-dossier.md`
