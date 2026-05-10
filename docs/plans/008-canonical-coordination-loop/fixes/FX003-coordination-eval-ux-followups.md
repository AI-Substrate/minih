# Fix FX003: Coordination eval UX follow-ups

**Created**: 2026-04-27  
**Status**: Complete  
**Plan**: [canonical-coordination-loop-plan.md](../canonical-coordination-loop-plan.md)  
**Source**: [Post 003: FX002 blocking inbox live run](../posts/003-fx002-blocking-inbox-live-run.md) and user request to create a fix task for all live-run magic-wand findings  
**Domain(s)**: mcp primary for multi-type waits; cli primary for tail/check UX; runner/docs consumed for prompt and environment guidance

---

## Problem

The FX002 live run proved that bounded `inbox_list.waitMs` removes sleep-polling, but the no-context agent and outside peer still found four sharp edges. Inside waits are still single-type, outside progress snapshots require an always-following `tail`, `check` versus `validate --run` is easy to mix up, and prompt text implies `$MINIH_OUTPUT_PATH` is shell-visible even though the live agent could not see it from bash.

These are small coordination UX fixes, but they matter before the next no-context eval because they directly affect whether a fresh agent can follow the loop without trial-and-error.

## Proposed Fix

Add a backward-compatible multi-type wait option to the private inside MCP `inbox_list` contract, using `waitForAny?: string[]` so an inside agent can wait for milestone, complete, cancel, or other terminal messages in one bounded call. `waitForAny` must be a non-empty array of at most 16 exact message-type strings, each 1-64 characters, with no duplicate values. It is mutually exclusive with the existing single `type` filter so matching remains unambiguous.

Add bounded snapshot support to `minih tail`, preserving the current follow behavior while making the attempted `--lines` flow valid and adding an explicit snapshot/no-follow mode.

Then tighten the agent-facing guidance around validation and output paths: `check` validates a file (`--file` or best-effort env), while `validate --run` re-validates a completed run; prompts/docs should not depend on bash seeing `MINIH_OUTPUT_PATH` unless that environment visibility is actually repaired. The fix should update docs/tests/domain notes and leave the coordination-loop validator ready for another manual/fresh-agent eval.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| mcp | Primary owner | `inbox_list` gains a backward-compatible `waitForAny` filter for immediate and long-poll reads. |
| cli | Primary owner | `tail` gains bounded snapshot UX; `check`/`validate` help, examples, and docs become harder to misuse. |
| runner | Contract/docs consumer | Coordinated preamble and system output guidance should provide explicit output path and validation fallback instructions without importing MCP. |
| docs/agents | Consumer | Canonical validator assets, how-to docs, AGENTS/README snippets, and the no-context eval prompt should teach the improved loop. |

## Quick Codebase Check

| File | Exists? | Domain Check | Notes |
|------|---------|--------------|-------|
| `/Users/jordanknight/substrate/minih/src/mcp/types.ts` | Yes | mcp contract | `InboxListInput` and `TOOL_CONTRACTS.inbox_list` currently expose single `type` plus `waitMs`; add `waitForAny` here. |
| `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts` | Yes | mcp internal | `listVisibleMessages` filters one exact `type`; extend the predicate without changing omitted/zero-wait behavior. |
| `/Users/jordanknight/substrate/minih/test/mcp/inbox.test.ts` | Yes | mcp test | Add immediate, wait-success, timeout, invalid input, and `type`/`waitForAny` conflict coverage. |
| `/Users/jordanknight/substrate/minih/test/mcp/types.test.ts` | Yes | mcp test | Manifest/schema tests should cover `waitForAny` array bounds and mutual exclusivity expectations. |
| `/Users/jordanknight/substrate/minih/test/mcp/server-dispatch.test.ts` | Yes | mcp test | Dispatcher invalid-argument behavior should preserve typed MCP errors for the new contract. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/tail.ts` | Yes | cli internal | Current command always renders last 20 then follows; add configurable `--lines` and explicit snapshot/no-follow mode. |
| `/Users/jordanknight/substrate/minih/test/cli/commands.test.ts` | Yes | cli test | Command discovery/help coverage can assert new tail options and validation guidance. |
| `/Users/jordanknight/substrate/minih/test/cli/coordination-loop-validator.test.ts` | Yes | cli/docs test | Existing static worked-example tests should catch drift in the canonical command beats. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/check.ts` | Yes | cli internal | Help/error text should clarify file validation and not suggest `--run`. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/validate.ts` | Yes | cli internal | Help/examples should clarify this is the run-targeted re-validation surface. |
| `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | Yes | runner internal | Runner sets `MINIH_OUTPUT_PATH` in the parent process and injects a literal output path into the prompt; investigate why the live bash shell did not see the env. |
| `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` | Yes | runner contract | Coordinated preamble should teach `waitForAny` and output-path fallback behavior. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md` | Yes | runner/mcp agent asset | Prompt should prefer multi-type waits for milestone/terminal messages and explicit validation commands. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/instructions.md` | Yes | runner/mcp agent asset | Instructions should mirror the reliable output/check guidance. |
| `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md` | Yes | docs consuming cli/runner/mcp | Runbook should document tail snapshot usage, validate/check distinction, and multi-type inside waits. |
| `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/no-context-two-agent-eval-prompt.md` | Yes | plan artifact | Fresh-agent prompt should use the improved long-poll and bounded tail guidance before the manual eval. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX003-1 | Add multi-type waits to `inbox_list` | mcp | `/Users/jordanknight/substrate/minih/src/mcp/types.ts`; `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts`; `/Users/jordanknight/substrate/minih/test/mcp/inbox.test.ts`; `/Users/jordanknight/substrate/minih/test/mcp/types.test.ts`; `/Users/jordanknight/substrate/minih/test/mcp/server-dispatch.test.ts` | `inbox_list({ unread: true, waitMs: 30000, waitForAny: ["milestone", "complete", "cancel"] })` returns the first visible matching type, works for immediate and waited reads, rejects invalid arrays, and preserves existing `type` behavior when `waitForAny` is omitted. | CS3; backward-compatible MCP contract extension. `waitForAny` contract: array only, `minItems: 1`, `maxItems: 16`, item strings `minLength: 1`, `maxLength: 64`, exact duplicate values rejected, and mutually exclusive with `type`. Cover empty array, oversized array, duplicate values, invalid item values, and `type`+`waitForAny` conflict. |
| [x] | FX003-2 | Add bounded tail snapshot UX | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/tail.ts`; `/Users/jordanknight/substrate/minih/test/cli/commands.test.ts`; optional new focused tail test under `/Users/jordanknight/substrate/minih/test/cli/` | `minih tail <slug> --run <runId> --lines 20` is accepted and controls the initial event count; an explicit snapshot/no-follow option prints the bounded recent events plus completion summary if present, then exits without polling forever. | CS3; preserve current no-flag behavior: last 20 events then follow until completion or Ctrl+C. |
| [x] | FX003-3 | Make `check` vs `validate --run` hard to confuse | cli/docs | `/Users/jordanknight/substrate/minih/src/cli/commands/check.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/validate.ts`; `/Users/jordanknight/substrate/minih/test/cli/commands.test.ts`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/outside.md`; `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md`; `/Users/jordanknight/substrate/minih/AGENTS_README.md`; `/Users/jordanknight/substrate/minih/README.md` | Help text, examples, and canonical validator assets clearly say `check` validates an explicit file with `--file`, while `validate <slug> --run <runId>` validates a run output; sanctioned docs/examples contain no `check --run` pattern. | CS2; if practical, add a targeted friendly error for `check ... --run` that points at `validate --run` or `check --file`. |
| [x] | FX003-4 | Resolve inside output-path environment guidance | runner/docs | `/Users/jordanknight/substrate/minih/src/runner/runner.ts`; `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts`; `/Users/jordanknight/substrate/minih/test/runner/preamble-builder.test.ts`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/instructions.md`; `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md` | The implementation either makes the relevant `MINIH_*` env vars actually visible to the agent shell, or documents/tests the reliable fallback: use the literal output path injected in the prompt and run `minih check <slug> --file <path>`. | CS3; do not silently claim shell env support unless reproduced. Keep zero-arg `minih check` as best-effort only if shell env remains SDK-dependent. |
| [x] | FX003-5 | Refresh coordination eval docs and domain records, then validate | mcp/cli/runner | `/Users/jordanknight/substrate/minih/docs/domains/mcp/domain.md`; `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md`; `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md`; `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md`; `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/no-context-two-agent-eval-prompt.md`; `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/fixes/FX003-coordination-eval-ux-followups.log.md` | Domain docs and the no-context eval prompt reflect the new UX; targeted MCP/CLI/runner tests, `npm run build`, and `just fft` pass before commit/push. | CS2; if a live eval is rerun after implementation, record it as the next ordinal post instead of burying it in the fix log. |

## Workshops Consumed

- [Post 003: FX002 blocking inbox live run](../posts/003-fx002-blocking-inbox-live-run.md) - primary source for the four magic-wand findings.
- [Manual Event Validation Agent Harness](../workshops/001-manual-event-validation-agent-harness.md) - establishes the three-milestone outside/inside loop and the requirement that inside waits must be bounded.

## Acceptance

- [x] Existing `inbox_list` calls with no `waitForAny` behave exactly as they do today.
- [x] `waitForAny` accepts a non-empty string array of 1-16 exact message types, rejects invalid item values and duplicate entries with `MCP_INVALID_ARGUMENT`, and is mutually exclusive with the existing `type` filter.
- [x] A multi-type positive wait returns when any requested type appears and does not wake for irrelevant messages.
- [x] `minih tail --lines <n>` is accepted, validated, documented, and defaults remain backward-compatible.
- [x] A bounded tail snapshot/no-follow mode lets an outside peer inspect recent events without starting a long-lived follow loop.
- [x] Canonical guidance distinguishes file validation (`check --file`) from run validation (`validate --run`) and removes any sanctioned `check --run` examples.
- [x] Output-path guidance is truthful: either shell env visibility is repaired and tested, or the prompt/docs teach the literal path plus explicit `check --file` fallback.
- [x] The no-context two-agent eval prompt is updated so a fresh agent can exercise the improved UX.
- [x] Targeted tests, build, and `just fft` pass before the fix is committed.

## Non-Goals

- No public MCP server mode.
- No outside CLI long-polling for inbox reads; this fix only adds bounded tail snapshot UX on the outside.
- No new coordination rule engine or queue.
- No automatic live model eval in the implementation step unless explicitly requested; if run, capture it as the next ordinal post.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-04-27 | FX003-1 | Contract shape | The local `JsonSchema` helper type only modeled primitive/object schemas, so documenting `waitForAny` needed array support and an object-level mutual-exclusion marker. | Extended the helper type just enough for `array` schemas and `not.required`, then backed it with direct manifest and dispatcher tests. |
| 2026-04-27 | FX003-2 | UX decision | The validated dossier intentionally left the no-follow flag name open. | Chose `--snapshot` as the explicit no-follow mode and bounded `--lines` to 1-1000 events; default `tail` still follows after showing the recent event window. |
| 2026-04-27 | FX003-3 | CLI error shape | A raw unknown `--run` option on `check` would bypass the JSON envelope and lose the actionable guidance. | Added a hidden `--run` catch to `check` so mistaken run validation returns `E108` with the correct `validate --run` and `check --file` alternatives while keeping help focused on files. |
| 2026-04-27 | FX003-4 | Environment claim | The live run already showed shell visibility of `$MINIH_OUTPUT_PATH` is SDK/environment-dependent, and FX003 had no reliable way to prove every future shell can inherit it. | Kept zero-arg `minih check` best-effort, made the literal prompt path authoritative, and added explicit `minih check <slug> --file <literal-output-path>` fallback guidance plus preamble tests. |

---

## Validation Record (2026-04-27)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth | System Behavior, Technical Constraints, Edge Cases & Failures, Domain Boundaries, Concept Documentation | 1 MEDIUM open | ⚠️ |
| Cross-Reference | User Experience, Integration & Ripple, Hidden Assumptions, Concept Documentation, Domain Boundaries | 0 | ✅ |
| Completeness/Risk | Edge Cases & Failures, Performance & Scale, Security & Privacy, Deployment & Ops, Technical Constraints, Hidden Assumptions | 1 HIGH fixed, 2 MEDIUM open | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Technical Constraints, Deployment & Ops | 0 | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 FX003 implementation | Task table paths, contracts, acceptance, and domain constraints precise enough to implement without guessing | contract drift | ✅ | Tasks, paths, done-when criteria, and domain constraints are explicit in the task table; `waitForAny` bounds/mutual exclusion are now specified. |
| docs/plans/008-canonical-coordination-loop/no-context-two-agent-eval-prompt.md | Updated fresh-agent guidance for multi-type waits, bounded tail snapshots, and validation/output-path commands before manual eval | shape mismatch | ✅ | FX003 assigns the eval prompt as a consumer and requires doc refresh for multi-type waits, bounded tail snapshot/no-follow, and validation/output-path fallback rules. |
| plan-7 FX003 review | Testable acceptance and domain files to review after implementation | test boundary | ✅ | Acceptance criteria are testable and review-relevant domain files are enumerated across mcp, cli, runner, docs, and agent assets. |

**Outcome alignment**: “The outside contract should be clear enough that another agent can follow it as a script for a back-and-forth conversation.”

**Standalone?**: No — downstream consumers are named: plan-6 FX003 implementation, the no-context two-agent eval prompt, and plan-7 FX003 review.

**Fixes applied (HIGH)**:
- Defined `waitForAny` bounds and validation expectations: non-empty array, `maxItems: 16`, item length 1-64, duplicate rejection, `type` mutual exclusion, and tests for empty/oversized/duplicate/invalid/conflicting inputs.

**Open (MEDIUM — user decision)**:
- Tail snapshot remains intentionally under-specified on exact snapshot flag spelling; implementation must choose and test the concrete no-follow option.
- Output-path shell visibility remains a test-backed decision point; implementation must either prove shell env visibility end to end or rely on the prompt-injected literal output path plus `minih check --file <path>`.
- Source-truth validation warned not to overclaim that runner-set `MINIH_OUTPUT_PATH` is visible to the live bash shell; FX003 keeps this as an investigate-or-document task.

Overall: VALIDATED WITH FIXES

---

## Post-Implementation Validation Record (2026-04-27)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Correctness | System Behavior, Edge Cases & Failures, Security & Privacy, Technical Constraints | 0 | ✅ |
| Regression/UX | User Experience, Integration & Ripple, Performance & Scale, Deployment & Ops, Domain Boundaries | 1 MEDIUM fixed | ✅ |
| Domain/Docs | Domain Boundaries, Concept Documentation, Contract Drift, User Experience | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Technical Constraints, Test Boundary | 0 implementation issues; matrix rerun for required mode taxonomy | ✅ |

**Fix applied (MEDIUM)**:
- `src/cli/commands/tail.ts` now reads a bounded suffix window from `events.ndjson` and expands backward only until it has enough recent lines. Large snapshot/follow startup no longer reads the full event log when the requested recent events fit near the end; `test/cli/tail.test.ts` covers the bounded-read helper.
- Post-fix evidence: `just fft` passed with 438 tests passed, 9 skipped, and 0 audit vulnerabilities.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `docs/plans/008-canonical-coordination-loop/no-context-two-agent-eval-prompt.md` | Teach fresh/no-context agents `waitForAny`, bounded `tail --lines --snapshot`, `validate --run`, and literal `minih check --file` fallback. | shape mismatch | ✅ | FX003 required the doc refresh; the prompt now uses `waitForAny`, `--snapshot`, and `check --file`. |
| `agents/coordination-loop-validator/{prompt.md,instructions.md,outside.md}` and `docs/how/coordination-loop-validator.md` | Provide canonical worked-example assets that teach and dogfood the improved loop. | contract drift | ✅ | Validator assets and runbook now document bounded waits, bounded tail snapshots, `validate --run`, and literal-path fallback. |
| Plan-7 FX003 review | Complete code/doc/test/domain evidence with no unresolved high-severity drift. | test boundary | ✅ | FX003 records code, test, and doc evidence across MCP, CLI, runner, and plan assets; the full quality gate passed after implementation. |
| Future manual no-context eval summary `docs/plans/008-canonical-coordination-loop/evals/no-context-two-agent-eval.md` | Stable command/tool contracts for a fresh outer/inner pair. | lifecycle ownership | ✅ | The eval prompt requires this summary doc and the source/tests now back the wait, tail, check, and validation contracts it will exercise. |

**Outcome alignment**: “The outside contract should be clear enough that another agent can follow it as a script for a back-and-forth conversation.” FX003 advances it.

**Standalone?**: No — downstream consumers are named: the no-context eval prompt, canonical validator assets/how-to, plan-7 FX003 review, and the future manual eval summary.

Overall: VALIDATED WITH FIXES
