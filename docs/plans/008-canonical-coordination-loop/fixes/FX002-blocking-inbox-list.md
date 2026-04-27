# Fix FX002: Blocking inbox list

**Created**: 2026-04-27  
**Status**: Complete  
**Plan**: [canonical-coordination-loop-plan.md](../canonical-coordination-loop-plan.md)  
**Source**: Live run retrospective / magic-wand feedback plus user request before the no-context two-agent eval  
**Domain(s)**: mcp primary; runner and cli consumed through prompt/docs/tests only

---

## Problem

The first live coordination runs worked, but the inside agent had to invent sleep-poll loops while waiting for outside milestone messages. That made the transcript slower and noisier, and it forced each inside agent to guess polling cadence instead of using a clear coordination primitive.

Before running the no-context two-agent eval, the inside agent should have an explicit blocking/long-poll inbox read so it can wait for peer messages without arbitrary sleeps.

## Proposed Fix

Extend the existing private MCP `inbox_list` tool with an optional wait parameter named `waitMs`. `waitMs` is milliseconds, must be a finite non-negative integer, `0` means immediate mode, and values above `30000` fail with `MCP_INVALID_ARGUMENT`. When omitted or `0`, `inbox_list` preserves today's immediate read behavior and response shape. When positive, `inbox_list` first returns immediately if matching messages are already visible; otherwise it waits until a matching peer-lane message appears or the timeout expires.

The wait result shape is part of the contract when `waitMs` is provided:

```json
{
  "messages": [],
  "nextAfter": null,
  "wait": {
    "requestedMs": 30000,
    "elapsedMs": 30000,
    "timedOut": true,
    "matched": false
  }
}
```

For a successful wait, `timedOut` is `false` and `matched` is `true`. `elapsedMs` is the measured wall-clock wait duration. Matching means the current `unread`, `type`, `after`, and `limit` inputs produce at least one visible peer message; irrelevant messages must not complete the wait with a false positive.

The fix should not add a new tool name, public MCP server, runtime rule engine, or new queue. It should stay within the existing run-scoped inbox files and private MCP server. The outside CLI `outside-inbox-list --wait` is intentionally out of scope for this fix unless implementation proves it is necessary for the inside-agent eval.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| mcp | Primary owner | `inbox_list` contract and implementation gain optional long-poll behavior; server dispatch may become async-safe. |
| runner | Contract consumer/provider | Existing run-scoped inbox path helpers remain the backing store; coordinated preamble text may need to teach the new parameter. |
| cli | Composition/docs consumer | No new user-facing CLI command is required; docs and example agents should describe the new inside MCP usage. |

## Quick Codebase Check

| File | Exists? | Domain Check | Notes |
|------|---------|--------------|-------|
| `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts` | Yes | mcp internal | Current `inboxList` is synchronous and returns immediately after reading outside/inside lanes. |
| `/Users/jordanknight/substrate/minih/src/mcp/types.ts` | Yes | mcp contract | `InboxListInput` and `TOOL_CONTRACTS` currently expose `unread`, `type`, `limit`, and `after`; add `waitMs` here. |
| `/Users/jordanknight/substrate/minih/src/mcp/server.ts` | Yes | mcp internal | `dispatchToolCall` is synchronous today; long-poll may require async handler support. |
| `/Users/jordanknight/substrate/minih/test/mcp/inbox.test.ts` | Yes | mcp test | Existing immediate read/filter/corrupt-lane coverage should remain; add wait success and timeout coverage. |
| `/Users/jordanknight/substrate/minih/test/mcp/server-dispatch.test.ts` | Yes | mcp test | If dispatch becomes async, update call sites and preserve legacy alias behavior. |
| `/Users/jordanknight/substrate/minih/test/mcp/server.test.ts` | Yes | mcp test | Real stdio/JSON-RPC coverage should keep the manifest and request path working after async dispatch. |
| `/Users/jordanknight/substrate/minih/test/mcp/types.test.ts` | Yes | mcp test | Tool-contract shape checks should cover the new `waitMs` schema and bounds. |
| `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts` | Yes | runner contract | Coordinated preamble should mention the wait parameter so no-context agents discover it. |
| `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md` | Yes | runner/mcp agent asset | Replace generic bounded polling guidance with explicit `inbox_list` long-poll guidance. |
| `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md` | Yes | docs consuming cli/runner/mcp | Runbook should explain that inner waits use MCP long-poll; outside still observes via status/tail/list. |
| `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/no-context-two-agent-eval-prompt.md` | Yes | plan artifact | Fresh-agent eval prompt should tell the inner agent to prefer `waitMs` over sleep-polling once implemented. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX002-1 | Extend the `inbox_list` MCP contract | mcp | `/Users/jordanknight/substrate/minih/src/mcp/types.ts`; `/Users/jordanknight/substrate/minih/test/mcp/types.test.ts`; `/Users/jordanknight/substrate/minih/test/mcp/server-dispatch.test.ts` | The manifest documents optional `waitMs` in milliseconds, rejects non-integer/negative/over-30000 values, preserves existing `unread`/`type`/`limit`/`after` behavior, defines the `wait` metadata shape, and all dispatcher/contract tests still pass. | CS2; contract change, but backward-compatible when omitted. |
| [x] | FX002-2 | Implement long-poll behavior for inside inbox reads | mcp | `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts`; `/Users/jordanknight/substrate/minih/src/mcp/server.ts`; `/Users/jordanknight/substrate/minih/test/mcp/inbox.test.ts`; `/Users/jordanknight/substrate/minih/test/mcp/server.test.ts` | `inbox_list({ unread: true, waitMs: N })` returns immediately when a matching message exists, otherwise waits for a matching outside-lane change or timeout, without busy-spinning, leaking watchers/timers, or swallowing corrupt-lane errors. | CS4; async path likely requires server request-handler/test updates. Clean up wait resources in `finally` for match, timeout, error, and overlapping calls. |
| [x] | FX002-3 | Teach coordinated agents to use the blocking read | runner/mcp | `/Users/jordanknight/substrate/minih/src/runner/preamble-builder.ts`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/instructions.md`; `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md`; `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/no-context-two-agent-eval-prompt.md` | Prompt/runbook text tells inside agents to prefer `inbox_list` with bounded `waitMs` for milestone waits and to report partial only after the bounded wait expires. | CS2; update docs after implementation so examples match the real schema. |
| [x] | FX002-4 | Validate the fix before the no-context eval | mcp/runner | `/Users/jordanknight/substrate/minih/test/mcp/inbox.test.ts`; `/Users/jordanknight/substrate/minih/test/mcp/server-dispatch.test.ts`; `/Users/jordanknight/substrate/minih/test/runner/preamble-builder.test.ts` | Targeted MCP/preamble tests pass, `npm run build` passes, and `just fft` passes before any commit/push. | CS2; no live model run in this fix task itself. |

## Workshops Consumed

- [Manual Event Validation Agent Harness](../workshops/001-manual-event-validation-agent-harness.md) — establishes the outside/inside milestone loop and explicitly says the inside agent must not wait forever.
- [Run-Scoped Rerun Evidence](../posts/002-run-scoped-rerun-evidence.md) — records the magic-wand request for blocking/long-poll inbox reads after the `gpt-5.5` rerun.

## Acceptance

- [x] Existing `inbox_list` calls without `waitMs` remain immediate and backward-compatible.
- [x] `waitMs` is milliseconds, finite, integer, non-negative, capped at `30000`, and invalid values are rejected with `MCP_INVALID_ARGUMENT`.
- [x] A positive `waitMs` returns immediately if matching messages are already available.
- [x] A positive `waitMs` waits until a matching outside message arrives, then returns that message without requiring agent-authored sleeps.
- [x] A positive `waitMs` uses the full current filter set (`unread`, `type`, `after`, `limit`) as the match predicate and does not wake with irrelevant messages.
- [x] A positive `waitMs` times out cleanly with an empty `messages` list and `wait: { requestedMs, elapsedMs, timedOut: true, matched: false }`.
- [x] A successful positive wait returns `wait: { requestedMs, elapsedMs, timedOut: false, matched: true }`.
- [x] Watchers/timers are cleaned up deterministically after match, timeout, error, and overlapping calls; each wait call owns local resources and closes them before resolving or rejecting.
- [x] Corrupt inbox files still surface typed MCP errors rather than becoming silent timeouts.
- [x] The coordinated preamble and canonical validator docs teach the new long-poll usage.
- [x] Targeted tests, build, and `just fft` pass before the no-context eval is run.

## Non-Goals

- No public MCP server mode.
- No new queue or rule engine.
- No source-code eventing or automatic milestone detection.
- No many-inside-agent orchestration.
- No outside CLI `outside-inbox-list --wait` in this fix unless the implementation exposes a strong need; the current magic-wand pain is inside MCP sleep-polling.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-04-27 | FX002-1 | Harness | No `docs/project-rules/harness.md` exists for this repo-specific dogfood fix. | Proceeded with the plan's repository checks and FX002 flight/log artifacts as the progress harness. |
| 2026-04-27 | FX002-1 | Contract | `inbox_list` direct calls and dispatcher calls share validation, so the contract test path needed async-safe dispatch earlier than expected. | Made `dispatchToolCall` promise-returning and covered invalid `waitMs` through dispatcher tests. |
| 2026-04-27 | FX002-2 | Test harness | Real MCP stdio tests execute the built `dist/mcp/server.js`, not the TypeScript source directly. | Rebuilt with `npm run build` before rerunning stdio coverage so the long-poll server path was actually exercised. |

---

## Implementation Record (2026-04-27)

| Area | Evidence |
|------|----------|
| Contract | `MAX_INBOX_WAIT_MS = 30000`, `InboxListInput.waitMs`, and `TOOL_CONTRACTS.inbox_list.inputSchema.properties.waitMs` define the bounded wait contract. |
| Runtime | `inbox_list` preserves immediate mode for omitted/zero `waitMs`; positive waits use the runner file watcher, re-check filters on changes and timeout, and return explicit `wait` metadata. |
| Async server path | `dispatchToolCall` now returns a promise and the real stdio MCP server handles long-poll JSON-RPC calls. |
| Docs/prompts | Coordinated preamble, canonical validator prompt/instructions, how-to guide, and no-context eval prompt all teach bounded `waitMs` instead of sleep-poll loops. |
| Validation | Targeted build/tests passed (`47` tests), then `just fft` passed (`427` tests, `9` skipped, audit `0` vulnerabilities). |

---

## Validation Record (2026-04-27)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth | System Behavior, Technical Constraints, Edge Cases & Failures, Domain Boundaries, Concept Documentation | 1 HIGH fixed, 1 MEDIUM fixed | ⚠️ → ✅ |
| Cross-Reference | User Experience, Integration & Ripple, Hidden Assumptions, Concept Documentation, Domain Boundaries | 0 | ✅ |
| Completeness/Risk | Edge Cases & Failures, Performance & Scale, Security & Privacy, Deployment & Ops, Technical Constraints, Hidden Assumptions | 1 HIGH fixed, 3 MEDIUM fixed | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Domain Boundaries, Technical Constraints, Deployment & Ops | 2 HIGH fixed | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 FX002 implementation | Precise API shape, files, tests, acceptance criteria, domain placement | Contract drift | ✅ | `waitMs` units/bounds and `wait` metadata are now specified in Proposed Fix; tasks include `types.test.ts`, `server.test.ts`, and async-safe dispatch/cleanup coverage. |
| no-context two-agent eval prompt | Inner agent must wait for milestones without sleep-polling; docs/prompts updated before eval | Test boundary | ✅ | `no-context-two-agent-eval-prompt.md` now requires `inbox_list({ "unread": true, "waitMs": 30000 })` or equivalent bounded long-polling. |
| canonical coordination-loop-validator assets | Prompt/instructions/docs must teach the new wait primitive consistently | Encapsulation lockout | ✅ | FX002-3 names `preamble-builder.ts`, canonical validator prompt/instructions, docs/how, and the eval prompt as required documentation updates. |
| MCP tool contract and tests | Coherent input/output shape and async-safe dispatch if required | Shape mismatch | ✅ | The dossier now defines `waitMs`, `wait: { requestedMs, elapsedMs, timedOut, matched }`, filter-aware matching, async-safe dispatch, and cleanup expectations. |

**Outcome alignment**: The artifact only partially supports “The outside contract should be clear enough that another agent can follow it as a script for a back-and-forth conversation.”

**Standalone?**: No — downstream consumers include plan-6 FX002 implementation, the no-context two-agent eval prompt, canonical validator assets, and MCP contract/tests.

**Fixes applied**:
- Defined `waitMs` as milliseconds, finite non-negative integer, capped at `30000`, with invalid values rejected via `MCP_INVALID_ARGUMENT`.
- Defined the `wait` result metadata shape and timeout/success field values.
- Added filter-aware match semantics for `unread`, `type`, `after`, and `limit`.
- Added deterministic watcher/timer cleanup expectations for match, timeout, error, and overlapping calls.
- Added missing `test/mcp/server.test.ts` and `test/mcp/types.test.ts` coverage to the quick check/tasks.
- Updated the flight plan to include async-safe dispatch and cleanup validation stages.
- Updated the no-context eval prompt to require bounded `waitMs` long-polling instead of arbitrary sleep-polling.

**Open issues**: None from validation.

Overall: VALIDATED WITH FIXES
