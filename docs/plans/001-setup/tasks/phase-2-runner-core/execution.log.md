# Execution Log: Phase 2 — Runner Core

**Plan**: miniharness-extraction-plan.md
**Phase**: Phase 2: Runner Core
**Started**: 2026-04-02T14:41:00Z

---

## Pre-Phase Harness Validation

- 🔴 UNAVAILABLE — No harness.md exists. Using standard `npm run build && npm test`.

---

## Task Log

### T001: Create src/runner/folder.ts ✅
- Agent discovery, slug validation, run folder creation, frozen inputs
- Hand-rolled frontmatter parser (~15 lines) — parses from position 0 only, ignores `---` horizontal rules in body
- `path.resolve(agentsDir)` applied early for absolute path safety (DYK #5)
- **Discovery**: Empty frontmatter (`---\n---\n`) needs `indexOf('\n---\n', 3)` not `4` — the closing delimiter starts at position 3

### T002: Write folder.test.ts ✅
- 21 tests: slug validation (6), frontmatter parsing (6), agent discovery (5), resolveAgent (2), createRunFolder (1), relative path handling (1)

### T003: Create src/runner/validator.ts ✅
- Fresh AJV instance per call (DYK #2 — no caching bugs)
- Pre-validation for missing file, empty file, invalid JSON
- Extracted with minimal adaptation from source

### T004: Write validator.test.ts ✅
- 10 tests: valid output, invalid output, missing files, empty files, invalid JSON, schema errors, input validation

### T005: Create src/runner/display.ts ✅
- Terminal formatting with event icons (🔧 💭 📝 📊 ⏸ ❌)
- Changed `@chainglass/shared` import to local adapter types
- Lightweight — no tests needed per plan

### T006: Create src/runner/runner.ts ✅
- Core orchestration: prompt assembly, execution, NDJSON events, validation, completion metadata
- Preamble path configurable via agentsDir param (DYK #5)
- Frontmatter stripped from prompt before assembly (DYK #1)
- **Discovery**: `listArtifacts` runs before `completed.json` is written — so completed.json itself isn't in the artifacts list. This matches source behavior.

### T007: Write runner.test.ts ✅
- 13 tests: prompt order, frontmatter stripping, {{REPO_ROOT}} replacement, no preamble, no instructions, input params, output hint, NDJSON events, completed.json metadata, degraded status, failed status, frozen copies, input validation fail-fast

### T008: Create retrospective schema ✅
- JSON Schema 2020-12 with minLength enforcement: workedWell(10), confusing(10), magicWand(20)
- improvementSuggestions optional array

### T009: Integration test ✅
- Full end-to-end: agent with frontmatter + schema + instructions + preamble → FakeAgentAdapter with events → verified all artifacts, metadata, validation, prompt assembly
- Confirms frontmatter parsing doesn't break on `---` horizontal rules in body

### T010: Update runner barrel exports ✅
- Added runtime exports: listAgents, resolveAgent, validateSlug, createRunFolder, parseFrontmatter, runAgent, validateInput, validateOutput, displayEvent, displayHeader, displaySummary, displayPreflight, formatEvent

### T011: Verify build + all tests ✅
- `npm run build` → zero errors
- `npm test` → 61/61 tests pass (5 test files: adapter/fake + runner/folder + runner/validator + runner/runner + runner/integration)
