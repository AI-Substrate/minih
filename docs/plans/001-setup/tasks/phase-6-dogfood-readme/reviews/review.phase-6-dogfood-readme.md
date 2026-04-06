# Code Review: Phase 6: Dogfood + README

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 6: Dogfood + README
**Date**: 2026-04-06
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

Unsupported CLI flags remain in landed dogfood artifacts and README, the phase-added schema files fail the repository's `just fft` quality gate, and the execution evidence overstates how fully the feedback-loop fix was closed.

**Key failure areas**:
- **Implementation**: `smoke-test` and `convention-check` still instruct unsupported `--json` CLI usage; README repeats the same invalid usage and misdocuments `MINIH_HAS_INPUT_SCHEMA`.
- **Testing**: The execution artifacts claim the `--json` prompt issue was fixed, but committed files still contain it and the log does not show a post-fix rerun.
- **Doctrine**: Phase-added JSON schema files are not Biome-formatted, so `just fft` fails before the phase is merge-ready.

## B) Summary

This phase lands useful assets: six dogfood agents are discoverable, `minih doctor` reports all six healthy, README covers the right high-level topics, and no domain-compliance or reinvention problems surfaced. The blocking issues are consistency and merge-readiness problems, not architecture problems. Current committed artifacts still reference unsupported `--json` flags in `smoke-test`, `convention-check`, and README, which conflicts with both live CLI behavior and the phase's own execution log. The phase also leaves four new schema files unformatted, causing `just fft` to fail. Evidence for a completed feedback-loop rerun is incomplete: the log records one run batch plus edits, not a verified post-fix rerun.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Lightweight CLI and dogfood checks executed for core phase behaviors
- [x] Critical deliverables are present and discoverable (`list`, `doctor`, README, agent folders)
- [ ] Post-fix rerun evidence is documented for the feedback loop
- [x] Only in-scope files changed
- [ ] Linters and type checks clean (if applicable)
- [x] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/minih/agents/smoke-test/prompt.md:90-101 | correctness | `smoke-test` still invokes unsupported `--json` flags for `history` and `last-run`, so future runs can misread option failures as empty data. | Remove `--json`, rely on the stdout JSON contract, and check command exit status before interpreting output. |
| F002 | HIGH | /Users/jordanknight/substrate/minih/agents/convention-check/output-schema.json:1-61<br>/Users/jordanknight/substrate/minih/agents/feedback-digest/output-schema.json:1-65<br>/Users/jordanknight/substrate/minih/agents/self-review/output-schema.json:1-75<br>/Users/jordanknight/substrate/minih/agents/smoke-test/output-schema.json:1-49 | pattern | Four phase-added schema files are not Biome-formatted, so `just fft` fails. | Run `npx biome format --write` on the phase-added schema files and re-run the quality gate. |
| F003 | MEDIUM | /Users/jordanknight/substrate/minih/README.md:140-152<br>/Users/jordanknight/substrate/minih/README.md:204-216 | correctness | README advertises nonexistent `--json` flags and documents `MINIH_HAS_INPUT_SCHEMA` with the wrong runtime value semantics. | Replace unsupported examples with the real stdout/stderr contract and document `MINIH_HAS_INPUT_SCHEMA` as `true` or `false`. |
| F004 | MEDIUM | /Users/jordanknight/substrate/minih/agents/convention-check/instructions.md:16 | correctness | `convention-check` instructions still tell the agent to run unsupported `minih doctor --json`. | Update the instructions to the runnable form used elsewhere and restate that JSON is always on stdout. |
| F005 | MEDIUM | /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md:6<br>/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md:5<br>/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md:52-66 | testing | Phase bookkeeping and evidence are inconsistent: the dossier still says `Proposed`, the log still says `In Progress`, and the log claims `--json` references were removed even though committed artifacts still contain them and no post-fix rerun is shown. | Update the phase status fields, narrow or correct the fix claim, and add concrete post-fix rerun evidence if the feedback loop is claimed as complete. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 HIGH — unsupported CLI usage remains in `smoke-test`**
  - `/Users/jordanknight/substrate/minih/agents/smoke-test/prompt.md:93`
  - `/Users/jordanknight/substrate/minih/agents/smoke-test/prompt.md:101`
  - Live validation showed `npx minih history smoke-test --json` and `npx minih last-run smoke-test --json` both fail with `error: unknown option '--json'`. Because the prompt also redirects stderr to `/dev/null`, the agent can mistake an option failure for empty JSON output.

- **F002 HIGH — phase-added schema files fail the repository quality gate**
  - `just fft` currently fails on:
    - `/Users/jordanknight/substrate/minih/agents/convention-check/output-schema.json`
    - `/Users/jordanknight/substrate/minih/agents/feedback-digest/output-schema.json`
    - `/Users/jordanknight/substrate/minih/agents/self-review/output-schema.json`
    - `/Users/jordanknight/substrate/minih/agents/smoke-test/output-schema.json`
  - These are formatting failures rather than schema-design failures, but they are still blocking because `just fft` is the project's full review gate.

- **F003 MEDIUM — README examples do not match current runtime behavior**
  - `/Users/jordanknight/substrate/minih/README.md:142`
  - `/Users/jordanknight/substrate/minih/README.md:151`
  - `/Users/jordanknight/substrate/minih/README.md:216`
  - Live CLI validation showed the documented `--json` examples fail. Source inspection also showed `MINIH_HAS_INPUT_SCHEMA` is set to `'true'` or `'false'` in `/Users/jordanknight/substrate/minih/src/runner/runner.ts:202-204`, not `1`.

- **F004 MEDIUM — `convention-check` instructions reintroduce the same invalid flag**
  - `/Users/jordanknight/substrate/minih/agents/convention-check/instructions.md:16`
  - The prompt was partly corrected to use stdout JSON directly, but the instructions still send the agent back to an unsupported `--json` flow, which recreates the confusion the phase says it resolved.

### E.2) Domain Compliance

This phase changes user-space agent definitions, root documentation, and plan artifacts; it does not modify domain-governed source files. Domain compliance is therefore clean or not applicable rather than active.

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | No domain-governed source files were added or moved; user-space `agents/` assets are explicitly in scope for this phase. |
| Contract-only imports | ✅ | No new cross-domain source imports were introduced. |
| Dependency direction | ✅ | No domain dependency edges changed. |
| Domain.md updated | ✅ | No domain contract or composition changes required domain history updates. |
| Registry current | ✅ | No new domains were introduced. |
| No orphan files | ✅ | Non-domain assets changed here are explicitly permitted by the tasks dossier. |
| Map nodes current | ✅ | Existing domain set is unchanged. |
| Map edges current | ✅ | Existing labeled edges are unchanged. |
| No circular business deps | ✅ | No new business-domain dependencies were introduced. |
| Concepts documented | N/A | No domain contract additions were made in this phase. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| convention-check agent | None | — | Proceed |
| prompt-review agent | None | — | Proceed |
| smoke-test agent | None | — | Proceed |
| feedback-digest agent | None | — | Proceed |
| self-review agent | None | — | Proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 76%

The phase uses an appropriate Hybrid strategy for this kind of work: existing repo build and test coverage stays in place, while the phase itself relies on dogfood-agent runs and direct CLI validation. The weak point is closure of the feedback loop after fixes: the execution log shows one run batch and some edits, but not a clean post-fix rerun proving the final committed artifacts match the claim.

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-P6-1 | 62 | `npx minih list 2>/dev/null` returned `count: 6`, `npx minih doctor 2>/dev/null` reported 6 healthy agents, and the execution log records 5 completed plus 1 degraded run. The log does not preserve full run IDs or post-fix rerun evidence. |
| AC-P6-2 | 45 | README includes install, quick-start, CLI reference, env vars, and examples, but `/Users/jordanknight/substrate/minih/README.md:142`, `:151`, and `:216` are inaccurate. |
| AC-P6-3 | 99 | `/Users/jordanknight/substrate/minih/package.json:58-61` allowlists only `dist` and `LICENSE`, and review subanalysis confirmed `agents/` is excluded from the package tarball. |
| AC-P6-4 | 84 | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md:55-66` plus `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md:44-49` show acted-on wishes, but the `--json` fix is incomplete in committed artifacts. |
| AC-P6-5 | 98 | `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md:44-49` contains two concrete evidence entries tied to real agent feedback. |
| AC-P6-6 | 30 | The phase brief describes a completed feedback cycle (`run -> read magic wands -> act -> run again`), but `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md` records edits after feedback, not a verified post-fix rerun. |

**Violations**

- **HIGH**: README CLI reference is inaccurate for `list` and `doctor`.
- **MEDIUM**: The phase does not document a full post-fix rerun despite claiming the feedback loop is proven.

### E.5) Doctrine Compliance

N/A — no `docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files were present. No project-rules violation was identified beyond the repository quality gate failure already captured in F002.

### E.6) Harness Live Validation

N/A — no harness is configured for this project. The plan and execution log both describe minih itself as the CLI tool under test, so review evidence came from direct CLI execution instead.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-P6-1 | All 6 dogfood agents run successfully (completed or degraded) | Live `list` and `doctor` checks confirm 6 healthy definitions; execution log records one 5-completed, 1-degraded batch. | 62 |
| AC-P6-2 | README covers install, quick-start, CLI reference, and agent examples | README contains all sections, but CLI examples and one env-var semantic are inaccurate. | 45 |
| AC-P6-3 | npm package excludes dogfood agents | `package.json` `files` allowlist excludes `agents/`. | 99 |
| AC-P6-4 | At least one magic wand wish was acted on | Execution log and preamble evidence table show acted-on wishes, though the `--json` cleanup is incomplete. | 84 |
| AC-P6-5 | Preamble evidence table has real entries | Preamble evidence table contains two concrete examples. | 98 |
| AC-P6-6 | At least one feedback cycle is closed with a post-fix rerun | No post-fix rerun commands, run IDs, or output evidence recorded. | 30 |

**Overall coverage confidence**: 76%

## G) Commands Executed

```bash
git --no-pager status --short
git --no-pager diff --stat
git --no-pager diff --staged --stat
git --no-pager log --oneline -12
git --no-pager diff d4bf60b..c33a91a > docs/plans/001-setup/tasks/phase-6-dogfood-readme/reviews/_computed.diff
git --no-pager diff --name-status d4bf60b..c33a91a
git --no-pager diff --stat d4bf60b..c33a91a
git --no-pager show --no-patch --format=fuller c33a91a
just fft
npx minih list --json
npx minih doctor --json
npx minih history smoke-test --json
npx minih last-run smoke-test --json
npx minih doctor 2>/dev/null
npx minih list 2>/dev/null
npx minih history smoke-test 2>/dev/null
npx minih last-run smoke-test 2>/dev/null
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 6: Dogfood + README
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/reviews/review.phase-6-dogfood-readme.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/README.md | Reviewed | — | Fix CLI examples and env-var docs |
| /Users/jordanknight/substrate/minih/agents/_shared/preamble.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/convention-check/instructions.md | Reviewed | — | Remove unsupported `--json` instruction |
| /Users/jordanknight/substrate/minih/agents/convention-check/output-schema.json | Reviewed | — | Format with Biome |
| /Users/jordanknight/substrate/minih/agents/convention-check/prompt.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/feedback-digest/output-schema.json | Reviewed | — | Format with Biome |
| /Users/jordanknight/substrate/minih/agents/feedback-digest/prompt.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/hello-world/prompt.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/prompt-review/input-schema.json | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/prompt-review/instructions.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/prompt-review/output-schema.json | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/prompt-review/prompt.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/self-review/input-schema.json | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/self-review/instructions.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/self-review/output-schema.json | Reviewed | — | Format with Biome |
| /Users/jordanknight/substrate/minih/agents/self-review/prompt.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/agents/smoke-test/output-schema.json | Reviewed | — | Format with Biome |
| /Users/jordanknight/substrate/minih/agents/smoke-test/prompt.md | Reviewed | — | Remove unsupported `--json` flags |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md | Reviewed | — | Correct status and evidence claims |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.fltplan.md | Reviewed | — | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md | Reviewed | — | Correct dossier status |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/agents/smoke-test/prompt.md | Remove unsupported `--json` flags from `history` and `last-run`, and guard on command success before treating output as data | Current prompt invokes invalid CLI options and can misread failures as empty data |
| 2 | /Users/jordanknight/substrate/minih/agents/convention-check/instructions.md<br>/Users/jordanknight/substrate/minih/README.md | Remove remaining unsupported `--json` instructions and examples, and document `MINIH_HAS_INPUT_SCHEMA` correctly | Current docs and instructions contradict actual CLI/runtime behavior |
| 3 | /Users/jordanknight/substrate/minih/agents/convention-check/output-schema.json<br>/Users/jordanknight/substrate/minih/agents/feedback-digest/output-schema.json<br>/Users/jordanknight/substrate/minih/agents/self-review/output-schema.json<br>/Users/jordanknight/substrate/minih/agents/smoke-test/output-schema.json | Format phase-added schema files with Biome | `just fft` currently fails |
| 4 | /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md<br>/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md | Align status and evidence with actual final state, and add post-fix rerun evidence or narrow the claim | Current planning artifacts overstate completion and closure of the feedback loop |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| None | No domain artifact updates are required for this phase. |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md --phase 'Phase 6: Dogfood + README'
