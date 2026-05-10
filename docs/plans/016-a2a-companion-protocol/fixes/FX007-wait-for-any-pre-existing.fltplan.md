# Flight Plan: Fix FX007 — `wait_for_any` returns pre-existing unread inbox messages

**Fix**: [FX007 dossier](./FX007-wait-for-any-pre-existing.md)
**Status**: Ready
**Depends on**: None (foundation fix; workshop 002 § 3.3)

## What → Why

**Problem**: `wait_for_any({events: [{kind: 'inbox.message'}]})` snapshots the inbox at wait-entry and ignores those existing messages — only watchers fire on NEW arrivals. Pre-existing unread messages get silently orphaned until something else wakes the wait. Asymmetric with `pollInboxLane`'s `inbox_list({waitMs: ...})` which DOES return pre-existing matches immediately. Live demo + companion's farewell magicWand independently confirmed this gap.

**Fix**: Add a pre-render pass to `waitForAny` that emits unread, filter-matching messages from the peer lane immediately on entry. Widen `WaitForAnyResult.wait.matched` from `boolean` to `'pre-existing' | 'live' | 'mixed' | 'timeout'`. Migrate existing test assertions.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `runner` | Primary | `event-wait.ts` pre-render pass + matched enum |
| `runner` types | Primary | `WaitForAnyResult.wait.matched` widens |
| `mcp` | Tangential | Pure passthrough (verify) |
| `cli` | Tangential | One consumer (`outside.ts:678`) verified |

## Stages

- [ ] **Stage 1: Type widening** — `WaitForAnyResult.wait.matched` becomes a string union (`src/runner/types.ts`)
- [ ] **Stage 2: Producer migration** — `waitForAny`'s settlement paths emit the new strings (`src/runner/event-wait.ts`)
- [ ] **Stage 3: Test assertion migration** — `matched === true/false` → `matched === 'live'/'timeout'` across 4+ sites
- [ ] **Stage 4: Pre-render pass** — read peer lane on entry, emit unread + filter-matching messages, settle with `matched: 'pre-existing'` if any match
- [ ] **Stage 5: Regression tests** — pre-existing delivered; already-acked NOT delivered; state-only wait unchanged
- [ ] **Stage 6: Reverify original failure** — capture in log; no automated test needed
- [ ] **Stage 7: MCP passthrough verify** — confirm `src/mcp/tools/wait.ts` doesn't transform the result
- [ ] **Stage 8: Workshop link-back** — workshop 002 § 3.3 marked DONE

## Acceptance

- [ ] `matched` is enum, not boolean
- [ ] Pre-existing unread inbox message → immediate delivery, `elapsedMs < 50`, `matched: 'pre-existing'`
- [ ] Already-acked pre-existing NOT delivered
- [ ] State-only wait unchanged
- [ ] All existing tests + 3 new pass
- [ ] `just fft` green
