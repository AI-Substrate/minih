# Code Review: Phase 5: Outside CLI Surface

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md
**Phase**: Phase 5: Outside CLI Surface
**Date**: 2026-04-26
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid (focused built-CLI + unit coverage)

## A) Verdict

**APPROVE**

F001 is fixed: outside-state mutations now append history before write even for data-only updates, and the rerun did not surface any remaining material correctness, domain, reinvention, or testing gaps in the Phase 5 surface.

## B) Summary

The outside CLI surface is now coherent and contract-aligned. `src/cli/commands/state.ts` appends history on every persisted outside-state mutation, `test/cli/state.test.ts` covers the data-only audit paths that were missing before, and a direct CLI reproduction confirmed the same-status/data-only history behavior end to end. The `cli` domain docs, registry entry, and domain map all reflect the new Phase 5 commands and dependencies, and the new command set stays within the documented `cli -> {mcp, runner, adapter}` boundary. I did not find a blocker-level reinvention issue, and the focused CLI suite plus the full repo quality gate both back the acceptance-criteria coverage.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Core validation tests present
- [x] Critical paths covered
- [x] Key verification points documented

Universal:
- [x] Only in-scope files changed
- [x] Linters/type checks clean (if applicable)
- [x] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| — | — | — | — | No material findings. | — |

## E) Detailed Findings

### E.1) Implementation Quality

No material implementation issues remain in the reviewed Phase 5 surface.

The prior F001 audit bug is fixed:

- `writeOutsideState()` now appends history before every persisted outside-state mutation.
- `test/cli/state.test.ts` covers `--data-json`, `--key data.*`, and same-status transition failure behavior.
- A direct CLI reproduction showed both a data-only `state set` and a same-status/data-only `state transition` creating `state/history.ndjson` entries with `from: "idle"` and `to: "idle"`.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | All new Phase 5 files land under `src/cli/`, `test/cli/`, or the Phase 5 plan-artifact tree declared in the plan manifest. |
| Contract-only imports | ✅ | CLI changes consume runner/mcp/adapter contracts only; no forbidden cross-domain internal imports surfaced. |
| Dependency direction | ✅ | Imports remain within `cli -> {mcp, runner, adapter}` and do not introduce an upward edge or cycle. |
| Domain.md updated | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` reflects the outside commander surface, context guard, concepts, and history entry. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md` lists the expanded CLI purpose including outside coordination commands. |
| No orphan files | ✅ | Every reviewed changed file maps cleanly to the Phase 5 `cli` surface or its supporting plan/docs artifacts. |
| Map nodes current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` reflects the CLI dependency set used by the new coordination commands. |
| Map edges current | ✅ | The domain map labels the `cli -> runner`, `cli -> mcp`, and `cli -> adapter` edges with current contracts/helpers. |
| No circular business deps | ✅ | No circular dependency was introduced. |
| Concepts documented | ✅ | The `cli` domain Concepts section includes the outside commander surface, context block, and cross-side retros. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Outside commander surface (`outside-send`, `outside-inbox-list`, `state`, `outside-context`, `outside-retro`, `retros`) | Reuses runner inbox/state contracts and intentionally mirrors inside MCP semantics where appropriate | cli / runner / mcp | ✅ Proceed |

No blocker-level duplication surfaced. The shared CLI helper (`src/cli/coordination.ts`) centralizes validation and inbox-lane parsing instead of creating parallel one-off logic in each command.

### E.4) Testing & Evidence

**Coverage confidence**: 95%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-CTX-BLOCK | 96 | `test/cli/preaction-context.test.ts` validates strict `MINIH === '1'`; `test/cli/commands.test.ts` exercises blocked `run`, `resume`, `quickstart`, `tail`, and `init` envelopes. |
| AC-OUTSIDE-SEND | 94 | `test/cli/outside-send.test.ts` covers normal send, ack validation, missing agent/bad slug, and schema rejection. |
| AC-OUTSIDE-LIST | 92 | `test/cli/outside-inbox-list.test.ts` covers empty lanes, `--type`, `--unread`, torn final lines, and malformed JSON. |
| AC-STATE-OUTSIDE-WRITE | 97 | `test/cli/state.test.ts` now covers status writes, data-only writes, nested `data.*` writes, schema preference, and no-partial-write failure behavior; direct CLI reproduction confirmed history append for data-only and same-status transitions. |
| AC-OUTSIDE-CONTEXT-CLI | 92 | `test/cli/outside-context.test.ts` covers system-only, present/absent/empty `outside.md`, symlink escape rejection, and oversized truncation. |
| AC-OUTSIDE-RETRO | 94 | `test/cli/outside-retro.test.ts` covers default/custom targets and invalid target rejection. |
| AC-RETROS-AGGREGATOR | 90 | `test/cli/retros.test.ts` covers inside+outside aggregation, filtering, targetless-exclusion behavior, and corrupt outside-lane failure. |

### E.5) Doctrine Compliance

N/A — no `docs/project-rules/*.md` files exist in this repository, so there was no doctrine surface to validate against.

### E.6) Harness Live Validation

N/A — no `docs/project-rules/harness.md` exists, and the Phase 5 dossier explicitly falls back to build/test validation rather than a live harness boot.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-CTX-BLOCK | Inside-unsafe commands fail with `E128 INVALID_CONTEXT` under `MINIH=1` | `test/cli/preaction-context.test.ts`, `test/cli/commands.test.ts` | 96 |
| AC-OUTSIDE-SEND | Outside-lane message append + ack support | `test/cli/outside-send.test.ts` | 94 |
| AC-OUTSIDE-LIST | Read/filter inside-lane replies | `test/cli/outside-inbox-list.test.ts` | 92 |
| AC-STATE-OUTSIDE-WRITE | Outside state writes append history before write and reject unsafe writes | `test/cli/state.test.ts`, direct `node dist/cli/index.js state set/transition` reproduction, `just fft` | 97 |
| AC-OUTSIDE-CONTEXT-CLI | `outside-context` returns markdown in `data.context` and enforces path safety | `test/cli/outside-context.test.ts` | 92 |
| AC-OUTSIDE-RETRO | `outside-retro` writes `type: retro` messages with target metadata | `test/cli/outside-retro.test.ts` | 94 |
| AC-RETROS-AGGREGATOR | `retros` merges inside report retros and outside retro messages | `test/cli/retros.test.ts` | 90 |

**Overall coverage confidence**: 95%

## G) Commands Executed

```bash
cd /Users/jordanknight/substrate/minih
git --no-pager status --short
git --no-pager diff --name-only
git --no-pager diff --staged --name-only
git ls-files --others --exclude-standard
git --no-pager log --oneline -10
npm run build
npx vitest run test/cli/commands.test.ts test/cli/preaction-context.test.ts test/cli/outside-send.test.ts test/cli/outside-inbox-list.test.ts test/cli/state.test.ts test/cli/outside-context.test.ts test/cli/outside-retro.test.ts test/cli/retros.test.ts test/cli/run-help.test.ts
just fft
tmpdir=$(mktemp -d)
node dist/cli/index.js state set demo --side outside --data-json '{"phase":"review"}' --agents-dir "$agents"
node dist/cli/index.js state transition demo --to idle --data-json '{"phase":"done"}' --agents-dir "$agents"
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review — only context on the work that was done before the review.

**Review result**: APPROVE

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-spec.md
**Phase**: Phase 5: Outside CLI Surface
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-5-outside-cli-surface/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-5-outside-cli-surface/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-5-outside-cli-surface/reviews/review.phase-5-outside-cli-surface.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | Modified | docs / cli | None |
| `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` | Modified | docs / cross-domain | None |
| `/Users/jordanknight/substrate/minih/docs/domains/registry.md` | Modified | docs / cross-domain | None |
| `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination.fltplan.md` | Modified | docs / plan | None |
| `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-5-outside-cli-surface/tasks.md` | New | docs / phase dossier | None |
| `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-5-outside-cli-surface/tasks.fltplan.md` | New | docs / phase flight plan | None |
| `/Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/tasks/phase-5-outside-cli-surface/execution.log.md` | New | docs / phase evidence | None |
| `/Users/jordanknight/substrate/minih/src/cli/output.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/quickstart.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/tail.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/index.ts` | Modified | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/preaction-context.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/coordination.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-send.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-inbox-list.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/state.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-context.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/outside-retro.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/src/cli/commands/retros.ts` | New | cli | None |
| `/Users/jordanknight/substrate/minih/test/cli/commands.test.ts` | Modified | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/preaction-context.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/outside-send.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/outside-inbox-list.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/state.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/outside-context.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/outside-retro.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/retros.test.ts` | New | cli test | None |
| `/Users/jordanknight/substrate/minih/test/cli/run-help.test.ts` | New | cli test | None |

Ignored generated artifacts: `/Users/jordanknight/substrate/minih/session-store.db-shm`, `/Users/jordanknight/substrate/minih/session-store.db-wal`

### Required Fixes

None — the phase is approved.

### Domain Artifacts to Update

| File (absolute path) | What's Missing |
|---------------------|----------------|
| None | No additional domain-doc updates are required for Phase 5. |

### Next Step

`/plan-5-v2-phase-tasks-and-brief --phase "Phase 6: Agent Integration & Prompting (Workshops 005 + 008)" --plan /Users/jordanknight/substrate/minih/docs/plans/007-backgrounding/coordination-plan.md`
