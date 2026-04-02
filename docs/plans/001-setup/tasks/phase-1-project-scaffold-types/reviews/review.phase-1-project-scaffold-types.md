# Code Review: Phase 1: Project Scaffold + Types

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 1: Project Scaffold + Types
**Date**: 2026-04-02
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

Phase 1 foundation code is mostly solid, but the submitted diff includes a committed local `.chainglass` activity log and introduces three new domains without the required registry, map, or per-domain documentation.

**Key failure areas**:
- **Implementation**: `/Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl` is runtime telemetry committed with the phase and should not ship.
- **Domain compliance**: adapter, runner, and cli were added in code but not registered or documented under `/Users/jordanknight/substrate/minih/docs/domains/`.

## B) Summary

The TypeScript foundation itself is in good shape: package wiring, extracted adapter and runner types, and the FakeAgentAdapter tests all line up with the Phase 1 task dossier. Evidence quality is strong; `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md` records successful build and test runs, and a fresh `npm run build && npm test` rerun also passed during review. Anti-reinvention checks found no duplicate concepts elsewhere in the repo, and there are no project-rules artifacts to validate against. The review still requests changes because the phase diff contains a committed local telemetry artifact and the new adapter/runner/cli domains lack the required registry, map, and domain-level documentation.

## C) Checklist

**Testing Approach: Hybrid**

- [x] TDD-style contract tests exist for the core adapter fake
- [x] Lightweight validation covers package/bin/build wiring
- [x] Execution evidence records concrete build/test outcomes
- [ ] Only in-scope files changed
- [x] Linters/type checks clean (if applicable)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl:1-126 | scope/security | Local Copilot/terminal activity telemetry was committed with the phase diff. | Remove the tracked log from the phase and add a dedicated `.chainglass/` ignore rule. |
| F002 | HIGH | /Users/jordanknight/substrate/minih/docs/domains/registry.md (missing) | domain-compliance | New adapter, runner, and cli domains were introduced without registry, map, or per-domain docs. | Create `registry.md`, `domain-map.md`, and `docs/domains/{adapter,runner,cli}/domain.md` with history, composition, contracts, and concepts. |
| F003 | MEDIUM | /Users/jordanknight/substrate/minih/src/index.ts:1-30 | domain-compliance | The package root barrel was added and exported publicly, but the plan's Domain Manifest does not assign it an owner. | Add `/Users/jordanknight/substrate/minih/src/index.ts` to the Domain Manifest as the root contract surface or remove it until ownership is declared. |
| F004 | LOW | /Users/jordanknight/substrate/minih/src/cli/index.ts:3-4 | error-handling | The placeholder CLI prints "not yet implemented" but exits `0`, which looks like success to scripts. | Exit non-zero until Phase 4 replaces the placeholder with real commands. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 (HIGH)** — `/Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl:1-126`
  The phase commit includes local runtime telemetry that is unrelated to the scaffold/types deliverable. The file contains session, model, timestamp, and local process metadata and fails the "only in-scope files changed" gate.
  **Fix**: remove the tracked log from the phase and add a dedicated `.chainglass/` ignore rule.

- **F004 (LOW)** — `/Users/jordanknight/substrate/minih/src/cli/index.ts:3-4`
  The placeholder command is explicitly unfinished but still exits `0`. That is acceptable for a temporary stub during Phase 1, but it gives automation and shell scripts a false success signal.
  **Fix**: exit non-zero (or throw) until real commands land in Phase 4.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | `/Users/jordanknight/substrate/minih/src/adapter/*`, `/Users/jordanknight/substrate/minih/src/runner/*`, `/Users/jordanknight/substrate/minih/src/cli/index.ts`, and `/Users/jordanknight/substrate/minih/test/adapter/fake.test.ts` all sit under the expected domain trees from the plan's Domain Manifest. |
| Contract-only imports | ✅ | `/Users/jordanknight/substrate/minih/src/runner/types.ts` imports the adapter contract type `AgentResult` from `/Users/jordanknight/substrate/minih/src/adapter/events.ts`; no cross-domain internal imports were found. |
| Dependency direction | ✅ | The current source-level dependency flow is downward and acyclic: cli -> runner -> adapter. |
| Domain.md updated | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md`, `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md`, and `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` do not exist. |
| Registry current | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md` does not exist, so the new domains are not registered. |
| No orphan files | ❌ | `/Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl` is an unmanaged runtime artifact, and `/Users/jordanknight/substrate/minih/src/index.ts` is a public root barrel that is not assigned an owner in the plan's Domain Manifest. |
| Map nodes current | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` does not exist, so there are no registered nodes for adapter, runner, and cli. |
| Map edges current | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` does not exist, so the `cli -> runner -> adapter` edges are not documented or labeled. |
| No circular business deps | ✅ | The current import graph is acyclic; no circular dependency exists across `/Users/jordanknight/substrate/minih/src/cli`, `/Users/jordanknight/substrate/minih/src/runner`, and `/Users/jordanknight/substrate/minih/src/adapter`. |
| Concepts documented | ⚠️ | Because the per-domain docs are missing, there are no Concepts tables for contracts such as `IAgentAdapter`, `AgentEvent`, `FakeAgentAdapter`, or `AgentDefinition`. |

- **F002 (HIGH)** — `/Users/jordanknight/substrate/minih/docs/domains/registry.md` (missing), `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` (missing), `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md` (missing), `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` (missing), `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` (missing)
  The plan formally introduces three domains in Phase 1, but the repository has no registry, map, or per-domain documents to register those boundaries or describe their contracts and concepts. That leaves the new architecture undocumented and blocks downstream domain-compliance checks.
  **Fix**: add the missing registry, domain map, and per-domain docs before advancing to the next phase.

- **F003 (MEDIUM)** — `/Users/jordanknight/substrate/minih/src/index.ts:1-30`
  The top-level package barrel is exported through `/Users/jordanknight/substrate/minih/package.json`, but the plan's Domain Manifest never assigns ownership for `/Users/jordanknight/substrate/minih/src/index.ts`. That leaves the public root contract surface outside the declared domain map.
  **Fix**: add `/Users/jordanknight/substrate/minih/src/index.ts` to the Domain Manifest as the package/root contract surface with explicit ownership, or remove it until ownership is defined.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Agent event model (`/Users/jordanknight/substrate/minih/src/adapter/events.ts`) | None | N/A | Proceed |
| IAgentAdapter (`/Users/jordanknight/substrate/minih/src/adapter/interface.ts`) | None | N/A | Proceed |
| FakeAgentAdapter (`/Users/jordanknight/substrate/minih/src/adapter/fake.ts`) | None | N/A | Proceed |
| Runner type model (`/Users/jordanknight/substrate/minih/src/runner/types.ts`) | None | N/A | Proceed |
| CLI placeholder (`/Users/jordanknight/substrate/minih/src/cli/index.ts`) | None | N/A | Proceed |

No genuine duplication was found. The new files align with the extraction plan and do not reinvent existing repository functionality.

### E.4) Testing & Evidence

**Coverage confidence**: 96%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC1 | 98 | `npm run build` succeeded. `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:51-55` records zero build errors, and review reran the command successfully. |
| AC2 | 98 | `test/adapter/fake.test.ts` exists and `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:48-53` records `npm test` passing; review reran Vitest with 16/16 tests passing. |
| AC3 | 95 | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:54-55` states zero `@chainglass/*` imports in `src/`, and the review scan found no matches under `/Users/jordanknight/substrate/minih/src`. |
| AC4 | 96 | `/Users/jordanknight/substrate/minih/test/adapter/fake.test.ts:5-183` verifies `run`, `compact`, `terminate`, event emission, history, reset, session resume, stderr, and null tokens against `/Users/jordanknight/substrate/minih/src/adapter/interface.ts:13-21`. |
| AC5 | 99 | `/Users/jordanknight/substrate/minih/dist/cli/index.js:1` preserves the shebang, and `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:52-54` records the same check. |
| AC6 | 99 | `/Users/jordanknight/substrate/minih/package.json:6-8` wires the `minih` bin to `./dist/cli/index.js`, satisfying the Phase 1 `npx minih` setup requirement. |

No testing-strategy violations were found. Evidence is concrete and consistent with the phase tasks.

### E.5) Doctrine Compliance

N/A — no `/Users/jordanknight/substrate/minih/docs/project-rules/rules.md`, `/Users/jordanknight/substrate/minih/docs/project-rules/idioms.md`, `/Users/jordanknight/substrate/minih/docs/project-rules/architecture.md`, or `/Users/jordanknight/substrate/minih/docs/project-rules/constitution.md` files were present.

### E.6) Harness Live Validation

N/A — no `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` exists for this repo. Live validation was skipped.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC1 | `npm run build` succeeds with zero errors | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:51-55`; review reran `npm run build` successfully | 98 |
| AC2 | `npm test` runs and passes | `/Users/jordanknight/substrate/minih/test/adapter/fake.test.ts`; `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:48-53`; review reran `npm test` successfully | 98 |
| AC3 | All types compile with no `@chainglass/*` imports | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:54-55`; import scan of `/Users/jordanknight/substrate/minih/src` returned no matches | 95 |
| AC4 | FakeAgentAdapter implements IAgentAdapter correctly | `/Users/jordanknight/substrate/minih/src/adapter/interface.ts:13-21`; `/Users/jordanknight/substrate/minih/test/adapter/fake.test.ts:5-183` | 96 |
| AC5 | CLI placeholder build preserves the shebang | `/Users/jordanknight/substrate/minih/dist/cli/index.js:1`; `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md:52-54` | 99 |
| AC6 | Package wiring supports `npx minih` | `/Users/jordanknight/substrate/minih/package.json:6-8` | 99 |

**Overall coverage confidence**: 96%

## G) Commands Executed

```bash
git --no-pager status --short && printf '\n---UNSTAGED---\n' && git --no-pager diff --stat && printf '\n---STAGED---\n' && git --no-pager diff --staged --stat
git --no-pager log --oneline -20 -- docs/plans/001-setup/tasks/phase-1-project-scaffold-types docs/plans/001-setup/miniharness-extraction-plan.md docs/plans/001-setup/miniharness-extraction-spec.md src test package.json tsconfig.json vitest.config.ts
BASE=$(git rev-parse HEAD~1) && git --no-pager diff --name-status "$BASE"..HEAD && git --no-pager diff --stat "$BASE"..HEAD && git --no-pager diff "$BASE"..HEAD
BASE=$(git rev-parse HEAD~1) && git --no-pager diff "$BASE"..HEAD > /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/reviews/_computed.diff
git --no-pager show --name-status --format=fuller --stat HEAD | sed -n '1,220p'
npm run build && npm test
rg '@chainglass/' /Users/jordanknight/substrate/minih/src
sed -n '136,142p' .gitignore | cat -vet
git --no-pager diff "$(git rev-parse HEAD~1)"..HEAD -- .gitignore .chainglass/data/activity-log.jsonl | sed -n '1,120p'
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 1: Project Scaffold + Types
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/reviews/review.phase-1-project-scaffold-types.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl | Added | repo/local | Remove from phase diff |
| /Users/jordanknight/substrate/minih/.gitignore | Modified | repo | Add a correct `.chainglass/` ignore rule and clean up the malformed appended line |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/handover.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/research-dossier.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/execution.log.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/tasks.fltplan.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-1-project-scaffold-types/tasks.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/workshops/001-magic-wand-feedback-loop.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/workshops/002-cli-command-design.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/workshops/003-agent-folder-convention.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/workshops/004-dogfooding-and-exemplar-agents.md | Added | planning | None |
| /Users/jordanknight/substrate/minih/package-lock.json | Added | repo | None |
| /Users/jordanknight/substrate/minih/package.json | Added | repo | None |
| /Users/jordanknight/substrate/minih/src/adapter/events.ts | Added | adapter | Add matching domain docs |
| /Users/jordanknight/substrate/minih/src/adapter/fake.ts | Added | adapter | Add matching domain docs |
| /Users/jordanknight/substrate/minih/src/adapter/index.ts | Added | adapter | Add matching domain docs |
| /Users/jordanknight/substrate/minih/src/adapter/interface.ts | Added | adapter | Add matching domain docs |
| /Users/jordanknight/substrate/minih/src/cli/index.ts | Added | cli | Add matching domain docs; return non-zero while placeholder |
| /Users/jordanknight/substrate/minih/src/index.ts | Added | repo/public-api | Assign explicit owner in Domain Manifest or remove |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | Added | runner | Add matching domain docs |
| /Users/jordanknight/substrate/minih/src/runner/types.ts | Added | runner | Add matching domain docs |
| /Users/jordanknight/substrate/minih/test/adapter/fake.test.ts | Added | adapter | Add matching domain docs |
| /Users/jordanknight/substrate/minih/tsconfig.json | Added | repo | None |
| /Users/jordanknight/substrate/minih/vitest.config.ts | Added | repo | None |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl; /Users/jordanknight/substrate/minih/.gitignore | Remove the tracked runtime telemetry and add correct ignore coverage for `.chainglass/`. | The phase diff currently ships local Copilot/terminal metadata and fails the in-scope changes gate. |
| 2 | /Users/jordanknight/substrate/minih/docs/domains/registry.md; /Users/jordanknight/substrate/minih/docs/domains/domain-map.md; /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md; /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md; /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Add the missing domain registry, map, and per-domain docs for adapter, runner, and cli. | New domains were introduced in code but are not formally registered or documented. |
| 3 | /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md; /Users/jordanknight/substrate/minih/src/index.ts | Assign `/Users/jordanknight/substrate/minih/src/index.ts` an owner in the Domain Manifest or remove it. | The root public barrel is currently outside the declared domain ownership model. |
| 4 | /Users/jordanknight/substrate/minih/src/cli/index.ts | Make the temporary placeholder exit non-zero. | The current stub reports "not yet implemented" but still returns success. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/registry.md | Domain registrations for adapter, runner, and cli |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | Nodes and labeled edges for `cli -> runner -> adapter`, plus current health summary |
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | History, Composition, Contracts, and Concepts for `events.ts`, `interface.ts`, `index.ts`, and `fake.ts` |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | History, Composition, Contracts, and Concepts for `types.ts` and `index.ts` |
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | History, Composition, Contracts, and Concepts for the Phase 1 CLI placeholder |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Domain Manifest entry for `/Users/jordanknight/substrate/minih/src/index.ts` or an explicit decision to remove that barrel |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md --phase "Phase 1: Project Scaffold + Types"
