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
| `src/runner/display.ts` | internal | Terminal output formatting (Phase 2) |
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

## Concepts

| Concept | Definition |
|---------|-----------|
| Folder convention | An agent IS a folder. prompt.md with frontmatter = agent exists. |
| Frozen inputs | Every run copies its inputs into the run folder for reproducibility. |
| Degraded vs Failed | Invalid output = "degraded" (agent worked, schema didn't match), not hard failure. |
| Prompt assembly | preamble → instructions → output hint → params → prompt, joined by `\n\n---\n\n`. Frontmatter stripped. |
| Magic wand | Every agent output MUST include retrospective with magicWand feedback. |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Type definitions extracted with frontmatter additions. |
