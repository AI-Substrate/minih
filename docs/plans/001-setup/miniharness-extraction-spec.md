# Miniharness (minih) — Standalone Declarative Agent Runner

**Mode**: Full
📚 This specification incorporates findings from research-dossier.md

## Research Context

The Chainglass harness contains a declarative agent runner across 11 source files (~2,100 LOC) in two packages (`harness/src/agent/` + `packages/shared/src/adapters/`). The runner has a clean extraction boundary with zero harness-specific infrastructure imports — it solely wraps `@github/copilot-sdk` through an adapter pattern. Three mature agent definitions (smoke-test, code-review, mobile-ux-audit) serve as reference implementations demonstrating the folder convention.

## Summary

**WHAT**: Extract the declarative agent runner from the Chainglass harness into a standalone NPM package called **minih** (miniharness). Minih lets you define AI agents as simple folders containing `prompt.md` + optional schemas + instructions, then run them against `@github/copilot-sdk` with full observability, schema validation, and self-improving feedback.

**WHY**: The agent runner is a general-purpose tool trapped inside a product-specific harness. By extracting it, anyone with access to `@github/copilot-sdk` can define, run, and observe declarative agents with audit trails — without adopting Chainglass infrastructure. The self-improving design (magic wand feedback) means agent quality compounds over time.

## Goals

- **Standalone package**: `minih` works as an independent NPM package with no dependency on `@chainglass/*`
- **Folder convention**: An agent IS a folder — `prompt.md` + optional schemas + instructions. No registration, no config files, no boilerplate.
- **Full observability**: Every run produces timestamped artifacts — frozen inputs, NDJSON event stream, structured output, completion metadata
- **Self-improving harness**: Every agent run MUST include "magic wand" feedback — what could have been better about the experience. This feedback accumulates to drive prompt refinement, tooling improvements, and convention evolution
- **Schema validation**: Input params validated before execution; output validated after. Invalid output = "degraded" (agent did work), not "failed"
- **CLI-first UX**: `minih run`, `minih list`, `minih init`, `minih history`, `minih tail` — fast, ergonomic commands for the full agent lifecycle
- **Programmatic API**: Runner, validator, and folder management exported for integration beyond the CLI
- **Fast startup**: SDK loaded dynamically only for `run` command — all other commands start instantly

## Non-Goals

- **Multi-backend support in V1**: Only `@github/copilot-sdk` is supported. The adapter pattern enables future backends, but V1 ships with copilot only
- **Safety gates or permission management**: Agents are yolo — full tool access, all permissions auto-approved. This is by design
- **Docker/CDP/Playwright integration**: Browser automation stays in Chainglass
- **Domain system**: No business-domain boundaries — minih is domain-agnostic
- **Chainglass preamble content**: The preamble mechanism is preserved, but Chainglass-specific content is not extracted
- **Health probes or container diagnostics**: Harness-only concerns
- **Session resumption across runs**: Each run is independent and stateless
- **Run artifact cleanup/rotation**: V1 stores runs indefinitely; cleanup is a future concern

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| runner | **NEW** | **create** | Core orchestration: prompt assembly, execution, event handling, artifact writing |
| adapter | **NEW** | **create** | SDK integration layer: wraps copilot-sdk, translates events, manages sessions |
| cli | **NEW** | **create** | User-facing commands: init, run, list, history, validate, tail, last-run, config |

### New Domain Sketches

#### runner [NEW]
- **Purpose**: Orchestrates agent execution from prompt assembly through artifact capture. Owns the folder convention, schema validation, display formatting, and run lifecycle.
- **Boundary Owns**: Agent discovery, prompt assembly, run folders, frozen inputs, NDJSON event streaming, output validation, completion metadata, magic wand feedback capture
- **Boundary Excludes**: SDK communication (adapter domain), CLI argument parsing (cli domain), SDK-specific event types (adapter domain)

#### adapter [NEW]
- **Purpose**: Wraps `@github/copilot-sdk` behind a clean interface (`IAgentAdapter`), translating SDK-specific events into a unified `AgentEvent` discriminated union.
- **Boundary Owns**: `IAgentAdapter` interface, `SdkCopilotAdapter` implementation, `AgentEvent` union types, `AgentResult` structure, `FakeAgentAdapter` test double, session creation/termination, permission auto-approval
- **Boundary Excludes**: Prompt assembly (runner domain), CLI concerns (cli domain), schema validation (runner domain)

#### cli [NEW]
- **Purpose**: User-facing CLI commands and composition root. Only place that directly imports `@github/copilot-sdk` (via dynamic import for the `run` command).
- **Boundary Owns**: Command definitions (init, run, list, history, validate, tail, last-run), argument parsing, JSON output envelope, SDK client instantiation (composition root), agent scaffolding (init)
- **Boundary Excludes**: Execution logic (runner domain), SDK communication (adapter domain), schema validation (runner domain)

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=0, N=1, F=0, T=1 → P=5
- **Confidence**: 0.80
- **Assumptions**:
  - Source code can be extracted with minimal adaptation (research confirms clean boundaries)
  - `@github/copilot-sdk` API is stable enough for the adapter to work without major version-specific workarounds
  - The folder convention maps 1:1 from Chainglass to minih (only root resolution changes)
- **Dependencies**:
  - `@github/copilot-sdk` — sole LLM backend, not public NPM (may need peer dependency strategy)
  - `ajv` ^8.17.1 — JSON Schema 2020-12 validation
  - `commander` ^13.1.0 — CLI framework
- **Risks**:
  - SDK is not public NPM — users must have access to install it
  - SDK event types may change across versions — adapter needs version awareness
  - `{{REPO_ROOT}}` preamble replacement assumes single repo root
- **Phases**:
  1. Types + adapter interface (foundation)
  2. Runner core (folder, validator, display, runner)
  3. SDK adapter implementation
  4. CLI commands
  5. Init scaffolding + config
  6. Testing + documentation

## Acceptance Criteria

1. **Agent folder discovery**: Given a directory containing folders with `prompt.md`, when `minih list` is run, then all valid agent slugs are displayed
2. **Agent execution**: Given a valid agent slug and `GH_TOKEN` set, when `minih run <slug>` is run, then the agent executes via copilot-sdk and produces run artifacts in a timestamped folder
3. **Prompt assembly**: Given an agent with `prompt.md`, `instructions.md`, optional preamble, and `--param` flags, when the agent runs, the full prompt is assembled as: preamble → instructions → output hint → params → prompt, joined by `\n\n---\n\n`
4. **Frozen inputs**: Given any agent run, the run folder contains exact copies of `prompt.md`, `instructions.md` (if present), and all schema files as they existed at run time
5. **NDJSON event streaming**: Given a running agent, events are appended incrementally to `events.ndjson` in the run folder, enabling `minih tail` to follow in real-time
6. **Output validation**: Given an agent with `output-schema.json`, when the agent produces output, it is validated against the schema using AJV 2020-12. If validation fails, the run status is "degraded" (not "failed")
7. **Input validation**: Given an agent with `input-schema.json` and `--param` flags, params are validated against the schema BEFORE execution begins. Invalid params cause an immediate error
8. **Magic wand feedback**: Given any agent run that completes (status: completed or degraded), the output MUST include a magic wand / retrospective section capturing what could have been better about the agent's experience. Enforced by dual mechanism: preamble teaches quality, output schema enforces existence (see Workshop 001).
9. **Completion metadata**: Given a completed run, `completed.json` contains slug, runId, timestamps, duration, session ID, result status, validation state, event count, tool call count, and artifact list
10. **CLI init scaffolding**: Given `minih init <slug>`, a new agent folder is created with a `prompt.md` template and optionally `output-schema.json` and `input-schema.json`
11. **Dynamic SDK import**: Given any CLI command other than `run`, the `@github/copilot-sdk` module is NOT loaded (preserving fast startup)
12. **Run history**: Given `minih history <slug>`, past runs are listed with timestamps, durations, and result statuses
13. **Tail following**: Given `minih tail <slug>`, the latest run's event stream is followed in real-time with formatted terminal output
14. **Dry run preview**: Given `minih run <slug> --dry-run`, the assembled prompt is displayed without executing the agent
15. **No Chainglass dependencies**: The package has zero imports from `@chainglass/*` — all needed types are inlined

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `@github/copilot-sdk` not publicly available on NPM | High | High | Declare as peer dependency; document installation separately |
| SDK event types change across versions | Medium | Medium | Version-pin adapter; adapter translates to stable internal event union |
| `{{REPO_ROOT}}` replacement is fragile | Low | Low | Make preamble template variables configurable and extensible |
| Run artifacts grow unbounded | Medium | Low | V1 accepts this; future: add `minih clean` or rotation policy |
| Magic wand feedback not always included by agent | Medium | Medium | Enforce via preamble instructions AND output schema validation |

## Open Questions

All open questions resolved — see Clarifications section below.

## Clarifications

### Session 2026-04-02

**Q1: Workflow Mode** → **Full** (CS-3, multiple phases, all gates required)

**Q2: Testing Strategy** → **Hybrid** — TDD for runner/validator logic (prompt assembly, schema validation, folder management), lightweight for CLI/display. Port existing tests from `harness/tests/unit/agent/`. Once minih is functional, dogfood it — use minih agents to test/validate minih itself. These dogfood agents double as the **exemplar reference implementations** — they ARE the documentation for how to use minih (real agents solving real problems, not throwaway hello-world examples).

**Q3: Mock Usage** → **Targeted mocks** — mock the SDK adapter using `FakeAgentAdapter` (already exists in source), use real filesystem for runner/folder tests.

**Q4: Documentation Strategy** → **README.md only** — quick-start essentials for V1.

**Q5: Domain Review** → **Confirmed** — three domains (runner, adapter, cli) with boundaries as specified.

**Q6: Package name** → **`minih`** — short, memorable, matches repo name. NPM package: `minih`, CLI binary: `minih`. Must work via `npx minih <command>` — requires `bin` entry in package.json.

**Q7: Config file** → **No config file for V1** — use CLI flags (`--agents-dir`) and environment variables (`MINIH_AGENTS_DIR`, `MINIH_MODEL`) only. Config file is a post-V1 concern.

**Resolved in workshops (not re-asked):**
- **Runs location** → Co-located inside agent folder: `agents/<slug>/runs/` (Workshop 003)
- **Magic wand enforcement** → Dual: preamble teaches quality + output schema enforces existence (Workshop 001)
- **Preamble mechanism** → Opt-in: created on first `minih init`, not overwritten after (Workshop 003)
- **Frontmatter** → Required in `prompt.md` with at least `description` field (Workshop 003, user input)
- **Agent self-validation** → `minih check <slug> --file <path>` command for mid-run validation (Workshop 002, user input)
- **Harness doctor** → `minih doctor` validates entire agents directory structure (Workshop 002, user input)
- **Consumer model** → Three classes: agent inside minih, external agents, humans/CI (Workshop 002, user input)
- **High-volume usage** → Agents run hundreds of times as part of dev loop like CI/tests; no pre-optimization needed (user input)

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Magic Wand Feedback Loop | Data Model | Core differentiator — the self-improving mechanism needs clear schema design, storage, and surfacing strategy | How is feedback structured? How does it flow back to prompt refinement? Should accumulated feedback be queryable? |
| CLI Command Design | CLI Flow | 7+ commands with flags, output formats, and composition root pattern — worth designing holistically | What's the JSON envelope shape? How do commands share the agents-dir resolution? What's the init template? |
| Agent Folder Convention | Data Model | The folder IS the API — getting the convention right is foundational | Should runs be co-located or separate? What's the minimum viable folder? How does preamble discovery work? |
