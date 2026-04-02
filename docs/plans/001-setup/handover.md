# Handover

Plan: `/Users/jordanknight/substrate/minih/docs/plans/001-setup` • Phase: Research Complete • Feature: `miniharness-extraction` • Progress: Research 100%, Spec 0% • Domain: N/A (greenfield) • Generated: 2026-04-02T01:45:00Z

## 1) Primary Intent

- Summary: Extract the declarative agent runner from Chainglass harness into a standalone NPM package called miniharness (minih)
- Quotes: "We need it to be a distinct stand alone NPM concept called miniharness"; "It solely wraps copilot-sdk"; "Agents are yolo always and can perform all actions"
- Scope: IN — agent folder convention, runner, validator, display, CLI (init/run/list/history/tail/validate), SDK adapter wrapping copilot-sdk. OUT — Docker, CDP, Playwright, health probes, domain system, Chainglass-specific preamble content.

## 2) Timeline (Most Recent First)

- Just completed: Research dossier written to `docs/plans/001-setup/research-dossier.md`
- Current focus: Handover generation for new agent session in minih repo
- Recent actions:
  - Explored full harness agent system across 2 packages (harness/src/agent/ + packages/shared/src/adapters/)
  - Read all 3 agent definitions (smoke-test, code-review, mobile-ux-audit) as reference implementations
  - Mapped SDK integration: only `@github/copilot-sdk`, dynamic import, adapter pattern
  - Identified 11 source files for extraction and proposed minih package structure

## 3) Key Technical Concepts (≤6)

- **Agent folder convention** — an agent IS a folder with `prompt.md` + optional schemas + instructions
- **SdkCopilotAdapter** — wraps `@github/copilot-sdk`, translates events to unified AgentEvent union, auto-approves all permissions
- **Prompt assembly** — preamble + instructions + output hint + params + prompt, joined by `\n\n---\n\n`
- **Run artifacts** — timestamped folders with frozen input copies, events.ndjson, completed.json, output/report.json
- **Degraded vs Failed** — invalid output = "degraded" (agent worked, schema didn't match), not hard failure
- **Dynamic SDK import** — SDK only loaded for `run` command, not list/history/validate (preserves fast CLI startup)

## 4) Code Touchpoints

Source repo: `/Users/jordanknight/substrate/074-actaul-real-agents`

- Files (source → target mapping):
  - `harness/src/agent/runner.ts` → `src/runner/runner.ts` (283 LOC, core orchestration)
  - `harness/src/agent/folder.ts` → `src/runner/folder.ts` (144 LOC, discovery + run folders)
  - `harness/src/agent/validator.ts` → `src/runner/validator.ts` (128 LOC, AJV 2020-12)
  - `harness/src/agent/display.ts` → `src/runner/display.ts` (109 LOC, terminal output)
  - `harness/src/agent/types.ts` → `src/runner/types.ts` (102 LOC, all runner types)
  - `harness/src/cli/commands/agent.ts` → `src/cli/commands/*.ts` (461 LOC, split into individual commands)
  - `packages/shared/src/adapters/sdk-copilot-adapter.ts` → `src/adapter/sdk-copilot.ts` (530 LOC)
  - `packages/shared/src/interfaces/agent-adapter.interface.ts` → `src/adapter/interface.ts` (51 LOC)
  - `packages/shared/src/interfaces/agent-types.ts` → `src/adapter/events.ts` (243 LOC)
  - `packages/shared/src/fakes/fake-agent-adapter.ts` → `src/adapter/fake.ts` (~50 LOC)
  - `harness/agents/_shared/preamble.md` → mechanism preserved, content user-supplied

- Hot (adaptation needed):
  - `runner.ts` — remove `resolveHarnessRoot()`, make agents dir configurable
  - `folder.ts` — make root resolution configurable (not hardcoded to harness/)
  - `agent.ts` CLI — replace `@chainglass/shared` imports with local inlined types
  - `sdk-copilot-adapter.ts` — remove `@chainglass/shared` interface imports, inline them

- Reference agent definitions (DON'T extract content, just study pattern):
  - `harness/agents/smoke-test/` — prompt + output-schema + instructions (no input)
  - `harness/agents/code-review/` — prompt + output-schema + instructions + input-schema
  - `harness/agents/mobile-ux-audit/` — prompt + output-schema + instructions (no input)

## 5) Decisions & ADRs

No ADRs exist yet for minih. Key decisions from research:

- DEC-SDK — Copilot SDK only (sole backend); adapter pattern enables future backends
- DEC-YOLO — Auto-approve all agent permissions, no safety gates
- DEC-NDJSON — Events streamed incrementally to NDJSON for tail -f observability
- DEC-FROZEN — Every run freezes copies of inputs for reproducibility
- DEC-DEGRADED — Schema validation failure = "degraded" not "failed" (agent did work)
- DEC-DYNAMIC-IMPORT — SDK loaded only for `run` command via dynamic import

## 6) Tasks Snapshot

No formal task IDs yet (pre-specification). Conceptual work items:

- Done: Research dossier, source file inventory, extraction surface mapping
- Pending: Feature spec (`/plan-1b-specify`), architecture plan, implementation
- Key open questions: Package name (minih vs miniharness vs @miniharness/cli), runs location (co-located vs `.minih/runs/`), config file format

## 7) Tests

- Unit: ? (no tests yet — greenfield repo)
- Integration: ? 
- Coverage: 0%
- Notes: Source repo has tests in `harness/tests/unit/agent/` to port

## 8) Risks (≤5)

- `@github/copilot-sdk` is not public NPM — may need peer dependency or bundling strategy
- SDK event types may change across versions — adapter needs version pinning or compat layer
- Preamble `{{REPO_ROOT}}` replacement assumes single repo root — may not work for all setups
- Run artifacts stored in agent folder can grow unbounded — needs cleanup/rotation strategy

## 9) Next Steps

- Immediate: Run `/plan-1b-v2-specify` in minih repo to create the feature specification
  - Research dossier: `/Users/jordanknight/substrate/minih/docs/plans/001-setup/research-dossier.md`
  - Validation: spec covers CLI commands, agent folder convention, SDK wrapping, run artifacts
  - Resume: `/plan-1b-v2-specify "Standalone miniharness (minih) NPM package that wraps copilot-sdk for declarative agent execution with folder conventions, schema validation, and CLI"`
- Then:
  - `/plan-2-v2-clarify` — resolve package name, runs location, config format
  - `/plan-3-v2-architect` — phase the implementation (types first, then runner, then CLI)
  - Consider: `minih init` scaffolding command (new, doesn't exist in source)

## 10) References

- Research dossier: `/Users/jordanknight/substrate/minih/docs/plans/001-setup/research-dossier.md`
- Source repo: `/Users/jordanknight/substrate/074-actaul-real-agents`
- Source harness agent dir: `/Users/jordanknight/substrate/074-actaul-real-agents/harness/src/agent/`
- Source SDK adapter: `/Users/jordanknight/substrate/074-actaul-real-agents/packages/shared/src/adapters/sdk-copilot-adapter.ts`
- Source agent definitions: `/Users/jordanknight/substrate/074-actaul-real-agents/harness/agents/`
- Source tests: `/Users/jordanknight/substrate/074-actaul-real-agents/harness/tests/unit/agent/`
- Minih repo: `/Users/jordanknight/substrate/minih`
