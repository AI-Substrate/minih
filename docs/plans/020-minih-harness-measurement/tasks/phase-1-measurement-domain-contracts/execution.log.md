# Execution Log: Phase 1 - Measurement Domain Contracts

**Plan**: [minih-harness-measurement-plan.md](../../minih-harness-measurement-plan.md)
**Phase**: Phase 1: Measurement Domain Contracts
**Started**: 2026-05-10
**Companion**: `code-review-companion` run `2026-05-10T12-28-39-981Z-e685`

---

## Pre-Phase Validation

| Check | Command | Result | Evidence |
|-------|---------|--------|----------|
| Boot | `just build` | Passed | `scratch/evidence/phase1-harness-build.stdout`, `scratch/evidence/phase1-harness-build.stderr` |
| Interact | `minih doctor` and `minih list` | Passed | `scratch/evidence/phase1-harness-doctor.json`, `scratch/evidence/phase1-harness-list.json` |
| Observe | non-empty redirected CLI evidence | Passed | `test -s scratch/evidence/phase1-harness-doctor.json` and `test -s scratch/evidence/phase1-harness-list.json` |
| Baseline schema gate | `npx vitest run test/runner/schemas.test.ts` | Passed | 25 tests passed |

Companion briefing sent with message `01KR7VF8M3N2ZN6RAWD69B73BG`.

---

## Task Entries

### T001 - Refine the conceptual measurement domain docs

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Clarify measurement as conceptual, not a runtime import layer.
- Document authority/redaction posture enough for later runner/CLI contracts.
- Keep domain map and registry consistent with runner/CLI ownership boundaries.

**Changes**:
- Added a measurement authority model that separates runner-owned facts, interpretive classifications, human pulse, and downstream context.
- Added traceability levels L1-L4 with required reporting wording.
- Marked the conceptual measurement domain active in the domain registry.
- Updated the domain map to include authority/redaction and aggregate human-pulse boundaries.

**Evidence**:
- `git --no-pager diff --check` passed.
- Companion acknowledged the briefing and reported readiness; no findings for T001 at completion time.

---

## Companion Findings

| Review Request | Companion Message | Severity | Disposition | Notes |
|----------------|-------------------|----------|-------------|-------|
| T001 `e81cb02` | `01KR7VP9SGA57M4YJ5MFZFAQ1N` | MEDIUM | Fixed inline | Spec still described `docs/project-rules/harness.md` as missing; updated Harness Readiness and clarification 6 to reflect the L2 engineering harness. |
| T002 `c76d889` | `01KR7VVVS83FF6W3MX89200KSW` | HIGH | Fixed inline | Empty or very partial proof evidence was over-ranked; added empty-evidence coverage and artifact-derived support levels. |
| T003 `c76d889` | `01KR7VX31ESWVFX51G8GSZQ481` | HIGH | Fixed inline | Replaced global scorecard-validation semantics with task-kind-aware default-threshold evaluation. |
| Fix F002/F003 `d784ce1` | `01KR7WD5H1DPTBVCWRJCD1V3RP` | HIGH | Fixed inline | Product-state artifacts could over-rank research/coordination proof without required cited evidence; capped incomplete support below the task default. |

### T002 - Add proof-level contract tests first

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Add failing-first proof-level contract coverage for L0-L6 definitions, task-kind defaults, artifact requirements, lower-confidence labels, and L6 reproducibility.
- Keep tests scoped to runner measurement contracts.

**Changes**:
- Added `test/runner/measurement/proof-levels.test.ts`.

**Evidence**:
- `npx vitest run test/runner/measurement/proof-levels.test.ts` failed red because `src/runner/measurement/proof-levels.ts` does not exist yet.

### T003 - Implement proof-level contract helpers

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Add runner-owned proof-level types and helpers.
- Export contracts from the runner public barrel.
- Keep implementation pure with no CLI, MCP, or adapter imports.

**Changes**:
- Added `src/runner/measurement/types.ts`, `src/runner/measurement/proof-levels.ts`, and `src/runner/measurement/index.ts`.
- Exported proof-level contracts from `src/runner/index.ts`.

**Evidence**:
- `npx vitest run test/runner/measurement/proof-levels.test.ts` passed: 14 tests.
- First full-gate attempt caught an unused type import in `proof-levels.ts`; removed it before committing.
- Companion findings F002/F003 identified proof-level overclaim risks; fixed with artifact-derived support levels and task-kind-aware threshold helper.

### T004 - Add metric registry contract tests first

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Add registry tests that lock traceability levels, source references, caveats, scorecard categories, and safe reporting wording.
- Ensure MiniH-local metrics are mapped/aligned with frameworks rather than framework-native.

**Changes**:
- Added `test/runner/measurement/metric-registry.test.ts`.

**Evidence**:
- `npx vitest run test/runner/measurement/metric-registry.test.ts` failed red because `src/runner/measurement/metric-registry.ts` does not exist yet.

### T005 - Implement the metric registry contract

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Add stable metric IDs, categories, traceability metadata, framework mappings, source references, caveats, and reporting wording.
- Export registry helpers from runner contracts.

**Changes**:
- Added `src/runner/measurement/metric-registry.ts`.
- Extended measurement runner types and runner barrel exports with metric registry contracts.

**Evidence**:
- `npx vitest run test/runner/measurement/proof-levels.test.ts test/runner/measurement/metric-registry.test.ts` passed: 20 tests.

### Companion F002/F003 Fix - Correct proof threshold semantics

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Address companion HIGH findings before proceeding to schema work.
- Keep proof summaries honest when evidence is empty or incomplete.

**Changes**:
- Removed level-global scorecard validation from proof definitions.
- Added `meetsDefaultValidatedThreshold()` for task-kind-aware validation.
- Derived incomplete proof support from actual artifacts instead of degrading by one fixed level.
- Isolated agent-pack temp-dir cleanup tests after `just fft` surfaced global temp coupling.

**Evidence**:
- `npx vitest run test/runner/agent-pack/install.test.ts test/runner/measurement/proof-levels.test.ts` passed: 45 tests.
- `just fft` passed.
- Commit `d784ce1`; companion review-request `01KR7WC5VDR52JWN3ASHCZ84ZN`.

### T006 - Add runner-owned measurement schemas and build copy wiring

**Status**: Complete
**Started**: 2026-05-10

**Plan**:
- Add runner-owned schema contracts for measurement events, proof summaries, scorecards, pulse aggregates, and benchmark catalogues.
- Wire every new runner schema into `scripts/copy-schemas.js`.

**Changes**:
- Added `src/schemas/measurement-event.json`, `proof-summary.json`, `measurement-scorecard.json`, `pulse-aggregate.json`, and `benchmark-catalog.json`.
- Added schema-version, provenance, authority, redaction, and missing-data fields to exportable measurement records.
- Updated `scripts/copy-schemas.js` to copy the new runner-owned schemas into `dist/schemas`.
- Fixed companion F004 by capping incomplete proof support below the task default when task-specific citation/coordination evidence is missing.

**Evidence**:
- `npm run build` copied all five new schemas to `dist/schemas`.
- Manual strict AJV compile passed for the five new runner schemas.
- `npx vitest run test/runner/measurement/proof-levels.test.ts` passed: 17 tests.
