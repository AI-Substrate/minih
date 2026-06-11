# Code Review: Simple Mode

**Plan**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-plan.md`  
**Spec**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-spec.md`  
**Phase**: Simple Mode  
**Date**: 2026-06-11  
**Reviewer**: Automated (plan-7-v2)  
**Testing Approach**: Lightweight

## A) Verdict

**APPROVE**

No HIGH or CRITICAL findings were identified. The implementation meets the plan's acceptance criteria, with medium/low follow-up notes around the boot contract's read-only wording, audit error classification, a copied `retros` flag typo, and domain-documentation currency.

**Key failure areas**:
- **Implementation**: Boot's contract says read-only, but `just check` runs `npm run build`, which rewrites ignored `dist/` output; the same boot sensor also soft-skips all parsed `npm audit` error envelopes instead of only network/offline failures.
- **Domain compliance**: Cross-domain consumer notes landed, but cli/runner history rows and the new eng-harness concepts table should be tightened.
- **Doctrine**: Audit findings should be surfaced; non-network audit errors must not become success-shaped skips.

## B) Summary

The phase successfully establishes the `.harness/` substrate, migrates governance, registers `eng-harness`, and proves all 11 acceptance criteria with Lightweight command evidence. Domain boundaries are materially respected: the new harness extension has no `src/`/`dist/` imports, the domain map shows a one-way process-boundary edge, and no product domain depends on eng-harness. No genuine concept reinvention was found; the new session-level engineering harness composes existing CLI surfaces instead of duplicating the product retro harness. Testing evidence is strong and replayable, with 94% overall confidence. The remaining findings are non-blocking follow-ups.

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present as real command evidence
- [x] Critical paths covered by AC-1 through AC-11 verification
- [x] Key verification points documented in `execution.log.md`
- [x] Only in-scope files changed
- [x] Linters/type checks clean per execution log (`just fft` exit 0)
- [x] Domain compliance checks pass with LOW documentation follow-ups

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | `/Users/jordanknight/substrate/minih/.harness/extensions/boot/extension.ts:132-134` | correctness | Boot is documented as read-only, but its `just check` sensor runs `npm run build`, which emits ignored `dist/` files that `git status --porcelain` will not show. | Either make the boot sensor no-emit/read-only, or change the boot contract/evidence to allow and detect ignored build-output mutation. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/minih/.harness/engineering-harness.md:57-62` | correctness | The canonical harness doc says `minih retros --slug <slug>`, but the CLI command exposes `--agent <slug>`, not `--slug`. | Replace the migrated guidance with `minih retros --agent <slug>`; consider fixing pre-existing AGENTS.md copies separately. |
| F003 | MEDIUM | `/Users/jordanknight/substrate/minih/.harness/extensions/boot/extension.ts:81-87` | error-handling | `runAudit` treats every parsed `npm audit --json` error as registry-unavailable and returns `skipped`, including non-network errors such as missing lockfiles or bad audit configuration. | Only soft-skip when the parsed code/summary or stderr matches known network/registry failures; otherwise return `fail` with the audit error detail. |
| F004 | LOW | `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md:55-90` | domain-md | The cli domain contract was updated for eng-harness, but History lacks a 024-core-harness entry for the cross-domain consumer note. | Add a History row documenting the eng-harness external-consumer note and process-boundary-only relationship. |
| F005 | LOW | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:88-142` | domain-md | The runner domain contract was updated for eng-harness, but History lacks a 024-core-harness entry for the harvest/read-bridge consumer note. | Add a History row documenting the eng-harness read-bridge note and process-boundary-only relationship. |
| F006 | LOW | `/Users/jordanknight/substrate/minih/docs/domains/eng-harness/domain.md:38-49` | concepts-docs | The new domain's Concepts table follows the repo's current `Concept | Definition` convention but does not explicitly show every new contract entry point, especially `harness instructions boot`. | Expand or supplement Concepts with entry points for `harness boot --json`, `harness record retro --slug`, `.harness/engineering-harness.md`, and `harness instructions boot`. |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 — Boot read-only proof misses ignored build output**  
`/Users/jordanknight/substrate/minih/.harness/extensions/boot/extension.ts:132-134` runs `just check`, and `/Users/jordanknight/substrate/minih/justfile:53-54` defines `check: build test`. `/Users/jordanknight/substrate/minih/package.json:27-32` defines `build` as `tsc && node scripts/copy-schemas.js`, with TypeScript emitting to `dist` per `/Users/jordanknight/substrate/minih/tsconfig.json:10-16`; `/Users/jordanknight/substrate/minih/.gitignore:83` ignores `dist`. The AC-4 `git status --porcelain` proof can therefore remain byte-identical while boot rewrites ignored build artifacts. Fix by making boot's build sensor no-emit/read-only, or by explicitly narrowing the contract from "never mutates" to "never mutates tracked files" and proving ignored-output behavior intentionally.

**F002 — Migrated dogfood command uses a nonexistent `retros --slug` flag**  
`/Users/jordanknight/substrate/minih/.harness/engineering-harness.md:57-62` documents `minih retros --slug <slug>`. The actual command options in `/Users/jordanknight/substrate/minih/src/cli/commands/retros.ts:53-57` are `--agent`, `--side`, `--target`, and `--run`. Use `minih retros --agent <slug>` in the canonical harness doc.

**F003 — Audit sensor over-classifies parsed errors as offline skips**  
`/Users/jordanknight/substrate/minih/.harness/extensions/boot/extension.ts:81-87` returns `skipped` for any parsed `npm audit --json` error. That matches the spec only for registry/offline failures; non-network audit errors should fail so audit misconfiguration is surfaced. Keep the existing soft-skip behavior for `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `ECONNREFUSED`, `ETIMEDOUT`, `EAUDITNOREGISTRY`, or equivalent summaries, and return `fail` for everything else.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | Material implementation files match the plan's Domain Manifest; SDD artifacts under `docs/plans/024-core-harness/` are process evidence rather than product-domain implementation files. |
| Contract-only imports | ✅ | `.harness/extensions/boot/extension.ts` imports only the type-only harness-core contract and has no `src/` or `dist/` imports. |
| Dependency direction | ✅ | The only new edge is `eng-harness -> cli` at a process boundary; no TypeScript import edge was introduced. |
| Domain.md updated | ⚠️ | New eng-harness domain doc exists, but cli and runner domain History rows should record the new external-consumer notes (F004, F005). |
| Registry current | ✅ | `docs/domains/registry.md` includes `eng-harness` as an Active sixth domain. |
| No orphan files | ✅ | All material implementation changes map to eng-harness, cli, or runner; plan/evidence artifacts are scoped to the SDD plan directory. |
| Map nodes current | ✅ | `docs/domains/domain-map.md` includes the `eng_harness` node and Health Summary row. |
| Map edges current | ✅ | The dashed process-boundary edge is labeled and one-way. |
| No circular business deps | ✅ | No business-domain import cycle or conceptual cycle was introduced. |
| Concepts documented | ⚠️ | Concepts exist, but the skill's entry-point-oriented concepts expectation is only partially met (F006). |

Domain-specific findings:

- **F004**: Add a 024-core-harness History row to `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` for the eng-harness external-consumer contract.
- **F005**: Add a 024-core-harness History row to `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` for the eng-harness read-bridge contract.
- **F006**: Add explicit entry points for the eng-harness concepts/contracts, including `harness instructions boot`.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Composite `harness boot` extension | Existing commands (`biome`, `tsc`, `just check`, `minih doctor`, `npm audit`) are composed, not reimplemented | eng-harness / cli | proceed |
| Observe -> retro record loop | harness-core owns observe/record; minih product retros remain runner-owned and read-only from eng-harness | eng-harness / runner | proceed |
| Governance and injection map | Prior governance existed at `docs/project-rules/harness.md`; migration creates canonical router-visible home rather than duplicate authority | eng-harness | proceed |
| eng-harness domain registration | No existing registered eng-harness domain | eng-harness | proceed |

No genuine duplication was found.

### E.4) Testing & Evidence

**Coverage confidence**: 94%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC1 | 95% | Execution log T010 reports governance, boot extension/instructions, first retro record, gitignored temp, and router C/D/E signals; computed diff includes `.harness` files and `.gitignore` change. |
| AC2 | 95% | Execution log: `harness doctor --json` status ok, extensions 1 loaded / 0 failed / 0 conflicts, conventions `[]`. |
| AC3 | 98% | Execution log records `harness boot --json` exit 0 with `status: degraded`, sensor data, orientation digest, and `next_action`; review boot check also returned degraded exit 0 with lint/typecheck/build+test pass. |
| AC4 | 90% | Execution log records `git status --porcelain` before/after boot compared byte-identical; F001 notes this does not prove ignored `dist/` immutability. |
| AC5 | 96% | Execution log gives replayable sequence: staged misformatted JSON, `just check` exit 0, `harness boot --json` exit 1 lint fail, cleanup, clean boot degraded exit 0. |
| AC6 | 95% | Execution log records observe list containing DL-001, `harness record retro --slug 024-core-harness` output path, populated record, clear then empty list. |
| AC7 | 90% | Execution log T001/T002 maps migrated sections, reports canonical file existence, Injection map heading, no TODO stubs, and old harness doc reduced to a dated pointer. |
| AC8 | 90% | Execution log T001 reports legacy read-path phrases: `READ-only harvest source` and `.harness/` writer prohibition. |
| AC9 | 94% | Execution log T004 reports AGENTS block placement, `git diff AGENTS.md | grep -c "npx harness"` = 0, and magic-wand rule extension. |
| AC10 | 92% | Execution log T005-T008 records eng-harness domain doc, registry row, domain-map edge, and cli/runner external-consumer notes. |
| AC11 | 95% | Execution log T011 records `just fft` exit 0 and non-releasing commits `chore(harness):...` and `docs(harness):...`; no unit-test additions were expected for Lightweight/no-new-test-infra. |

### E.5) Doctrine Compliance

Only one doctrine issue was found, deduplicated as **F003**: audit issues must be surfaced and only true network/offline failures should soft-skip. No additional `docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files exist; `docs/project-rules/harness.md` is now a pointer to the canonical governance doc.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC1 | Substrate shape exists and router signals C/D/E pass | `execution.log.md` T010 substrate-shape proof; diff adds `.harness/engineering-harness.md`, boot extension/instructions, retro record, `.gitignore` temp entry | 95% |
| AC2 | `harness doctor --json` clean for boot extension and conventions | `execution.log.md` T010 AC-2: status ok, 1 loaded, 0 failed, 0 conflicts, conventions `[]` | 95% |
| AC3 | Boot envelope honest with sensors, orientation, and `next_action` on non-ok | `execution.log.md` T010 AC-3 plus review `harness boot --json` result: degraded, exit 0, sensor/orientation data present | 98% |
| AC4 | Boot read-only | `execution.log.md` T010 AC-4: `git status --porcelain` byte-identical across boot; F001 limits this to tracked files | 90% |
| AC5 | Boot catches misformatted JSON lint failure that `just check` misses | `execution.log.md` T010 AC-5 replayable sequence: staged JSON -> `just check` green -> boot lint error -> cleanup -> clean boot | 96% |
| AC6 | Friction loop round-trips observe -> record -> clear | `execution.log.md` T010 AC-6 and committed record `/Users/jordanknight/substrate/minih/.harness/records/retro/2026-06-11/001-024-core-harness.md` | 95% |
| AC7 | Governance migrated and old file is a dated pointer | `execution.log.md` T001/T002; canonical governance exists; `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` reduced to pointer | 90% |
| AC8 | Legacy read path declared read-only | `.harness/engineering-harness.md` § Legacy read paths and execution log T001 evidence | 90% |
| AC9 | AGENTS.md routes future agents via bare `harness` dialect | `AGENTS.md:44-52`; execution log T004 grep evidence | 94% |
| AC10 | Domain registered with boundary docs/map/consumer notes | Domain files and execution log T005-T008; F004-F006 are non-blocking doc-currency follow-ups | 92% |
| AC11 | Full gate green and non-releasing commit hygiene | `execution.log.md` T011: `just fft` exit 0; commits `85ef669`, `81ec083`, `e376c8a` for phase/bookkeeping | 95% |

**Overall coverage confidence**: 94%

## G) Commands Executed

```bash
harness boot --json
wc -l docs/plans/024-core-harness/core-harness-plan.md
find docs/plans/024-core-harness -maxdepth 3 -type f | sort
git --no-pager diff --stat
git --no-pager diff --staged --stat
git --no-pager status --porcelain
git --no-pager log --oneline -10
mkdir -p docs/plans/024-core-harness/reviews
git --no-pager diff e468ff0..HEAD > docs/plans/024-core-harness/reviews/_computed.diff
git --no-pager diff --name-status e468ff0..HEAD
git --no-pager diff --stat e468ff0..HEAD
git --no-pager diff --check e468ff0..HEAD
```

Additional review inspection used repository search/view tools over the changed files, domain docs, `package.json`, `tsconfig.json`, `justfile`, `.gitignore`, and `src/cli/commands/retros.ts`.

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: APPROVE

**Plan**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-plan.md`  
**Spec**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-spec.md`  
**Phase**: Simple Mode  
**Tasks dossier**: inline in plan  
**Execution log**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/execution.log.md`  
**Review file**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/reviews/review.md`  
**Computed diff**: `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/reviews/_computed.diff`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `/Users/jordanknight/substrate/minih/.gitignore` | Reviewed | eng-harness cross-domain | None |
| `/Users/jordanknight/substrate/minih/.harness/engineering-harness.md` | Reviewed | eng-harness | Non-blocking: fix `minih retros --slug` to `--agent` (F002) |
| `/Users/jordanknight/substrate/minih/.harness/extensions/boot/extension.ts` | Reviewed | eng-harness | Non-blocking: clarify/read-only build behavior and audit error classification (F001, F003) |
| `/Users/jordanknight/substrate/minih/.harness/extensions/boot/instructions.md` | Reviewed | eng-harness | None |
| `/Users/jordanknight/substrate/minih/.harness/records/retro/2026-06-11/001-024-core-harness.md` | Reviewed | eng-harness | None |
| `/Users/jordanknight/substrate/minih/AGENTS.md` | Reviewed | eng-harness cross-domain | None for this phase; pre-existing `retros --slug` copies may be cleaned with F002 |
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | Reviewed | cli | Non-blocking: add 024 History row (F004) |
| `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` | Reviewed | eng-harness cross-domain | None |
| `/Users/jordanknight/substrate/minih/docs/domains/eng-harness/domain.md` | Reviewed | eng-harness | Non-blocking: expand Concepts entry points (F006) |
| `/Users/jordanknight/substrate/minih/docs/domains/registry.md` | Reviewed | eng-harness cross-domain | None |
| `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | Reviewed | runner | Non-blocking: add 024 History row (F005) |
| `/Users/jordanknight/substrate/minih/docs/how/engineering-harness.md` | Reviewed | eng-harness | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/.the-flow-state.json` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-plan.md` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-spec.md` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/execution.log.md` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/original-ask.md` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/research-dossier.md` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/the-flow.json` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/the-flow.md` | Reviewed | SDD/process | None |
| `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` | Reviewed | eng-harness | None |

### Required Fixes (if REQUEST_CHANGES)

None. Verdict is APPROVE.

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | Optional 024-core-harness History row for the eng-harness external-consumer note |
| `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | Optional 024-core-harness History row for the eng-harness read-bridge note |
| `/Users/jordanknight/substrate/minih/docs/domains/eng-harness/domain.md` | Optional entry-point-explicit Concepts coverage for `harness boot --json`, `harness record retro --slug`, `.harness/engineering-harness.md`, and `harness instructions boot` |

### Next Step

`/plan-8-v2-merge --plan "/Users/jordanknight/substrate/minih/docs/plans/024-core-harness/core-harness-plan.md"`
