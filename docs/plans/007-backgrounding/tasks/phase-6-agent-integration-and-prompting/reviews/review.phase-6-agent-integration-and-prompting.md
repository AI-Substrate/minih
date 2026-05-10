# Code Review: Phase 6 — Agent Integration & Prompting

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md
**Phase**: Phase 6: Agent Integration & Prompting
**Date**: 2026-04-26
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**APPROVE**

**Original finding areas**:
- **Implementation**: `run --dry-run` still previews the pre-Phase-6 prompt assembly instead of the real coordinated prompt.
- **Testing**: Phase 6 runtime evidence is strong overall, but T010's execution-log proof for the smoke agent is still indirect.

## B) Summary

The core Phase 6 runtime work is in place: coordinated prompt sections are injected by `buildInsidePreamble()`, runtime env vars are set and cleaned up, schema widening is wired through the runner and published schemas, `doctor` enforces `outside.md` drift/size checks, and run-folder coordination snapshots are written deterministically. Domain boundaries remain clean (`cli -> {mcp, runner, adapter}`, `mcp -> runner`), and the current branch passes the full repository quality gate. I found two implementation integration gaps and one evidence gap: fresh `init`/`quickstart` scaffolds still write an older `_shared/preamble.md`, `run --dry-run` bypasses the coordinated prompt builder, and the Phase 6 log's T010 entry still does not contain direct proof of the promised `MINIH_E2E=1 minih run coordination-smoke-test` pass. None of these issues undermine the shipped runtime path enough to block approval, but they should be tightened before similar prompt/coordination work lands again.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Focused validation tests present
- [x] Build / typecheck / test / audit evidence present
- [x] Dry-run prompt preview matches the real coordinated prompt assembly
- [x] Fresh `_shared/preamble.md` scaffolds match the Phase 6 canonical preamble
- [x] Smoke-agent evidence claim narrowed to static/doctor validation; real SDK smoke execution is no longer claimed for Phase 6
- [x] Domain compliance checks pass

## C.1) Post-review Resolution

| Finding | Resolution | Evidence |
|---------|------------|----------|
| F001 | `ensurePreamble()` now writes the copied canonical template asset from `src/templates/shared-preamble.md`; tests compare scaffold output with the source template and dogfood copy. | `src/cli/commands/init.ts`, `scripts/copy-schemas.js`, `test/cli/commands.test.ts` |
| F002 | `run --dry-run` now calls `buildInsidePreamble()` and includes the assembled prompt in the JSON envelope, so coordinated previews include identity, tools, peer contract, and checklist sections. | `src/cli/commands/run.ts`, `test/cli/init-coordinated.test.ts` |
| F003 | Phase 6 docs now claim the smoke agent's four-file/static `doctor` validation only; the fake-adapter opt-in e2e remains the full-loop proof. | `tasks.md`, `tasks.fltplan.md`, `execution.log.md` |

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts:157-195` | pattern | `ensurePreamble()` still writes an older hard-coded `_shared/preamble.md`, so fresh `init`/`quickstart` scaffolds miss the Phase 6 env-var and retrospective guidance now present in the canonical shared preamble. | Stop hard-coding a second preamble template; source scaffolded `_shared/preamble.md` from the canonical shared preamble asset or a single shared template module. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:210-248` | correctness | `run --dry-run` still assembles the old prompt preview manually, so coordinated agents do not show the injected identity block, MCP tool guidance, peer contract, or pre-completion checklist that real runs now receive. | Route dry-run through `buildInsidePreamble()` (or a shared prompt-assembly helper) so previewed prompts match actual execution for coordinated agents. |
| F003 | MEDIUM | `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-6-agent-integration-and-prompting/execution.log.md:57-65`; `/Users/jordanknight/substrate/minih/test/e2e/two-agent-coordination.test.ts:39-133` | testing | T010 claims a `MINIH_E2E=1 minih run coordination-smoke-test` pass, but the logged evidence is still indirect: T010 records file presence plus `doctor` health, while T011's opt-in e2e uses a fake adapter and synthesizes the inside report/state rather than exercising the smoke agent through a real `minih run` path. | Add the exact smoke-agent run command/output as Phase 6 evidence, or explicitly narrow the claim to file/forwarder/report plumbing until a dogfood `minih run coordination-smoke-test` check exists. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001**: The new coordinated scaffold still depends on a stale `_shared/preamble.md` generator. Existing in-repo agents get the updated canonical preamble, but brand-new agent directories created by `init` or `quickstart` do not. That is the main Phase 6 scaffold drift.
- **F002**: Real coordinated runs use `buildInsidePreamble()`, but `run --dry-run` still performs its own manual assembly. Prompt authors inspecting a coordinated agent will therefore debug the wrong prompt.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New CLI files live under `src/cli/`; runner prompt/schema work lives under `src/runner/` and `src/schemas/`; dogfood agent data lives under `agents/`. |
| Contract-only imports | ✅ | The reviewed Phase 6 files consume runner/mcp/adapter contracts through existing public exports; no cross-domain internal import violation surfaced. |
| Dependency direction | ✅ | Import direction stays `cli -> {mcp, runner, adapter}`, `mcp -> runner`, `runner -> adapter`. |
| Domain.md updated | ✅ | `docs/domains/cli/domain.md` and `docs/domains/runner/domain.md` describe the landed Phase 6 contracts accurately enough for the touched code. |
| Registry current | ✅ | `docs/domains/registry.md` still reflects the four active domains. |
| No orphan files | ✅ | Reviewed changed files map cleanly to `cli`, `runner`, `mcp`, or agent-data/doc artifacts in the plan manifest. |
| Map nodes current | ✅ | `docs/domains/domain-map.md` still reflects the current four-domain topology. |
| Map edges current | ✅ | Domain-map edges remain labeled and consistent with the code. |
| No circular business deps | ✅ | No new cycles were introduced. |
| Concepts documented | ✅ | `cli`, `runner`, and `mcp` docs include Concepts sections that cover the touched contracts. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Coordinated prompt sections | Existing `buildInsidePreamble()` path | runner | ✅ extend |
| `init --coordinated` scaffold | Existing `init.ts` scaffold path | cli | ✅ extend |
| `doctor` outside.md drift/size checks | Existing `doctor.ts` per-agent checks | cli | ✅ extend |
| Run-folder inbox/state snapshots | Existing runner finalization + folder/state helpers | runner | ✅ extend |
| Coordination smoke-test agent | No prior coordination dogfood agent | runner-data | ✅ proceed |

No meaningful duplication concerns surfaced.

### E.4) Testing & Evidence

**Coverage confidence**: **84%**

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-PROMPT-INSIDE-IDENTITY | 97% | `test/runner/preamble-builder.test.ts` rerun via `just fft`; snapshot covers slug/runId/outside-peer wording and non-coordinated byte-equivalence. |
| AC-PROMPT-PEER-CONTRACT | 97% | Same preamble-builder suite asserts `## Peer's Contract (from outside.md)` blockquote injection and absence when no contract exists. |
| AC-MAGIC-WAND-COORDINATION | 94% | `test/runner/schema-compat.test.ts`, `test/runner/validator.test.ts`, and `test/cli/commands.test.ts` cover bundled schemas and `minih check`. |
| AC-RETRO-COORDINATION-OPTIONAL | 94% | Schema-compat and validator tests cover present/absent coordination retrospective data. |
| AC-ENV-VARS | 72% | Runtime env-var set/cleanup is well covered by `test/runner/runner.test.ts` and `test/runner/context.test.ts`, but fresh scaffolded preambles still miss the Phase 6 guidance (F001). |
| AC-INIT-COORDINATED-OUTSIDE-MD | 96% | `test/cli/init-coordinated.test.ts` proves `outside.md` and coordinated frontmatter are scaffolded. |
| AC-INIT-COORDINATED-STATE-SCHEMAS | 96% | Same suite verifies `inside-state.schema.json` and `outside-state.schema.json` contents. |
| AC-DOCTOR-OUTSIDE-MD-DRIFT | 94% | `test/cli/doctor-outside-md.test.ts` covers stale-contract warnings and symlink containment failure. |
| AC-DOCTOR-OUTSIDE-MD-SIZE | 94% | Same suite covers warning at >4KB and failure at >8KB. |
| AC-RUN-FOLDER | 95% | `test/runner/run-folder-snapshot.test.ts` covers empty snapshots, byte-preserving inbox snapshots, deterministic artifact ordering, and corrupt-state finalization failure. |

**Evidence gap**: F003 lowers confidence because the smoke-agent runtime proof recorded in `execution.log.md` is weaker than the claim it makes.

### E.5) Doctrine Compliance

N/A — `docs/project-rules/` is absent in this repository, and no repo-level convention breach beyond the findings above stood out.

### E.6) Harness Live Validation

N/A — no `docs/project-rules/harness.md` is configured for this repo.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-PROMPT-INSIDE-IDENTITY | Coordinated inside prompt gets identity block | `test/runner/preamble-builder.test.ts` | 97% |
| AC-PROMPT-PEER-CONTRACT | Coordinated inside prompt injects `outside.md` | `test/runner/preamble-builder.test.ts` | 97% |
| AC-MAGIC-WAND-COORDINATION | `magicWandTarget` accepts `coordination` | `test/runner/schema-compat.test.ts`, `test/runner/validator.test.ts`, `test/cli/commands.test.ts` | 94% |
| AC-RETRO-COORDINATION-OPTIONAL | Optional coordination retro block validates | `test/runner/schema-compat.test.ts`, `test/runner/validator.test.ts` | 94% |
| AC-ENV-VARS | Coordinated env vars exist and are documented | `test/runner/runner.test.ts`, `test/runner/context.test.ts`, `agents/_shared/preamble.md` (with scaffold drift caveat from F001) | 72% |
| AC-INIT-COORDINATED-OUTSIDE-MD | `init --coordinated` writes `outside.md` | `test/cli/init-coordinated.test.ts` | 96% |
| AC-INIT-COORDINATED-STATE-SCHEMAS | `init --coordinated` writes per-agent state schemas | `test/cli/init-coordinated.test.ts` | 96% |
| AC-DOCTOR-OUTSIDE-MD-DRIFT | `doctor` warns on stale `outside.md` | `test/cli/doctor-outside-md.test.ts` | 94% |
| AC-DOCTOR-OUTSIDE-MD-SIZE | `doctor` warns/fails on large `outside.md` | `test/cli/doctor-outside-md.test.ts` | 94% |
| AC-RUN-FOLDER | Completed run folders snapshot inbox/state | `test/runner/run-folder-snapshot.test.ts`, `test/runner/runner-event-driven.test.ts` | 95% |

**Overall coverage confidence**: **84%**

## G) Commands Executed

```bash
cd /Users/jordanknight/substrate/minih && git --no-pager status --short && git --no-pager diff --stat && git --no-pager diff --staged --stat && git --no-pager log --oneline -10
cd /Users/jordanknight/substrate/minih && just fft
cd /Users/jordanknight/substrate/minih && git --no-pager diff -- src/cli/commands/init.ts src/cli/commands/run.ts
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review — only context on the work that was done before the review.

**Review result**: APPROVE

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md
**Phase**: Phase 6: Agent Integration & Prompting
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-6-agent-integration-and-prompting/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-6-agent-integration-and-prompting/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-6-agent-integration-and-prompting/reviews/review.phase-6-agent-integration-and-prompting.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/runner/context.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/runner/types.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/runner/validator.ts` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/schemas/system-output.json` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json` | reviewed | runner | none |
| `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md` | reviewed | runner-data | use as the single scaffold source |
| `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts` | reviewed | cli | fix F001 |
| `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | reviewed | cli | fix F002 |
| `/Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-context.ts` | reviewed | cli | optional wording cleanup only |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-send.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-inbox-list.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-retro.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/retros.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/commands/state.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/preaction-context.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/src/cli/coordination.ts` | reviewed | cli | none |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/prompt.md` | reviewed | runner-data | none |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/outside.md` | reviewed | runner-data | none |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/instructions.md` | reviewed | runner-data | none |
| `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/output-schema.json` | reviewed | runner-data | none |
| `/Users/jordanknight/substrate/minih/test/runner/preamble-builder.test.ts` | reviewed | test | extend if F002 is fixed |
| `/Users/jordanknight/substrate/minih/test/runner/runner.test.ts` | reviewed | test | none |
| `/Users/jordanknight/substrate/minih/test/runner/schema-compat.test.ts` | reviewed | test | none |
| `/Users/jordanknight/substrate/minih/test/runner/validator.test.ts` | reviewed | test | none |
| `/Users/jordanknight/substrate/minih/test/runner/run-folder-snapshot.test.ts` | reviewed | test | none |
| `/Users/jordanknight/substrate/minih/test/cli/init-coordinated.test.ts` | reviewed | test | extend if F001 is fixed |
| `/Users/jordanknight/substrate/minih/test/cli/doctor-outside-md.test.ts` | reviewed | test | none |
| `/Users/jordanknight/substrate/minih/test/e2e/two-agent-coordination.test.ts` | reviewed | test | strengthen evidence path per F003 |
| `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-6-agent-integration-and-prompting/execution.log.md` | reviewed | docs | tighten T010 evidence wording |

### Next Step

`/plan-5-v2-phase-tasks-and-brief --phase "Phase 7: Polish & Docs" --plan /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md`
