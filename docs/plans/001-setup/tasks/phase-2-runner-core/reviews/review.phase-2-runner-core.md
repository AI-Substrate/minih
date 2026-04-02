# Code Review: Phase 2: Runner Core

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 2: Runner Core
**Date**: 2026-04-02
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

Phase 2 is structurally strong, but two blocking gaps remain: `runAgent()` leaves a live timeout timer on the success path, and the retrospective schema is not actually shipped in the npm package even though the phase claims it is.

**Key failure areas**:
- **Implementation**: Successful runs can keep the process alive until `timeout` expires, and the retrospective schema is omitted from publish output.
- **Testing**: The timeout path called out in T006/T007 has no direct automated evidence, which let the timer-leak bug ship.

## B) Summary

The phase stays within the intended runner-domain scope: the new runtime files live under `src/runner/` and `src/schemas/`, imports remain `runner -> adapter`, and no concept reinvention was introduced. Discovery, validation, prompt assembly, degraded-status handling, and the end-to-end FakeAgentAdapter flow are otherwise well covered. However, direct runtime reproduction shows that `runAgent()` resolves quickly but leaves its timeout timer armed, so the Node process remains alive until the timeout elapses. Separately, `npm pack --dry-run --json` shows that `src/schemas/retrospective.json` is absent from the published package, so the phase's "schema shipped" claim is not yet true. The final domain check also found a few medium-level contract/docs gaps: runner tests import `FakeAgentAdapter` through an adapter internal path instead of the adapter contract barrel, `runner/domain.md` does not yet document the newly public runtime contracts from `src/runner/index.ts`, and the Phase 2 plan manifest omits the new integration test file.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Core validation tests present
- [ ] Critical paths covered
- [ ] Key verification points documented
- [x] Only in-scope files changed
- [x] Linters/type checks clean (if applicable)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `/Users/jordanknight/substrate/minih/src/runner/runner.ts:173-189` | correctness | `runAgent()` races `adapter.run()` against `setTimeout()` but never clears the timer, so successful runs keep the process open until the configured timeout expires. | Store the timer handle, clear it in a `finally` block, and add an explicit timeout-path test that covers `terminate()` and timeout metadata. |
| F002 | HIGH | `/Users/jordanknight/substrate/minih/package.json:52-55`; `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json:1-33` | scope | The retrospective schema exists in source but is not part of the packed npm artifact, despite the phase dossier marking it as shipped. | Copy the schema into published output (for example `dist/schemas/`) and expose a stable package path; verify with `npm pack --dry-run --json`. |
| F003 | MEDIUM | `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:1-275`; `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md:45-46` | testing | Timeout handling is listed as a required runner behavior, but there is no timeout-specific test or logged evidence for it. | Add a timeout-focused test that forces a slow adapter run, asserts `terminate(sessionId)`, and verifies `completed.json` records `timeout`. |
| F004 | MEDIUM | `/Users/jordanknight/substrate/minih/src/runner/folder.ts:108-145` | correctness | Agent discovery accepts `prompt.md` files with no required frontmatter/description, returning `AgentDefinition` values with empty descriptions despite the spec requiring frontmatter with at least `description`. | Enforce the frontmatter/description invariant during discovery or surface an explicit validation failure for invalid agent folders. |
| F005 | MEDIUM | `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:5`; `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:5` | pattern | Runner-domain tests import `FakeAgentAdapter` from the adapter internal module path instead of the adapter contract barrel. | Import `FakeAgentAdapter` from `../../src/adapter/index.js` so runner tests depend only on adapter contracts. |
| F006 | MEDIUM | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:23-31` | documentation | `runner/domain.md` still documents only type contracts and omits the public runtime API now exported from `src/runner/index.ts` and the retrospective schema contract details. | Refresh the Contracts section to include runtime exports and the schema contract. |
| F007 | LOW | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md:48-53`; `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:1-156` | scope | The new Phase 2 integration test is real and in-scope, but it is missing from the plan's Domain Manifest. | Add `test/runner/integration.test.ts` to the plan manifest as a runner/internal integration test. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 (HIGH)** — `/Users/jordanknight/substrate/minih/src/runner/runner.ts:173-189` creates the timeout branch with `setTimeout()` inside `Promise.race()`, but nothing clears that timer when `adapter.run()` resolves first. Reproduction against the built code showed `runAgent()` returning immediately while the process still stayed alive for the full timeout window (`timeout: 2` reproduced as `runAgent-process-elapsed-s=2`). On default settings this would make successful CLI runs appear hung for up to 300 seconds.
- **F002 (HIGH)** — `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json:1-33` is implemented, but `/Users/jordanknight/substrate/minih/package.json:52-55` only whitelists `dist`, `schemas`, and `LICENSE`, and there is no top-level `schemas/` directory. `tsc` does not emit JSON assets, and `npm pack --dry-run --json` confirmed that no retrospective schema file is present in the package.
- **F004 (MEDIUM)** — `/Users/jordanknight/substrate/minih/src/runner/folder.ts:108-145` reads frontmatter but never enforces it. The spec clarification at `/Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md:142-142` says frontmatter is required in `prompt.md` with at least `description`, yet `listAgents()` currently returns agents with empty `description`.

No material security or concept-duplication issues were found in the Phase 2 runtime code.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New runtime files are under `/Users/jordanknight/substrate/minih/src/runner/` and `/Users/jordanknight/substrate/minih/src/schemas/`; tests are under `/Users/jordanknight/substrate/minih/test/runner/`, matching the phase manifest. |
| Contract-only imports | ⚠️ | `src/runner/*.ts` stays on contract imports, but `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:5` and `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:5` import `FakeAgentAdapter` via `../../src/adapter/fake.js` instead of the adapter barrel. |
| Dependency direction | ✅ | The Phase 2 source continues to respect `cli -> runner -> adapter`; no upward or circular imports were introduced. |
| Domain.md updated | ⚠️ | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:11-48` reflects the new files and history, but the Contracts table still only lists type contracts and omits the newly public runtime barrel exports and schema contract details. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md:1-7` already lists `runner`, `adapter`, and `cli`; Phase 2 adds no new domains. |
| No orphan files | ⚠️ | `test/runner/integration.test.ts` is in-scope and expected, but it is not listed in the plan's Domain Manifest. |
| Map nodes current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:1-11` still lists the correct three domains. |
| Map edges current | ✅ | No new domain edges were introduced; the existing `cli -> runner -> adapter` map remains accurate for the Phase 2 diff. |
| No circular business deps | ✅ | Business-domain dependencies remain linear. |
| Concepts documented | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:33-41` documents Folder convention, Frozen inputs, Degraded vs Failed, Prompt assembly, and Magic wand concepts. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `/Users/jordanknight/substrate/minih/src/runner/folder.ts` | None | runner | proceed |
| `/Users/jordanknight/substrate/minih/src/runner/validator.ts` | None | runner | proceed |
| `/Users/jordanknight/substrate/minih/src/runner/display.ts` | None | runner | proceed |
| `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | None | runner | proceed |
| `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json` | None | runner | proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 75%

Key evidence gap: **F003 (MEDIUM)** — the timeout path described in `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/tasks.md:152-153` and logged at `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md:45-46` has no direct automated verification in `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts`.

| AC | Confidence | Evidence |
|----|------------|----------|
| AC1 | 72 | `/Users/jordanknight/substrate/minih/test/runner/folder.test.ts:118-181` covers discovery, `_shared` skipping, no-prompt skipping, and stable sorting. |
| AC2 | 38 | `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:101-155` proves end-to-end execution with `FakeAgentAdapter`, but not the real SDK/GH_TOKEN path. |
| AC3 | 92 | `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:61-118` and `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:144-150` verify prompt assembly order, separators, REPO_ROOT replacement, and frontmatter stripping. |
| AC4 | 92 | `/Users/jordanknight/substrate/minih/test/runner/folder.test.ts:201-223`, `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:241-254`, and `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:108-115` verify frozen inputs. |
| AC5 | 68 | `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:180-199` and `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:116-121` verify NDJSON output exists and contains emitted events, but not true streaming/tail behavior. |
| AC6 | 91 | `/Users/jordanknight/substrate/minih/test/runner/validator.test.ts:23-97` plus `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:219-229` cover valid/invalid schema outcomes and degraded status. |
| AC7 | 90 | `/Users/jordanknight/substrate/minih/test/runner/validator.test.ts:99-130` and `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:256-274` cover fail-fast input validation. |
| AC8 | 52 | `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json:1-33` plus `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:52-68` and `:122-127` cover retrospective shape in source/tests, but not shipping of the reusable schema asset. |
| AC9 | 89 | `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:201-217` and `/Users/jordanknight/substrate/minih/test/runner/integration.test.ts:129-143` cover completion metadata fields. |
| AC15 | 82 | Static inspection of `src/` plus `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md:34-36` shows no `@chainglass/*` imports in the Phase 2 changeset. |

### E.5) Doctrine Compliance

N/A — no `docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files were present, and no doctrine-specific failures were identified.

### E.6) Harness Live Validation

N/A — no harness configured. `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` is absent, and `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md:9-12` explicitly records: "UNAVAILABLE — No harness.md exists. Using standard `npm run build && npm test`."

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC1 | Agent folder discovery | `folder.test.ts` discovery cases | 72 |
| AC2 | Agent execution | `integration.test.ts` with `FakeAgentAdapter` | 38 |
| AC3 | Prompt assembly | `runner.test.ts` prompt-order assertions + integration prompt capture | 92 |
| AC4 | Frozen inputs | `folder.test.ts`, `runner.test.ts`, `integration.test.ts` frozen-file checks | 92 |
| AC5 | NDJSON event streaming | `runner.test.ts` and `integration.test.ts` NDJSON assertions | 68 |
| AC6 | Output validation / degraded | `validator.test.ts` + degraded-status test | 91 |
| AC7 | Input validation fail-fast | `validator.test.ts` + fail-fast runner test | 90 |
| AC8 | Magic wand / retrospective | schema source + integration output, but asset not shipped | 52 |
| AC9 | Completion metadata | `runner.test.ts` + `integration.test.ts` completed.json assertions | 89 |
| AC15 | No `@chainglass/*` imports | static source inspection | 82 |

**Overall coverage confidence**: 75%

## G) Commands Executed

```bash
git --no-pager diff --stat && printf '\n---STAGED---\n' && git --no-pager diff --staged --stat && printf '\n---STATUS---\n' && git --no-pager status --short
git --no-pager log --oneline --decorate -12 && printf '\n---FILES---\n' && git --no-pager log --oneline --follow -- docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md && printf '\n---RUNNER---\n' && git --no-pager log --oneline --follow -- src/runner/runner.ts && printf '\n---FOLDER---\n' && git --no-pager log --oneline --follow -- src/runner/folder.ts
mkdir -p /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/reviews && git --no-pager diff 6d0505c..HEAD > /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/reviews/_computed.diff && printf '%s\n' '---NAME-STATUS---' && git --no-pager diff --name-status 6d0505c..HEAD && printf '%s\n' '---STAT---' && git --no-pager diff --stat 6d0505c..HEAD
npm run build -- --pretty false
npm test
npm pack --dry-run --json
node - <<'EOF'
# Reproduced the timeout-timer leak with dist/runner/runner.js and FakeAgentAdapter:
# runAgent() resolved immediately, but the process stayed alive until the timeout elapsed.
EOF
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 2: Runner Core
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/reviews/review.phase-2-runner-core.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/runner/runner.ts | Reviewed | runner | FT-001 |
| /Users/jordanknight/substrate/minih/src/runner/folder.ts | Reviewed | runner | FT-003 |
| /Users/jordanknight/substrate/minih/src/runner/validator.ts | Reviewed | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/display.ts | Reviewed | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | Reviewed | runner contract | None |
| /Users/jordanknight/substrate/minih/src/schemas/retrospective.json | Reviewed | runner contract | FT-002 |
| /Users/jordanknight/substrate/minih/test/runner/runner.test.ts | Reviewed | runner tests | FT-001, FT-004 |
| /Users/jordanknight/substrate/minih/test/runner/folder.test.ts | Reviewed | runner tests | FT-003 |
| /Users/jordanknight/substrate/minih/test/runner/validator.test.ts | Reviewed | runner tests | None |
| /Users/jordanknight/substrate/minih/test/runner/integration.test.ts | Reviewed | runner tests | FT-004 |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Reviewed | runner docs | FT-005 |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/tasks.md | Reviewed | phase artifact | Update after fixes |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-2-runner-core/execution.log.md | Reviewed | phase artifact | Update after fixes |
| /Users/jordanknight/substrate/minih/package.json | Reviewed | root/package | FT-002 |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Reviewed | plan artifact | FT-006 |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/runner/runner.ts; /Users/jordanknight/substrate/minih/test/runner/runner.test.ts | Clear the success-path timeout timer and add explicit timeout-path assertions for `terminate(sessionId)` and `timeout` metadata. | Successful runs currently keep the process alive until the timeout expires. |
| 2 | /Users/jordanknight/substrate/minih/package.json; /Users/jordanknight/substrate/minih/src/schemas/retrospective.json | Publish the retrospective schema as part of the npm package and verify it appears in `npm pack --dry-run --json`. | The phase claims the schema is shipped, but the package currently omits it. |
| 3 | /Users/jordanknight/substrate/minih/src/runner/folder.ts; /Users/jordanknight/substrate/minih/test/runner/folder.test.ts | Enforce required prompt frontmatter/description during discovery and update tests accordingly. | Current discovery returns agents with empty descriptions, contradicting the required prompt contract. |
| 4 | /Users/jordanknight/substrate/minih/test/runner/runner.test.ts; /Users/jordanknight/substrate/minih/test/runner/integration.test.ts | Import `FakeAgentAdapter` through `../../src/adapter/index.js` instead of `../../src/adapter/fake.js`. | Runner-domain tests should depend on adapter contracts, not adapter internals. |
| 5 | /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Update the Contracts section to include the runtime runner barrel exports and the retrospective schema as public runner contracts. | The domain doc currently under-documents the public Phase 2 runner surface. |
| 6 | /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Add `test/runner/integration.test.ts` to the Domain Manifest. | The file exists and is in-scope, but the plan manifest does not track it. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Contracts table should include the public runtime runner API and retrospective schema contract details. |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Domain Manifest should include `test/runner/integration.test.ts`. |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md --phase 'Phase 2: Runner Core'
