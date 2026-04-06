# Domain: runner

**Purpose**: Orchestrates agent execution from prompt assembly through artifact capture. Owns the folder convention, schema validation, display formatting, and run lifecycle.

## Boundary

**Owns**: Agent discovery, prompt assembly, run folders, frozen inputs, NDJSON event streaming, output validation, completion metadata, magic wand feedback capture, frontmatter parsing

**Excludes**: SDK communication (adapter), CLI argument parsing (cli), SDK-specific event types (adapter)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/runner/types.ts` | contract | AgentDefinition, AgentRunConfig, CompletedMetadata, AgentRunResult |
| `src/runner/folder.ts` | internal | Agent discovery, slug validation, run folder creation (Phase 2) |
| `src/runner/validator.ts` | internal | AJV 2020-12 schema validation (Phase 2) |
| `src/runner/display.ts` | internal | Verbose terminal output formatting (Phase 2) |
| `src/runner/pretty.ts` | internal | Pretty streaming display — clean output with delta accumulation (002-pretty-mode) |
| `src/runner/runner.ts` | internal | Core orchestration (Phase 2) |
| `src/runner/index.ts` | contract | Barrel export |
| `src/schemas/retrospective.json` | contract | Reusable retrospective schema fragment (Phase 2) |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `AgentDefinition` | Type | cli (discovery, listing) |
| `AgentRunConfig` | Type | cli (run configuration) |
| `AgentRunResult` | Type | cli (result display) |
| `CompletedMetadata` | Type | cli (history, validate) |
| `ValidationResult` | Type | cli (validation display) |
| `listAgents(agentsDir)` | Function | cli (list, doctor) |
| `resolveAgent(slug, agentsDir)` | Function | cli (run, validate, history) |
| `runAgent(adapter, def, config, onEvent?, agentsDir?)` | Function | cli (run command) |
| `findRunSession(slug, agentsDir, runId?)` | Function | cli (resume, connect — session lookup from completed.json) |
| `RunSession` | Type | cli (resume, connect — session lookup result) |
| `validateInput(schemaPath, params)` | Function | cli (check --input), runner (pre-execution) |
| `validateOutput(schemaPath, outputPath)` | Function | cli (validate, check), runner (post-execution) |
| `displayEvent(event)` | Function | cli (run --verbose display, tail) |
| `displayHeader(slug, runId, model?)` | Function | cli (run display) |
| `displaySummary(result)` | Function | cli (run display) |
| `PrettyDisplay` | Class | cli (run command — default display mode) |
| `parseFrontmatter(content)` | Function | cli (doctor frontmatter checks) |
| `retrospective.json` | JSON Schema | Agent output schemas (via $ref), cli (doctor checks) |

## Concepts

| Concept | Definition |
|---------|-----------|
| Folder convention | An agent IS a folder. prompt.md with frontmatter = agent exists. |
| Frozen inputs | Every run copies its inputs into the run folder for reproducibility. |
| Degraded vs Failed | Invalid output = "degraded" (agent worked, schema didn't match), not hard failure. |
| Prompt assembly | preamble → instructions → output hint → params → prompt, joined by `\n\n---\n\n`. Frontmatter stripped. |
| Magic wand | Every agent output MUST include retrospective with magicWand feedback. |
| Session resume | Resume sends follow-up message directly — skips prompt assembly and system output validation. SDK conversation history provides context. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Type definitions extracted with frontmatter additions. |
| Phase 2 | Added folder.ts (discovery + frontmatter), validator.ts (AJV), display.ts (terminal), runner.ts (orchestration), retrospective.json schema. 61 tests. |
| Phase 5 | System output enforcement: every run validates summary + retrospective. Two-stage validation (system then user). 14 MINIH_* env vars. Deleted then restored retrospective.json alongside new system-output.json. Exported SYSTEM_OUTPUT_INSTRUCTIONS. |
| 002-pretty-mode | Added pretty.ts — clean streaming display with delta accumulation, thinking suppression, inline intent. PrettyDisplay exported from barrel. |
| FX002-agent-ux | Added tool elapsed timer to pretty mode. Added fuzzy property name suggestions to validator error messages (substring + Levenshtein matching). |
| 003-resume-prompt | Added `sessionId`, `resumedFromRunId`, `promptOverride` to `AgentRunConfig`. Added `resumedFromRunId` to `CompletedMetadata`. Added `findRunSession()` helper. Resume path in `runAgent()` skips system validation and sends follow-up message directly. |
