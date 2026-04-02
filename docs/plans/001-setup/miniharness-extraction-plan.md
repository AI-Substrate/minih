# Miniharness (minih) — Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-04-02
**Spec**: [miniharness-extraction-spec.md](./miniharness-extraction-spec.md)
**Status**: DRAFT
**Mode**: Full

## Summary

Extract the declarative agent runner from the Chainglass harness into a standalone NPM package called `minih`. The source code (~2,100 LOC across 11 files) has a clean extraction boundary with zero harness-specific infrastructure imports. The plan phases the work as: foundation types → runner core → SDK adapter → CLI commands → validation/init tooling → dogfood agents. The first working `npx minih run` is targeted at Phase 4 completion.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| adapter | **NEW** | create | SDK integration: wraps copilot-sdk, translates events, manages sessions |
| runner | **NEW** | create | Core orchestration: prompt assembly, execution, event handling, artifact writing |
| cli | **NEW** | create | User-facing commands: init, run, list, doctor, check, validate, history, tail, last-run |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/index.ts` | — (root) | contract | Root package public API barrel — re-exports from adapter + runner |
| `src/adapter/interface.ts` | adapter | contract | IAgentAdapter — public adapter interface |
| `src/adapter/events.ts` | adapter | contract | AgentEvent union, AgentResult, AgentRunOptions, TokenMetrics |
| `src/adapter/sdk-copilot.ts` | adapter | internal | SdkCopilotAdapter — wraps @github/copilot-sdk |
| `src/adapter/fake.ts` | adapter | internal | FakeAgentAdapter — test double |
| `src/adapter/index.ts` | adapter | contract | Barrel export |
| `src/runner/types.ts` | runner | contract | AgentDefinition, AgentRunConfig, CompletedMetadata, AgentRunResult |
| `src/runner/folder.ts` | runner | internal | Agent discovery, slug validation, run folder creation, frontmatter parsing |
| `src/runner/validator.ts` | runner | internal | AJV 2020-12 schema validation for inputs and outputs |
| `src/runner/display.ts` | runner | internal | Rich terminal output (stderr) |
| `src/runner/runner.ts` | runner | internal | Core orchestration — prompt assembly, execution, event handling, artifacts |
| `src/runner/index.ts` | runner | contract | Barrel export |
| `src/cli/index.ts` | cli | internal | CLI entry point (shebang, commander program) |
| `src/cli/output.ts` | cli | contract | MinihEnvelope — JSON output format |
| `src/cli/commands/run.ts` | cli | internal | Composition root — dynamic SDK import, adapter creation |
| `src/cli/commands/list.ts` | cli | internal | List available agents |
| `src/cli/commands/history.ts` | cli | internal | Past runs for an agent |
| `src/cli/commands/validate.ts` | cli | internal | Re-validate latest output |
| `src/cli/commands/last-run.ts` | cli | internal | Latest run info |
| `src/cli/commands/tail.ts` | cli | internal | Follow event stream |
| `src/cli/commands/doctor.ts` | cli | internal | Validate entire agents directory |
| `src/cli/commands/check.ts` | cli | internal | Validate file against schema |
| `src/cli/commands/init.ts` | cli | internal | Scaffold new agent folder |
| `src/schemas/retrospective.json` | runner | contract | Reusable retrospective schema fragment |
| `test/runner/folder.test.ts` | runner | internal | TDD — folder discovery, slug validation, frontmatter |
| `test/runner/validator.test.ts` | runner | internal | TDD — AJV input/output validation |
| `test/runner/runner.test.ts` | runner | internal | TDD — prompt assembly, event handling |
| `test/adapter/fake.test.ts` | adapter | internal | Verify FakeAgentAdapter contract |
| `test/cli/output.test.ts` | cli | internal | Envelope formatting |

## Harness Strategy

Harness: Not applicable — minih IS a CLI tool. Development validation uses `npm run build && npx minih <command>`. Once Phase 4 completes, minih dogfood agents provide the harness-equivalent validation.

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | SDK is lazy-loaded: `const { CopilotClient } = await import('@github/copilot-sdk')` with `new CopilotClient(options?)` — only in composition root | Preserve dynamic import in cli/commands/run.ts only. All other commands must NOT import SDK. |
| 02 | High | @chainglass/shared imports are 3 symbols (AgentEvent, AgentResult, IAgentAdapter) but AgentEvent expands to 10+ event subtypes via discriminated union. Adapter imports from shared barrel, not individual files | Extract full event union with all subtype shapes into adapter/events.ts. Don't just copy top-level names. |
| 03 | High | Source is ESM-only: `"type":"module"`, target ES2022, moduleResolution bundler, Node >=20.19.0, TypeScript 5.7.3, strict mode | Mirror exact config. Set engines.node >=20.19.0 in package.json. |
| 04 | High | No frontmatter parser in source — prompt.md frontmatter is a NEW feature for minih | Add gray-matter dependency or hand-roll a simple YAML frontmatter splitter. Frontmatter must be stripped before prompt assembly. |
| 05 | High | output.ts uses zod for envelope validation — only dependency on zod in the entire extraction surface | Drop zod. Use handwritten type + JSON.stringify for envelope. Keeps dependency count low. |
| 06 | High | Vitest is the test runner. Pattern: `*.test.ts` in `test/` directory mirroring `src/` structure | Set up vitest from Phase 1. TDD for runner/validator, lightweight for CLI. |
| 07 | High | Test double exists: FakeAgentAdapter in source. Runner accepts IAgentAdapter — natural injection point | Extract FakeAgentAdapter into adapter/fake.ts. All runner tests use it instead of real SDK. |

## Phases

### Phase Index

| Phase | Title | Primary Domain | CS | Objective | Depends On |
|-------|-------|---------------|:--:|-----------|------------|
| 1 | Project Scaffold + Types | adapter, runner | 2 | Package foundation, all type definitions, build pipeline | None |
| 2 | Runner Core | runner | 3 | Agent discovery, validation, prompt assembly, execution orchestration | Phase 1 |
| 3 | SDK Adapter | adapter | 2 | Extract SdkCopilotAdapter with event translation and session management | Phase 1 |
| 4 | CLI + First Run | cli | 3 | All CLI commands, composition root, first working `npx minih run` | Phase 2, 3 |
| 5 | Doctor, Check, Init | cli, runner | 2 | Structural validation, mid-run checking, agent scaffolding | Phase 4 |
| 6 | Dogfood + README | all | 2 | Dogfood agents in repo, sample agent, README documentation | Phase 5 |

---

### Phase 1: Project Scaffold + Types

**Objective**: Set up the package foundation — build pipeline, all type definitions, and adapter interfaces so subsequent phases have types to import.
**Domain**: adapter (types + interface), runner (types)
**CS**: 2 (small)
**Delivers**:
- `package.json` with bin entry, ESM config, dependencies, scripts
- `tsconfig.json` matching source config (ES2022, ESNext, bundler, strict)
- Vitest configuration
- All type definitions from runner and adapter domains
- IAgentAdapter interface
- AgentEvent discriminated union (full 10+ event types)
- FakeAgentAdapter test double
- Build succeeds: `npm run build` produces `dist/`
**Depends on**: None
**Key risks**: None — pure scaffolding.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Create package.json | — | `"type":"module"`, `"bin":{"minih":"./dist/cli/index.js"}`, engines node >=20.19.0, dependencies (ajv ^8.17.1, commander ^13.1.0), peerDependencies (@github/copilot-sdk ^0.1.32), devDependencies (typescript ^5.7.3, vitest) | Per finding 03. npx must work. |
| 1.2 | Create tsconfig.json | — | target ES2022, module ESNext, moduleResolution bundler, strict true, outDir dist, declaration true, resolveJsonModule true | Per finding 03 |
| 1.3 | Create vitest.config.ts | — | Vitest runs with `npm test`, resolves .ts files | Per finding 06 |
| 1.4 | Create src/adapter/events.ts | adapter | Full AgentEvent discriminated union with all 10+ event subtypes, AgentResult, AgentRunOptions, TokenMetrics — extracted from packages/shared/src/interfaces/agent-types.ts | Per finding 02 — expand full union |
| 1.5 | Create src/adapter/interface.ts | adapter | IAgentAdapter interface with run(), compact(), terminate() — extracted from packages/shared/src/interfaces/agent-adapter.interface.ts | |
| 1.6 | Create src/adapter/fake.ts | adapter | FakeAgentAdapter implements IAgentAdapter, configurable responses for tests | Per finding 07 |
| 1.7 | Create src/runner/types.ts | runner | AgentDefinition (with description, tags fields), AgentRunConfig, CompletedMetadata, AgentRunResult, ValidationResult, RunEventStats — adapted from harness/src/agent/types.ts | AgentDefinition adds description + tags for frontmatter |
| 1.8 | Create barrel exports | adapter, runner | src/adapter/index.ts and src/runner/index.ts export all public types | |
| 1.9 | Verify build | — | `npm run build` succeeds, `dist/` contains .js + .d.ts files | |
| 1.10 | Write FakeAgentAdapter test | adapter | `test/adapter/fake.test.ts` — verify fake implements interface, emits events, returns results | First test passes with `npm test` |

### Acceptance Criteria
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm test` runs and passes
- [ ] All types compile with no @chainglass/* imports
- [ ] FakeAgentAdapter implements IAgentAdapter correctly

---

### Phase 2: Runner Core

**Objective**: Extract and adapt the runner logic — agent discovery, schema validation, terminal display, prompt assembly, and execution orchestration. All tested with FakeAgentAdapter.
**Domain**: runner
**CS**: 3 (medium)
**Delivers**:
- folder.ts — agent discovery, slug validation, run folder creation, frozen inputs, frontmatter parsing
- validator.ts — AJV 2020-12 input/output validation
- display.ts — terminal formatting for events and summaries
- runner.ts — prompt assembly, execution, event streaming, artifact writing
- TDD tests for folder, validator, prompt assembly
- Runner executes end-to-end with FakeAgentAdapter
**Depends on**: Phase 1
**Key risks**: Frontmatter parsing is new code (not extraction). Need gray-matter or hand-rolled parser.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Create src/runner/folder.ts | runner | validateSlug(), listAgents(), resolveAgent(), createRunFolder() — adapted from harness folder.ts. Root resolution configurable (not hardcoded). Agents dir passed as param or resolved from cwd. Frontmatter parsed from prompt.md for description/tags. | Per finding 04 — add frontmatter parsing. Add gray-matter dep or hand-roll. |
| 2.2 | Write folder.test.ts (TDD) | runner | Tests: slug validation (valid, invalid, traversal), agent discovery (finds prompt.md, skips _shared, skips invalid), run folder creation (timestamp format, frozen copies), frontmatter extraction | TDD — write tests first |
| 2.3 | Create src/runner/validator.ts | runner | validateInput(), validateOutput() — extracted from harness validator.ts. AJV 2020-12, allErrors, pre-validation (missing file, empty, invalid JSON) | Copy as-is, minimal adaptation |
| 2.4 | Write validator.test.ts (TDD) | runner | Tests: valid output passes, invalid output returns errors, missing file handled, empty file handled, input validation with required fields, schema compilation errors caught | TDD — write tests first |
| 2.5 | Create src/runner/display.ts | runner | displayHeader(), displayPreflight(), displayEvent(), displaySummary() — extracted from harness display.ts. Replace @chainglass/shared imports with local adapter types | Minimal adaptation — change import paths |
| 2.6 | Create src/runner/runner.ts | runner | runAgent() — extracted from harness runner.ts. Preamble path configurable (not hardcoded). Frontmatter stripped from prompt before assembly. Template variable replacement ({{REPO_ROOT}}). | Core orchestration — most adaptation needed |
| 2.7 | Write runner.test.ts (TDD) | runner | Tests: prompt assembly order (preamble → instructions → hint → params → prompt), frontmatter stripping, {{REPO_ROOT}} replacement, event counting, NDJSON writing, degraded vs completed vs failed status | TDD — test prompt assembly thoroughly |
| 2.8 | Create retrospective schema | runner | src/schemas/retrospective.json — reusable JSON Schema fragment with minLength enforcement | Per Workshop 001 |
| 2.9 | Integration test | runner | Runner executes with FakeAgentAdapter, produces run folder with events.ndjson, completed.json, output/report.json, frozen inputs | End-to-end runner test |

### Acceptance Criteria
- [ ] Agent discovery finds folders with prompt.md, skips _shared
- [ ] Frontmatter parsed from prompt.md, stripped before prompt assembly
- [ ] Prompt assembly: preamble → instructions → output hint → params → prompt, joined by `\n\n---\n\n`
- [ ] Run folder created with frozen copies of all agent files
- [ ] Events written incrementally to NDJSON
- [ ] Invalid output → status "degraded" (not "failed")
- [ ] Input validation fails fast before execution

---

### Phase 3: SDK Adapter

**Objective**: Extract SdkCopilotAdapter with full event translation, session management, and permission auto-approval. Inline all @chainglass/shared imports.
**Domain**: adapter
**CS**: 2 (small)
**Delivers**:
- SdkCopilotAdapter — wraps @github/copilot-sdk, translates events, auto-approves permissions
- All @chainglass/shared imports replaced with local types from Phase 1
- Duplicate event suppression logic preserved
- Prompt validation (length, control chars, empty check)
**Depends on**: Phase 1
**Key risks**: SDK may have version-specific API differences. Adapter must handle gracefully.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Create src/adapter/sdk-copilot.ts | adapter | SdkCopilotAdapter extracted from packages/shared/src/adapters/sdk-copilot-adapter.ts. All imports from @chainglass/shared replaced with local ./events.ts and ./interface.ts. Auto-approves all permissions. | Per finding 02 — inline full event types |
| 3.2 | Verify compilation | adapter | `npm run build` succeeds. SdkCopilotAdapter references only local types + @github/copilot-sdk (peer dep) | No @chainglass/* imports anywhere |
| 3.3 | Update barrel export | adapter | src/adapter/index.ts exports SdkCopilotAdapter | |

### Acceptance Criteria
- [ ] SdkCopilotAdapter compiles with zero @chainglass imports
- [ ] Event translation covers all 10+ event types
- [ ] Permission auto-approval implemented
- [ ] Build succeeds

---

### Phase 4: CLI + First Run

**Objective**: Build all CLI commands with the composition root pattern. First working `npx minih run <slug>` — the dogfood moment.
**Domain**: cli
**CS**: 3 (medium)
**Delivers**:
- CLI entry point with shebang, commander program
- Output envelope (MinihEnvelope — no zod, handwritten)
- Commands: run, list, history, validate, last-run, tail
- Composition root in run.ts (dynamic SDK import)
- `npx minih run hello-world` works end-to-end
**Depends on**: Phase 2 (runner), Phase 3 (adapter)
**Key risks**: Dynamic import of @github/copilot-sdk must work in npx context. GH_TOKEN must be available.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 4.1 | Create src/cli/output.ts | cli | MinihEnvelope type, formatSuccess(), formatError(), printEnvelope(), exitWithEnvelope(). Error codes E100-E125. No zod — handwritten types. | Per finding 05 — drop zod |
| 4.2 | Write output.test.ts | cli | Tests: formatSuccess shape, formatError shape, exit code 0 for ok/degraded, exit code 1 for error | Lightweight tests |
| 4.3 | Create src/cli/commands/list.ts | cli | `minih list` — discovers agents, shows slug + description (from frontmatter) + required params (from input-schema). JSON envelope output. | First command to implement — no SDK needed |
| 4.4 | Create src/cli/commands/run.ts | cli | `minih run <slug>` — composition root. Dynamic SDK import. Creates CopilotClient + SdkCopilotAdapter. Passes to runAgent(). Flags: --model, --reasoning, --timeout, --param. | Per finding 01 — dynamic import pattern |
| 4.5 | Create src/cli/commands/history.ts | cli | `minih history <slug>` — reads completed.json from run folders, displays list | |
| 4.6 | Create src/cli/commands/validate.ts | cli | `minih validate <slug>` — re-validates latest output against current schema, updates completed.json | |
| 4.7 | Create src/cli/commands/last-run.ts | cli | `minih last-run <slug>` — latest run dir + report path | |
| 4.8 | Create src/cli/commands/tail.ts | cli | `minih tail <slug>` — polls events.ndjson, displays events, exits on completed.json | |
| 4.9 | Create src/cli/index.ts | cli | CLI entry point: `#!/usr/bin/env node`, commander program, registers all commands, --version, --help | Shebang required for npx |
| 4.10 | Create hello-world agent | — | agents/hello-world/prompt.md with frontmatter — minimum viable agent for testing | First agent in repo |
| 4.11 | End-to-end test | cli | `npx minih list` shows hello-world. `npx minih run hello-world` executes and produces run artifacts (requires GH_TOKEN). | 🎉 FIRST DOGFOOD MOMENT |

### Acceptance Criteria
- [ ] `npx minih list` shows agents with descriptions
- [ ] `npx minih run <slug>` executes agent and produces run artifacts
- [ ] `npx minih history <slug>` shows past runs
- [ ] `npx minih tail <slug>` follows event stream
- [ ] Dynamic SDK import — non-run commands don't load @github/copilot-sdk
- [ ] JSON envelope on stdout, human formatting on stderr (TTY-detected)
- [ ] Exit 0 for ok/degraded, exit 1 for error

---

### Phase 5: Doctor, Check, Init

**Objective**: Complete the validation and scaffolding tooling — structural validation of the entire agents directory, mid-run output checking, and agent scaffolding with templates.
**Domain**: cli, runner
**CS**: 2 (small)
**Delivers**:
- `minih doctor` — validates all agents' structure, frontmatter, schemas
- `minih check <slug> --file <path>` — validates file against agent's schema (usable mid-run)
- `minih init <slug>` — scaffolds new agent folder with templates
- `--dry-run` flag on run command
- Preamble template created on first init
- Retrospective included in scaffolded output-schema.json
**Depends on**: Phase 4
**Key risks**: None — all building blocks exist from prior phases.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 5.1 | Create src/cli/commands/doctor.ts | cli | `minih doctor` — scans agents dir, checks each agent for prompt.md, frontmatter, schema compilation, retrospective in output schema. Checks _shared/preamble.md. JSON envelope with per-agent results. --strict flag. | Per Workshop 002 |
| 5.2 | Create src/cli/commands/check.ts | cli | `minih check <slug> --file <path>` — validates file against output-schema.json (or input-schema.json with --input). Usable by agent mid-run. | Enables agent self-validation |
| 5.3 | Create src/cli/commands/init.ts | cli | `minih init <slug>` — creates agent folder with prompt.md (with frontmatter template), output-schema.json (with retrospective required), instructions.md. Flags: --with-input, --no-output, --no-instructions. | Per Workshop 002 |
| 5.4 | Add --dry-run to run command | cli | `minih run <slug> --dry-run` — assembles and displays prompt without executing. Shows parts, total length, stats. | Per Workshop 002 |
| 5.5 | Create preamble template | runner | On first `minih init`, if `_shared/preamble.md` doesn't exist, create it with feedback loop section from Workshop 001. Don't overwrite existing. | Per Workshop 003 |
| 5.6 | Write doctor test | cli | Tests: detects missing frontmatter, detects schema compilation errors, --strict treats warnings as errors | Lightweight tests |

### Acceptance Criteria
- [ ] `minih doctor` validates all agents and reports per-agent check results
- [ ] `minih check <slug> --file <path>` validates file against schema
- [ ] `minih init <slug>` creates agent folder with correct templates
- [ ] Scaffolded output-schema.json includes retrospective as required
- [ ] `--dry-run` shows assembled prompt without executing
- [ ] Preamble template created on first init

---

### Phase 6: Dogfood + README

**Objective**: Create the dogfood agents that test and document minih. Write README. Run the full feedback loop at least once. Dogfood agents live in this repo only — npm package ships one sample agent at most.
**Domain**: all
**CS**: 2 (small)
**Delivers**:
- 6 dogfood agents in repo's agents/ directory (not shipped in npm package)
- README.md with quick-start, CLI reference, example progression
- .npmignore to exclude dogfood agents from package
- At least one feedback loop cycle completed (run agents → read magic wands → act on feedback)
**Depends on**: Phase 5
**Key risks**: Dogfood agents require GH_TOKEN and SDK access. May need to iterate on prompts.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 6.1 | Create convention-check agent | — | agents/convention-check/ with output-schema, instructions — exercises doctor command from inside | Per Workshop 004 |
| 6.2 | Create prompt-review agent | — | agents/prompt-review/ with input-schema (agent_slug param) — exercises input validation and cross-agent reads | Per Workshop 004 |
| 6.3 | Create smoke-test agent | — | agents/smoke-test/ — exercises full CLI lifecycle (init → run → check → history → validate) | Per Workshop 004 |
| 6.4 | Create feedback-digest agent | — | agents/feedback-digest/ — aggregates magic wand feedback across all agents | Per Workshop 004 |
| 6.5 | Create self-review agent | — | agents/self-review/ with input-schema (file_path) — production-grade code review agent | Per Workshop 004 |
| 6.6 | Write README.md | — | Quick-start (install, create agent, run), CLI reference, link to dogfood agents as examples | README only — per clarification Q4 |
| 6.7 | Configure .npmignore | — | Exclude agents/ (except one sample), docs/plans/, test/ from npm package | Dogfood agents not shipped |
| 6.8 | Run feedback loop | — | Run all 6 dogfood agents, read magic wand feedback, act on at least one item, run again | Proves the self-improving loop works |
| 6.9 | Update preamble evidence table | — | Add at least one real entry to the evidence table showing feedback that was acted on | Closes the loop |

### Acceptance Criteria
- [ ] All 6 dogfood agents run successfully (completed or degraded)
- [ ] README.md covers install, quick-start, CLI reference
- [ ] npm package excludes dogfood agents
- [ ] At least one magic wand wish has been acted on (one feedback cycle completed)
- [ ] Preamble evidence table has real entries

---

## Overall Acceptance Criteria

From spec — all must pass:

- [ ] AC1: Agent folder discovery — `minih list` shows agents with descriptions
- [ ] AC2: Agent execution — `minih run <slug>` produces run artifacts
- [ ] AC3: Prompt assembly — preamble → instructions → hint → params → prompt, joined by `\n\n---\n\n`
- [ ] AC4: Frozen inputs — run folder contains exact copies at run time
- [ ] AC5: NDJSON event streaming — incremental append, `minih tail` follows
- [ ] AC6: Output validation — AJV 2020-12, invalid = "degraded"
- [ ] AC7: Input validation — fail fast before execution
- [ ] AC8: Magic wand feedback — enforced by preamble + schema
- [ ] AC9: Completion metadata — completed.json with all fields
- [ ] AC10: CLI init scaffolding — `minih init` creates folder with templates
- [ ] AC11: Dynamic SDK import — non-run commands don't load SDK
- [ ] AC12: Run history — `minih history` shows past runs
- [ ] AC13: Tail following — `minih tail` follows event stream
- [ ] AC14: Dry run — `minih run --dry-run` previews prompt
- [ ] AC15: No Chainglass deps — zero @chainglass/* imports
- [ ] AC16: npx works — `npx minih <command>` functions correctly
- [ ] AC17: Doctor — `minih doctor` validates agents directory
- [ ] AC18: Check — `minih check` validates files against schemas mid-run
- [ ] AC19: Frontmatter — prompt.md requires YAML frontmatter with description

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| @github/copilot-sdk not available to install | High | High | Declare as peerDependency; document installation separately |
| SDK event types change across versions | Medium | Medium | Adapter translates to stable internal AgentEvent union |
| Frontmatter parsing edge cases | Low | Low | Use established library (gray-matter) or simple regex splitter |
| Run artifacts grow unbounded | Medium | Low | V1 accepts this; document gitignore pattern |
| Dynamic import fails in npx context | Low | Medium | Test early in Phase 4; ensure ESM module resolution works |
