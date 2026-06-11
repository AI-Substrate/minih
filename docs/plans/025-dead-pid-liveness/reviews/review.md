# Code Review: Simple Mode

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness/dead-pid-liveness-plan.md  
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness/dead-pid-liveness-spec.md  
**Phase**: Simple Mode  
**Date**: 2026-06-11  
**Reviewer**: Automated (the-flow stage 7 - review)  
**Testing Approach**: Hybrid

## A) Verdict

**APPROVE**

No HIGH or CRITICAL findings were found. The implementation advances the core dead-pid liveness behavior, but the notes below should be fixed before or shortly after merge to tighten CLI contracts and domain currency.

**Key failure areas**:
- **Implementation**: `reconcile <slug> --all` accepts contradictory scope and reports `all: true` while still scoping to the slug; lock stealing can surface raw filesystem races instead of E190.
- **Domain compliance**: new runner reconcile/lock contracts are exported to CLI but not fully represented in runner domain docs or the domain map.
- **Testing**: AC-10's TTY/crashed-status claim is only indirectly covered by value-map assertions and JSON/smoke tests.
- **Scope**: plan 022 flow-state close-out artifacts are bundled into the plan 025 diff.

## B) Summary

The core feature is implemented coherently: status now probes live manifests, inventory uses the shared dead vocabulary, provider stream aborts map to `terminalReason`, and reconcile heals dead active manifests. The test set is broad and mostly strong, with injected-predicate proof for the core logic and built-CLI smokes for pid behavior. The main implementation risks are non-blocking but real: one ambiguous CLI option combination can mislead users, and a rare lock-steal race can escape the promised E190 error surface. Domain docs are partially stale for the new public runner reconcile surface.

## C) Checklist

**Testing Approach: Hybrid**

- [x] TDD logic-core tests present
- [x] Lightweight CLI smokes present for critical pid paths
- [ ] Human/TTY rendering for `crashed` status directly proven (F003)
- [x] Key verification points documented in execution log
- [ ] Only in-scope files changed (F006)
- [x] Linters/type checks/build/test evidence present
- [ ] Domain compliance checks pass without documentation gaps (F004, F005)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | `/Users/jordanknight/substrate/minih/src/cli/commands/reconcile.ts:43-78` | correctness | `minih reconcile <slug> --all` reports `all: true` but still scopes to the provided slug. | Reject `--all` with slug/`--run`, or make `--all` ignore slug scoping; add a CLI test. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/minih/src/runner/reconcile-lock.ts:69-79` | error-handling | Two concurrent stealers can hit raw `ENOENT`/`EEXIST` instead of the promised E190 lock-held surface. | Handle unlink/write races explicitly and translate second-writer contention to `ReconcileLockHeldError`. |
| F003 | MEDIUM | `/Users/jordanknight/substrate/minih/src/cli/commands/status.ts:178-186,446-468` | testing | AC-10's crashed-status/human-rendering proof is indirect; `status` maps healed manifests to `dead` but does not expose `manifestStatus`, and no TTY smoke exercises the render path. | Add a focused CLI/TTY render test or adjust AC-10/docs to point to the `runs` surface that exposes `manifestStatus`. |
| F004 | MEDIUM | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:11-87` | domain | CLI imports runner reconcile-lock symbols, but plan/domain docs still treat the lock file as internal and omit reconcile public contracts. | Reclassify/document the lock as contract if CLI keeps importing it, or move locking behind a runner-owned public reconcile shell. |
| F005 | LOW | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:12-22` | domain | The cli -> runner edge omits the new reconcile/healer contract; runner Concepts omit dead-pid liveness/reconcile entries. | Update domain-map edge labels and runner Concepts rows for liveness/reconcile entry points. |
| F006 | LOW | `/Users/jordanknight/substrate/minih/docs/plans/022-minih-skills-config/.the-flow-state.json:6-14` | scope | Plan 022 close-out artifacts are included in the plan 025 diff. | Move those artifacts to a separate commit, or explicitly document why they are bundled. |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 - MEDIUM - correctness**  
`/Users/jordanknight/substrate/minih/src/cli/commands/reconcile.ts:43-78`

`--all` is accepted even when a slug is provided. The command then calls `reconcileRuns({ slug })` while the success envelope reports `filters.all: true`, so `minih reconcile alpha --all` looks like a whole-repo pass but only scans `alpha`.

Fix: choose one contract and test it. The safer CLI contract is to reject `--all` when `slug` or `--run` is present with E108; alternatively, make `--all` truly ignore slug scoping.

**F002 - MEDIUM - error-handling**  
`/Users/jordanknight/substrate/minih/src/runner/reconcile-lock.ts:69-79`

After deciding an existing lock is stealable, the code unlinks it and immediately writes a new lock. If another process steals between those calls, `fs.unlinkSync` can throw `ENOENT`, or `writeNewLockFile` can throw `EEXIST`. Those raw filesystem errors bypass `ReconcileLockHeldError`, so the CLI may miss the documented E190 contention surface.

Fix: ignore `ENOENT` on unlink, translate second-write `EEXIST` to `ReconcileLockHeldError`, or retry the first-write-wins acquire path after a steal race.

**F003 - MEDIUM - testing/evidence**  
`/Users/jordanknight/substrate/minih/src/cli/commands/status.ts:178-186,446-468`

The implementation maps healed manifests (`status: 'crashed'`) to verdict `dead` without re-probing, but the `status` success envelope does not include `manifestStatus`. Existing tests assert the `dead` icon/color maps and JSON pid diagnostics, while `status-dead-smoke.test.ts` executes built CLI JSON paths only. That leaves AC-10's "dead verdict and crashed status render distinctly in human output" claim indirectly proven at best.

Fix: add a TTY/human-output smoke or a focused renderer test for `dead` and healed/crashed cases, or narrow the AC/docs to say that `runs list/status` is the surface exposing `manifestStatus: 'crashed'`.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | Source files are placed under cli/runner/adapter per the Domain Manifest. |
| Contract-only imports | ✅ | CLI imports runner symbols through `runner/index.ts`; F004 covers stale classification/docs for newly exported lock symbols. |
| Dependency direction | ✅ | Import direction remains cli -> runner -> adapter; no upward imports found. |
| Domain.md updated | ❌ | Runner domain docs omit new reconcile composition/contract rows and classify reconcile-lock inconsistently with CLI usage. |
| Registry current | ✅ | No new domains were added. |
| No orphan files | ❌ | Plan 022 close-out artifacts are outside the plan 025 manifest; harness retro is intentional evidence but also outside the manifest table. |
| Map nodes current | ✅ | No new domain nodes required. |
| Map edges current | ❌ | cli -> runner edge omits the reconcile/healer contract. |
| No circular business deps | ✅ | No new circular dependencies. |
| Concepts documented | ⚠️ | Runner Concepts do not describe dead-pid liveness or reconcile healing entry points. |

**F004 - MEDIUM - domain-md**  
`/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:11-87`

`src/cli/commands/reconcile.ts` imports `withReconcileLock` and `ReconcileLockHeldError` from the runner barrel, making those lock symbols part of the public runner contract. The plan manifest marks `src/runner/reconcile-lock.ts` internal, and runner domain Composition/Contracts do not list the new reconcile files or exported contracts.

Fix: either keep lock orchestration fully behind a runner-owned public contract, or document `reconcile-lock.ts` and the exported lock/error symbols as runner contracts consumed by CLI.

**F005 - LOW - map/concepts**  
`/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:12-22`

The domain map still labels cli -> runner with older run/validation surfaces and omits reconcile/healing. Runner Concepts also do not name the new dead-pid liveness and reconcile healing concepts.

Fix: update the edge label and runner Concepts rows for `isProcessAliveDefault`, `listRunInventory`, and `reconcileRuns`.

**F006 - LOW - orphan/scope**  
`/Users/jordanknight/substrate/minih/docs/plans/022-minih-skills-config/.the-flow-state.json:6-14`

The working tree includes retroactive plan 022 close-out edits in the plan 025 review diff. They appear intentional, but they are not part of the plan 025 Domain Manifest or task table.

Fix: split those edits into a separate commit/change, or explicitly document why the plan 022 close-out belongs with plan 025.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `reconcileRuns` | Reuses `listAgentSlugs`/`listRunDirs` and `updateManifest`; no duplicate healer found. | runner | proceed |
| `reconcile-lock` | Deliberately mirrors existing lock patterns (`run-lock`/resume-lock style). | runner | proceed |
| `computeStatusVerdict` | Extracts existing status verdict logic and wires shared `isProcessAliveDefault`. | cli/runner | proceed |
| `provider_stream_aborted` | Mirrors the existing `permission_denied` synthetic-event pattern. | adapter/runner | proceed |

No genuine reinvention found.

### E.4) Testing & Evidence

**Coverage confidence**: 91%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-1 | 98% | `status-verdict.test.ts` dead matrix and diagnostics cases; `status-dead-smoke.test.ts` real corpse smoke verifies `dead`, `pid`, `pidAlive:false`, `lastEventAt`. |
| AC-2 | 95% | Live-pid matrix and live-twin CLI smoke; execution log says `run-target-ambiguity.test.ts` stayed green without edits. |
| AC-3 | 97% | Completed/terminal cases use throwing predicates to prove the pid probe is skipped. |
| AC-4 | 96% | `run-inventory.test.ts` and `runs.test.ts` prove dead-pid inventory reports `dead`. |
| AC-5 | 97% | `run-eligibility.test.ts` covers ESRCH/EPERM/EINVAL/non-positive behavior and resolver/inventory EPERM paths. |
| AC-6 | 96% | `sdk-copilot.test.ts`, `fake.test.ts`, and `runner-event-driven.test.ts` cover abort event emission and `terminalReason` mapping. |
| AC-7 | 97% | `reconcile.test.ts` covers heal, preservation, idempotency; `reconcile-command.test.ts` covers built CLI heal and re-run. |
| AC-8 | 90% | Lock contention/stale/dead-owner tests and E190 CLI test exist; F002 notes an untested steal race. |
| AC-9 | 95% | `status-dead-smoke.test.ts` terminalReason passthrough loop covers all three values through the built CLI. |
| AC-10 | 65% | `STATUS_VERDICT_*` maps assert dead icon/color; no TTY smoke or `status` envelope `manifestStatus` for crashed manifests (F003). |
| AC-11 | 98% | Injected 9+ case matrix plus one reaped corpse and one live-pid built-CLI smoke. |
| AC-12 | 96% | `docs-vocabulary.test.ts` guards AGENTS_README, AGENTS.md, companion outside.md, CHANGELOG, README, run-liveness.md, and dist bundle freshness. |
| AC-13 | 80% | Domain docs have history rows; F004/F005 note incomplete runner composition/contracts/concepts and map currency. |

### E.5) Doctrine Compliance

No `docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files are present. Against repository conventions, the implementation preserves ESM TypeScript, CLI JSON stdout/human stderr discipline, runner-owned manifest writes, adapter SDK isolation, and domain import direction. Findings F004/F005 cover the remaining architecture-documentation drift.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-1 | Dead active run yields `verdict: "dead"` with diagnostics. | Direct matrix + built CLI corpse smoke. | 98% |
| AC-2 | Live pids retain active/stale semantics. | Direct matrix + live CLI smoke + unchanged ambiguity regression. | 95% |
| AC-3 | Terminal runs skip probing. | Completed/terminal tests with throwing probe. | 97% |
| AC-4 | `minih runs` reports dead instead of stale. | Inventory unit + CLI runs test. | 96% |
| AC-5 | Probe error spec covers ESRCH/EPERM/EINVAL/non-positive. | `run-eligibility` tests plus resolver/inventory EPERM coverage. | 97% |
| AC-6 | Stream abort writes event and terminalReason. | Adapter/fake/runner event-driven tests. | 96% |
| AC-7 | Reconcile heals, preserves terminalReason, is idempotent. | `reconcile.test.ts` and CLI reconcile test. | 97% |
| AC-8 | Reconcile lock guards concurrent runs. | Lock tests and E190 CLI test; F002 covers steal race gap. | 90% |
| AC-9 | Status surfaces terminalReason values. | Built CLI passthrough loop. | 95% |
| AC-10 | Dead/crashed render distinctly in human output. | Dead icon/color maps only; F003 covers weak crashed/TTY proof. | 65% |
| AC-11 | Deterministic proof with matrix + real smokes. | 9+ injected cases and two spawn smokes. | 98% |
| AC-12 | Docs migrated and guarded. | Vocabulary guard test across doc surfaces and dist bundle. | 96% |
| AC-13 | Domain history/currency. | History rows present; composition/contracts/map/concepts incomplete (F004/F005). | 80% |

**Overall coverage confidence**: 91%

## G) Commands Executed

```bash
harness boot --json
git --no-pager status --short && git --no-pager diff --stat && git --no-pager diff --staged --stat
mkdir -p docs/plans/025-dead-pid-liveness/reviews
git --no-pager diff --name-status && git --no-pager diff --staged --name-status && git ls-files --others --exclude-standard
{ git --no-pager diff --no-ext-diff --binary -- . ':(exclude)docs/plans/025-dead-pid-liveness/reviews/**'; git --no-pager diff --staged --no-ext-diff --binary -- . ':(exclude)docs/plans/025-dead-pid-liveness/reviews/**'; git ls-files --others --exclude-standard | grep -v '^docs/plans/025-dead-pid-liveness/reviews/' | while IFS= read -r f; do git --no-pager diff --no-ext-diff --binary --no-index -- /dev/null "$f" || true; done; } > docs/plans/025-dead-pid-liveness/reviews/_computed.diff
git --no-pager diff -- docs/plans/022-minih-skills-config/.the-flow-state.json docs/plans/022-minih-skills-config/the-flow.json docs/plans/022-minih-skills-config/the-flow.md
```

Review lenses run: Implementation Quality, Domain Compliance, Anti-Reinvention, Testing & Evidence, Doctrine & Rules.

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review -
> only context on the work that was done before the review.

**Review result**: APPROVE

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness/dead-pid-liveness-plan.md  
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness/dead-pid-liveness-spec.md  
**Phase**: Simple Mode  
**Tasks dossier**: inline in plan  
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness/execution.log.md  
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/cli/commands/reconcile.ts | notes | cli | Fix or document `slug + --all` behavior (F001). |
| /Users/jordanknight/substrate/minih/src/runner/reconcile-lock.ts | notes | runner | Harden steal race error mapping (F002). |
| /Users/jordanknight/substrate/minih/src/cli/commands/status.ts | notes | cli | Strengthen crashed/TTY proof or clarify surface (F003). |
| /Users/jordanknight/substrate/minih/src/runner/reconcile.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/src/runner/run-inventory.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/src/runner/run-eligibility.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/src/runner/runner.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/src/runner/types.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/src/adapter/events.ts | ok | adapter | None. |
| /Users/jordanknight/substrate/minih/src/adapter/fake.ts | ok | adapter | None. |
| /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | ok | adapter | None. |
| /Users/jordanknight/substrate/minih/src/cli/commands/runs.ts | ok | cli | None. |
| /Users/jordanknight/substrate/minih/src/cli/index.ts | ok | cli | None. |
| /Users/jordanknight/substrate/minih/src/cli/output.ts | ok | cli | None. |
| /Users/jordanknight/substrate/minih/test/adapter/fake.test.ts | ok | adapter | None. |
| /Users/jordanknight/substrate/minih/test/adapter/sdk-copilot.test.ts | ok | adapter | None. |
| /Users/jordanknight/substrate/minih/test/cli/docs-vocabulary.test.ts | ok | cli | None. |
| /Users/jordanknight/substrate/minih/test/cli/reconcile-command.test.ts | notes | cli | Add contradictory `--all` scope case if fixing F001. |
| /Users/jordanknight/substrate/minih/test/cli/runs.test.ts | ok | cli | None. |
| /Users/jordanknight/substrate/minih/test/cli/status-dead-smoke.test.ts | notes | cli | Add TTY/crashed render smoke if fixing F003. |
| /Users/jordanknight/substrate/minih/test/cli/status-verdict.test.ts | ok | cli | None. |
| /Users/jordanknight/substrate/minih/test/runner/reconcile-lock.test.ts | notes | runner | Add steal-race case if fixing F002. |
| /Users/jordanknight/substrate/minih/test/runner/reconcile.test.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/test/runner/run-eligibility.test.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/test/runner/run-inventory.test.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/test/runner/run-resolver.test.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/test/runner/runner-event-driven.test.ts | ok | runner | None. |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | notes | runner docs | Add composition/contracts/concepts for reconcile (F004/F005). |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | notes | domain docs | Update cli -> runner edge for reconcile (F005). |
| /Users/jordanknight/substrate/minih/docs/plans/022-minih-skills-config/.the-flow-state.json | notes | planning artifact | Split or document plan 022 close-out bundle (F006). |

### Required Fixes (if REQUEST_CHANGES)

None. The review is APPROVE; findings are medium/low follow-ups.

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Composition/Contracts/Concepts rows for `reconcileRuns`, `reconcile-lock` public symbols, and dead-pid liveness. |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | cli -> runner edge label for reconcile/healing contracts. |

### Next Step

`/the-flow 8 --plan "/Users/jordanknight/substrate/minih/docs/plans/025-dead-pid-liveness"`
