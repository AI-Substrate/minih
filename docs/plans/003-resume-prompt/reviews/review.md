# Code Review: Simple Mode

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-spec.md
**Phase**: Simple Mode
**Date**: 2026-04-06
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Lightweight

## A) Verdict

**REQUEST_CHANGES**

Resume plumbing is close, but the current implementation still misses or breaks multiple acceptance criteria: resumed agents with required input schemas can fail before the SDK call, stdin-only resume is unsupported, and latest-run lookup does not reliably find the most recent completed session.

**Key failure areas**:
- **Implementation**: Resume still runs fresh-run input-schema validation and can fail locally before `resumeSession()`.
- **Domain compliance**: Domain docs/maps are slightly stale around `findRunSession()` and `sdk-runtime.ts`.
- **Testing**: CLI coverage/evidence missed stdin/help/latest-completed-session edge cases, so spec regressions shipped.

## B) Summary

The core design is sound: adapter resume support is reused, resumed runs create new artifact folders, JSON envelopes include resume metadata, and `just fft` passes on the reviewed commit. Anti-reinvention and project-rule checks were clean. The blocking issues are functional rather than architectural: agents with required `input-schema.json` cannot be resumed, `minih resume` cannot consume stdin because `<message>` is mandatory, and latest-session lookup stops on the newest directory instead of the newest completed run. `connect` also has contract/usability gaps: `--list` omits explicit timestamps, and the emitted shell command is not safely quoted for paths with spaces.

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present
- [ ] Critical paths covered
- [ ] Key verification points documented

- [x] Only in-scope files changed
- [ ] Linters/type checks clean (if applicable)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/minih/src/runner/runner.ts:131-171 | correctness | Resume still performs fresh-run input-schema validation with empty params, blocking resumed runs for agents with required inputs. | Skip input validation/`paramsHint` generation when `config.sessionId` is set, or reload the original params before validation. |
| F002 | HIGH | /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts:35-42 | scope | `resume` requires `<message>` and never reads stdin, so AC12 cannot work. | Change the signature to `resume <slug> [message]`, read stdin when the arg is omitted, and reject only when both sources are empty. |
| F003 | MEDIUM | /Users/jordanknight/substrate/minih/src/runner/folder.ts:252-277 | correctness | Latest-session lookup stops on the newest run directory and returns `null` if that run is incomplete/corrupt, instead of falling back to the newest completed session. | Iterate run folders in descending order until the first valid `completed.json` with a `sessionId` is found. |
| F004 | MEDIUM | /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts:142-176 | error-handling | Runtime resume failures still surface as generic `E120 AGENT_EXECUTION_FAILED` errors instead of the actionable fresh-start guidance required by AC8. | Catch/classify resume failures and map them to a clear recovery message such as `Session not found — run \`minih run <slug>\` for a fresh start.` |
| F005 | MEDIUM | /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts:35-42 | scope | `minih resume --help` shows usage/options only; it does not include the examples required by AC9. | Add Commander help examples for latest-run, `--run`, and stdin-based resume flows. |
| F006 | MEDIUM | /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts:76-129 | scope | `connect --list` omits an explicit timestamp field/column, so AC15 is only partially implemented. | Include `completedAt` (or equivalent) in both the JSON envelope and TTY table. |
| F007 | MEDIUM | /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts:150-160 | correctness | The generated connect command interpolates `runDir` without shell quoting, so "ready-to-paste" handoff breaks for paths with spaces. | Shell-escape `runDir` before composing the command string. |
| F008 | LOW | /Users/jordanknight/substrate/minih/docs/domains/domain-map.md:4 | domain-compliance | The `cli -> runner` edge label is stale after `findRunSession()` was added. | Add `findRunSession` to the edge label and refresh the explanatory bullets. |
| F009 | LOW | /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md:3-8,41-43 | domain-compliance | The CLI domain doc still describes `run.ts` as the composition root, but `sdk-runtime.ts` now owns shared SDK bootstrap for both `run` and `resume`. | Update the purpose/concepts wording to point at `src/cli/commands/sdk-runtime.ts`. |
| F010 | LOW | /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:16-18,33-36,52-55 | domain-compliance | The runner domain doc is only partially refreshed for session lookup, exported `RunSession`, and the resume exception to the normal output contract. | Refresh composition/contracts/concepts to reflect session lookup responsibilities and the conditional resume path. |
| F011 | LOW | /Users/jordanknight/substrate/minih/test/runner/session.test.ts:81-82,97 | pattern | The new session test introduces non-null assertions, which now show up as Biome warnings in the changed file. | Replace the new non-null assertions with explicit guards or optional chaining. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 HIGH — /Users/jordanknight/substrate/minih/src/runner/runner.ts:131-171**  
  `runAgent()` validates `input-schema.json` before the resume/fresh-run branch. For resumed agents with required inputs, `config.params` is empty and the run fails before any SDK call. Reproduced with a temp agent that had a required `ticket` input: `GH_TOKEN=dummy node dist/cli/index.js resume demo "follow up" --agents-dir "$tmp"` exited with `E120 Input parameter validation failed`.

- **F002 HIGH — /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts:35-42**  
  Commander still treats the follow-up message as mandatory, so stdin-only resume never reaches the handler. Reproduced with `printf 'follow up from stdin\n' | node dist/cli/index.js resume demo --agents-dir "$tmp"` returning `error: missing required argument 'message'`.

- **F003 MEDIUM — /Users/jordanknight/substrate/minih/src/runner/folder.ts:252-277**  
  When `--run` is omitted, `findRunSession()` picks the newest directory and bails out if that one lacks a usable `completed.json`. A single interrupted latest run therefore blocks `resume` and `connect` even when an older completed session exists. Reproduced with a temp agent containing one older completed run and one newer incomplete run: `connect demo` returned `No completed runs found`.

- **F004 MEDIUM — /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts:142-176**  
  Resume-specific runtime failures still collapse into a generic execution error. Lookup failures are actionable, but failures from `resumeSession()`/`sendAndWait()` are not translated into the fresh-start guidance called for in AC8.

- **F005 MEDIUM — /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts:35-42**  
  `resume --help` currently exposes usage and flags only. The spec explicitly requires examples in command help, and the observed output does not include them.

- **F006 MEDIUM — /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts:76-129**  
  `connect --list` returns `runId`, `sessionId`, `result`, and `durationMs`, but no explicit timestamp field or table column. The run ID is timestamp-shaped, but AC15 calls for timestamps as a first-class field.

- **F007 MEDIUM — /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts:150-160**  
  The generated command is not shell-safe. Observed output for an agent directory containing spaces was:  
  `cd /.../agents with space/demo/runs/... && copilot --yolo --resume=sess-123`  
  which is not safely pasteable as-is.

- **F011 LOW — /Users/jordanknight/substrate/minih/test/runner/session.test.ts:81-82,97**  
  The repository quality gate passes, but Biome now emits warnings for the new non-null assertions introduced in `session.test.ts`.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New files are under existing `src/cli`, `src/runner`, and `test/runner` trees. |
| Contract-only imports | ✅ | Cross-domain imports go through `runner/index.ts` and `adapter/index.ts`; no internal file imports cross domains. |
| Dependency direction | ✅ | Direction remains `cli → runner → adapter`; no upward dependency was introduced. |
| Domain.md updated | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` and `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` were updated, but both remain partially stale for this feature. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md` reflects `resume` and `connect` under `cli`. |
| No orphan files | ✅ | Changed source files map cleanly to `adapter`, `runner`, or `cli`; global docs/plan artifacts are cross-cutting, not orphaned source. |
| Map nodes current | ✅ | No new domains were introduced. |
| Map edges current | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md` does not list the new `findRunSession()` dependency on the `cli → runner` edge. |
| No circular business deps | ✅ | No circular domain dependency was introduced. |
| Concepts documented | ⚠️ | Concepts sections exist, but runner/cli concepts were not fully refreshed for session lookup and the resume exception to the normal output contract. |

- **F008 LOW — /Users/jordanknight/substrate/minih/docs/domains/domain-map.md:4**  
  The map still labels the `cli -> runner` edge with discovery/execution/validation/display calls only. `findRunSession()` is now a live cross-domain contract and should appear there.

- **F009 LOW — /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md:3-8,41-43**  
  The CLI domain doc still says the direct Copilot SDK composition root lives in `run.ts`, but `sdk-runtime.ts` now owns the shared bootstrap used by both `run` and `resume`.

- **F010 LOW — /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:16-18,33-36,52-55**  
  The runner doc was refreshed for resume in parts, but the new public `RunSession` export, the session-lookup responsibility in `folder.ts`, and the "magic wand is always required" concept were not fully reconciled with the resume exception.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `src/cli/commands/resume.ts` | None | cli | proceed |
| `src/cli/commands/connect.ts` | None | cli | proceed |
| `src/cli/commands/sdk-runtime.ts` | Existing SDK bootstrap in `run.ts` was extracted instead of duplicated | cli | extend |
| `findRunSession()` in `src/runner/folder.ts` | Existing run-folder/completed.json conventions reused | runner | extend |

### E.4) Testing & Evidence

**Coverage confidence**: 44%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC5 | 92 | `test/runner/session.test.ts` explicitly asserts `resumedFromRunId` is written for resumed runs and omitted for fresh runs. |
| AC9 | 0 | Observed `node dist/cli/index.js resume --help` output contains usage/options only; it has no examples. |
| AC12 | 0 | Observed `printf 'follow up from stdin\n' \| node dist/cli/index.js resume demo --agents-dir "$tmp"` fails with `missing required argument 'message'`. |
| AC15 | 20 | Observed `connect --list` JSON output omits an explicit timestamp field. |
| AC1 / AC13 edge case | 20 | Observed latest-run selection fails when the newest run directory is incomplete even though an older completed session exists. |

Additional evidence notes:
- `just fft` completed successfully on the reviewed commit: build, typecheck, tests, and audit passed; Biome emitted warnings only.
- `execution.log.md` documents baseline plus the pre-implementation T001 probe, but it does not record post-change verification for the shipped CLI behavior.

### E.5) Doctrine Compliance

N/A — no `docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` were present in the repository.

### E.6) Harness Live Validation

N/A — no harness configured (`/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` is absent).

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC1 | `minih resume <slug> "message"` uses the most recent completed run's session | Source wiring exists, but latest-session fallback is broken when the newest run is incomplete (F003). | 45 |
| AC2 | `minih resume <slug> --run <runId> "message"` resumes a specific historical run | `test/runner/session.test.ts` covers specific-run lookup and `resume.ts` forwards `opts.run`. | 60 |
| AC3 | Resumed session has full conversation history | `execution.log.md` T001 manually proves resumed sessions recall prior context (BANANA-42/CHERRY-99). | 70 |
| AC4 | Resumed runs create a new run folder with their own artifacts | `runAgent()` always creates a fresh run folder and writes artifacts before/after execution. | 80 |
| AC5 | `completed.json` includes `resumedFromRunId` | Direct unit coverage in `test/runner/session.test.ts`. | 92 |
| AC6 | Pretty mode is default on resume, `--verbose` remains available | Implemented in `resume.ts`, but not directly tested or logged. | 40 |
| AC7 | Resume JSON envelope includes `resumedFromRunId` and `originalSessionId` | Implemented in `resume.ts` success envelope, but not directly tested. | 50 |
| AC8 | Resume failures are actionable | Lookup failures are actionable, but runtime resume failures still fall through to generic `E120` errors (F004). | 20 |
| AC9 | `minih resume --help` includes examples | Observed help output does not include examples. | 0 |
| AC10 | `history` shows resumed runs with a visible indicator | `history.ts` adds `↩` when `resumedFromRunId` is present, but no CLI test/log asserts it. | 40 |
| AC11 | CWD isolation is maintained for resumed sessions | `runAgent()` still sets SDK `cwd` to the new run folder; no direct live validation was recorded. | 50 |
| AC12 | Follow-up message can come from stdin | Reproduced failure: stdin-only usage is rejected before the handler runs (F002). | 0 |
| AC13 | `connect <slug>` prints the latest-session handoff command | Works for a healthy latest run, but shares the F003 latest-run bug and the F007 quoting issue. | 45 |
| AC14 | `connect <slug> --run <runId>` prints the specific-session handoff command | Source path is wired through `findRunSession(slug, agentsDir, runId)`. | 60 |
| AC15 | `connect --list` shows run IDs, session IDs, timestamps, and status | Observed output omits an explicit timestamp field/column. | 20 |
| AC16 | Connect JSON envelope includes `sessionId` and command | Observed JSON output includes `sessionId`, `runDir`, and `command`. | 70 |

**Overall coverage confidence**: 44%

## G) Commands Executed

```bash
git --no-pager status --short
git --no-pager diff --staged --stat
git --no-pager diff --stat
git --no-pager log --oneline -10
git --no-pager diff --name-status 6f0936e..4c9c132
git --no-pager diff --stat 6f0936e..4c9c132
git --no-pager diff --no-ext-diff --unified=3 6f0936e..4c9c132 > /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/reviews/_computed.diff
just fft
node dist/cli/index.js resume --help
printf 'follow up from stdin\n' | node dist/cli/index.js resume demo --agents-dir "$tmp"
node dist/cli/index.js connect demo --list --agents-dir "$tmp"
node dist/cli/index.js connect demo --agents-dir "$tmp"
GH_TOKEN=dummy node dist/cli/index.js resume demo "follow up" --agents-dir "$tmp"
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-spec.md
**Phase**: Simple Mode
**Tasks dossier**: inline in plan
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/README.md | Modified | global-docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | Modified | adapter | None |
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Modified | cli | Update docs |
| /Users/jordanknight/substrate/minih/docs/domains/registry.md | Modified | global-docs | None |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Modified | runner | Update docs |
| /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/execution.log.md | Added | plan-artifact | Add post-fix evidence |
| /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/research-dossier.md | Added | plan-artifact | None |
| /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-plan.md | Added | plan-artifact | None |
| /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-spec.md | Added | plan-artifact | None |
| /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Modified | adapter | None |
| /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts | Added | cli | Fix AC15 and shell quoting |
| /Users/jordanknight/substrate/minih/src/cli/commands/history.ts | Modified | cli | None |
| /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts | Added | cli | Fix AC8, AC9, and AC12 |
| /Users/jordanknight/substrate/minih/src/cli/commands/run.ts | Modified | cli | None |
| /Users/jordanknight/substrate/minih/src/cli/commands/sdk-runtime.ts | Added | cli | None |
| /Users/jordanknight/substrate/minih/src/cli/index.ts | Modified | cli | None |
| /Users/jordanknight/substrate/minih/src/runner/folder.ts | Modified | runner | Fix latest-completed lookup |
| /Users/jordanknight/substrate/minih/src/runner/index.ts | Modified | runner | None |
| /Users/jordanknight/substrate/minih/src/runner/runner.ts | Modified | runner | Fix resume/input-schema interaction |
| /Users/jordanknight/substrate/minih/src/runner/types.ts | Modified | runner | None |
| /Users/jordanknight/substrate/minih/test/runner/session.test.ts | Added | tests | Add edge-case coverage and remove warnings |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/runner/runner.ts | Skip fresh-run input-schema validation for resumed runs, or restore original params before validation. | Required-input agents cannot currently be resumed at all. |
| 2 | /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts | Make the message positional optional and read stdin when it is omitted. | AC12 currently fails before the handler runs. |
| 3 | /Users/jordanknight/substrate/minih/src/runner/folder.ts | Return the newest **completed** session rather than the newest directory. | One incomplete latest run currently blocks valid older sessions. |
| 4 | /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts | Map runtime resume failures to actionable fresh-start guidance. | AC8 is only partially satisfied today. |
| 5 | /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts | Add help examples for latest-run, `--run`, and stdin flows. | AC9 is explicitly unmet. |
| 6 | /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts | Add explicit timestamps to `--list` output. | AC15 is only partially implemented. |
| 7 | /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts | Shell-quote the emitted `cd <runDir> && ...` command. | Ready-to-paste handoff breaks in paths with spaces. |
| 8 | /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | Add `findRunSession()` to the `cli -> runner` edge label. | Domain map is stale for this feature. |
| 9 | /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Point composition-root wording at `sdk-runtime.ts`. | Domain doc is stale after the refactor. |
| 10 | /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Refresh session lookup / `RunSession` / resume-concepts wording. | Domain doc is partially stale. |
| 11 | /Users/jordanknight/substrate/minih/test/runner/session.test.ts | Remove new non-null assertions and add latest-incomplete-run coverage. | The changed test file currently emits new lint warnings and misses the key regression. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | `findRunSession()` missing from the `cli -> runner` edge label |
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | `sdk-runtime.ts` not described as the shared SDK bootstrap for `run` and `resume` |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Session lookup responsibility, `RunSession`, and resume-output exception need reconciliation |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/resume-prompt-plan.md
