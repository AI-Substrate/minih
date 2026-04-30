# Fix FX002: Phase 2 Demo Polish — Rendering, Transcript Content, Lifecycle

**Created**: 2026-04-30
**Status**: Complete
**Plan**: [../human-agent-view-plan.md](../human-agent-view-plan.md) — Phase 2
**Source**: User-reported issues during manual smoke of `minih run code-review-companion --human` and `minih view <slug>` (2026-04-30 ~16:25)
**Domain(s)**: cli (modify), runner (extend reducer for thinking events)

---

## Problem

Phase 2 shipped functional but **not demo-ready**. Manual smoke against the live `code-review-companion` companion surfaced four user-visible defects:

1. **Append-mode rendering / scroll accumulation**: Ink should repaint in-place but the user sees stacks of empty bordered panes piling up at the top of the terminal as new model snapshots arrive. Layout is taller than the terminal; cursor scrolls off the anchor; old frames stay visible.
2. **Empty transcript rows**: every "Inside agent" row in the transcript is blank. The reducer pairs `text_delta` and `message` events by `messageId`, but in practice the SDK uses **different `messageId`s for deltas vs the finalising `message` event** (verified: `text_delta.data.messageId = "b511c417…"` vs `message.data.messageId = "77ddb0b6…"`). As a result, message events finalise with empty content and the user sees the actor label only. Separately, the reducer ignores `thinking` events entirely (266 of them in the sample run) — the "what is the agent doing right now" signal is missing.
3. **Workbench column collapsed**: the right-hand workbench pane renders as a single very narrow column ("State outsid · insid—:") because `flexGrow` ratios + minimum-width children produce an unworkable width on real terminals.
4. **Ctrl-C does not exit the process**: SIGINT triggers `humanHandle.unmount()` but the parent `runAgent` promise (or `view`'s `await handle.waitUntilExit()`) is still pending, so the TUI disappears yet the process keeps running until the SDK session naturally ends.

These together make the TUI demo-broken: the user can't read what the agent is doing, the layout looks chaotic, and they can't quit cleanly.

## Proposed Fix

Five surgical changes scoped tightly:

1. **Cap layout height + use Ink `<Static>` for completed transcript rows** so frame redraws stay anchored to the bottom of the terminal and old frames overwrite cleanly. Total layout target: ≤ `process.stderr.rows - 2` rows.
2. **Reducer: include `thinking` events in transcript** as a new `actorLabel: 'Inside agent (thinking)'` row, coalesced via the existing delta buffer pattern keyed by an internal `__thinking-<n>` slot when no `messageId` is present (the SDK emits `thinking` deltas without messageIds). Also relax the `text_delta` → `message` pairing: when `message.content` is empty AND no buffer matches `messageId`, show the most-recent unfinalised `text_delta` buffer's content keyed by **insertion order** (`*` heuristic — last-in wins) rather than letting the row finalise as empty.
3. **Workbench layout**: replace `flexGrow: transcriptFlex` with explicit `width="60%"` for transcript-side and `width="40%"` for workbench-side; remove the fragile `flexGrow` ratio entirely. Set `minWidth` on the workbench so it never collapses below 30 columns.
4. **Ctrl-C exits cleanly**: `view.ts` and `run.ts` SIGINT handlers must `process.exit(130)` AFTER `handle.unmount()` returns. The current code swallows SIGINT after unmount; we make it terminal.
5. **Disable transcript line wrapping that pushes content down** — set `<Box flexShrink={0}>` on transcript rows and use `truncate` text wrapping so each row fits its column.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| cli | modify (internal) | Layout fixes in `app.tsx`, transcript content fallback in `panes/transcript.tsx`, SIGINT exit in `view.ts` and `run.ts`, workbench width in `app.tsx` |
| runner | extend (internal — reducer pure logic) | `human-view-model.ts` `projectTranscript` now handles `thinking` events as a new transcript row class; existing `TranscriptEntry.actorLabel` union widens to include the thinking label. **Contract change** to the reducer's input handling is additive (new event handled) but the `actorLabel` enum is a public type — see Notes. |

**Contract surface impact**: `TranscriptEntry.actorLabel` is a public union literal type in `src/runner/types.ts`. Adding a new variant (`'Inside agent (thinking)'`) is a **non-breaking** widening for consumers that exhaustively-switch on it — but TypeScript's exhaustiveness check will flag missing cases. Phase 2's only consumer is `transcript.tsx` (we control it). Phase 3 hardening tests against this would already be authored after this fix lands. Acceptable.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX002-1 | **Reducer: handle `thinking` events.** Extend `human-view-model.ts:projectTranscript` (insert `case 'thinking':` immediately before `case 'message':` at ~line 154 — after `text_delta`, before `message`). Buffer thinking deltas keyed by an internal counter (no `messageId` present); finalise on next non-thinking event boundary. New transcript entry: `actorLabel: 'Inside agent (thinking)'`, `role: 'assistant'`, `status: 'final'` (or `'streaming'` while still buffering). Update `TranscriptEntry.actorLabel` union in `types.ts` to include the new variant. **Add `makeThinking(content, opts?)` helper to `human-view-fixtures.ts`** (mirrors `makeTextDelta`). Add reducer test fixture coverage in `human-view-model.test.ts`. **Audit existing 11 reducer tests for assertions that may flip** when actorLabel widens — fix any TS exhaustive-switch errors in test files at the same time. | runner | `/Users/jordanknight/substrate/minih/src/runner/human-view-model.ts`, `/Users/jordanknight/substrate/minih/src/runner/types.ts`, `/Users/jordanknight/substrate/minih/src/runner/human-view-fixtures.ts`, `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | New `case 'thinking'` lands at the specified location; `makeThinking()` exported; new test passes; existing 11 reducer tests still green (or updated explicitly to widen actorLabel match). | Affects public type `TranscriptEntry.actorLabel` (additive widening). Per validation 2026-04-30: blast radius includes fixture builders and any exhaustive-switch assertions in tests. |
| [x] | FX002-2 | **Reducer: text_delta/message pairing fallback.** When `message.content` is empty AND no `messageBuffers.get(messageId)` match exists, fall back to the most-recent unfinalised text_delta buffer (insertion-order tiebreak — track via parallel insertion-order array). This is a **heuristic** — record in JSDoc on `projectTranscript` that the SDK appears to use different messageIds for deltas vs message events and a structural fix is future work. Add a reducer test fixture pair (deltas + final message with mismatched IDs) verifying the fallback. **Verify**: do any existing tests assert "empty content on mismatch"? If yes, the heuristic flips them — update those tests with explicit comment "FX002-2: heuristic fallback now fills content from most-recent unfinalised buffer". | runner | `/Users/jordanknight/substrate/minih/src/runner/human-view-model.ts`, `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | New mismatched-id-pairing test passes; existing tests still green (any pre-existing empty-content assertions explicitly updated with comment). | Heuristic, not structural. Risk: silent drift if SDK semantics change. |
| [x] | FX002-3 | **Layout: cap height + workbench width + interleave Static safely.** In `app.tsx` root `<Box>`: **add** `height={process.stderr.rows ?? 30}` and keep `flexDirection="column"`. **Replace** the dynamic `transcriptFlex`/`workbenchFlex` constants and `flexGrow={transcriptFlex}` / `flexGrow={workbenchFlex}` props with: left column `<Box flexDirection="column" width="60%">`, right column `<Box flexDirection="column" width="40%" minWidth={30}>`. **Add** `flexShrink={0}` to header pane and footer pane wrappers. **Remove** the `transcriptFlex`/`workbenchFlex` arithmetic entirely. Split-layout state still toggles via fixed pane heights (transcript-expanded → tools pane height shrinks; workbench-expanded → transcript pane height shrinks; reset → even split inside the left column). **Static interleave rule**: `<Static>` is for **finalised + already-rendered transcript rows past the current `maxRows` window**, NOT for the active rendering window. The transcript pane keeps the **last `maxRows`** rows in dynamic render; older finalised rows go to `<Static>` once they fall out of the window. Streaming rows ALWAYS render dynamic (never Static). This avoids the "Static can't evict" problem because we Static-mount AFTER rows scroll out of the window, not while they're visible. **Document the rule as a JSDoc on the transcript pane.** Non-TTY note: when `process.stderr.isTTY === false`, the height fallback (30) is irrelevant because Ink writes log-mode lines; record in JSDoc. **Terminal resize**: not handled in v1 — record as known limitation in dossier Discoveries. | cli | `/Users/jordanknight/substrate/minih/src/cli/human/app.tsx`, `/Users/jordanknight/substrate/minih/src/cli/human/panes/transcript.tsx` | Manual smoke against `code-review-companion`: workbench column ≥ 30 chars wide; layout doesn't exceed terminal height; old frames don't pile up at top; rows past `maxRows` move to `<Static>` cleanly without flicker. | Per validation 2026-04-30 H1+H2: explicit Static-vs-dynamic boundary rule prevents the eviction conflict. 60/40 split on 80-col terminals = 32 vs 48 cols (acceptable; minWidth=30 protects). |
| [x] | FX002-4 | **Transcript: render thinking content + non-empty fallback + cap thinking noise.** Update `panes/transcript.tsx` to render the new `'Inside agent (thinking)'` rows in a distinct dim-italic style. When `entry.content` is empty (after FX002-2 fallback also fails), render `(no content yet)` in dim text instead of an actor-label-only row. Truncate per-row content at terminal width with `…` ellipsis. **Cap thinking-row noise**: render only the **last 5 thinking rows** before any non-thinking row, and replace older thinking rows with a single dim summary line `… N earlier thinking entries collapsed`. Final non-thinking transcript entries (user prompts, finalised messages, tool errors) are NEVER collapsed. | cli | `/Users/jordanknight/substrate/minih/src/cli/human/panes/transcript.tsx` | Manual smoke: thinking rows render dim-italic; ≤ 5 thinking rows visible at any time before a final message; empty rows show `(no content yet)`. | Per validation 2026-04-30 H3: 266 thinking events in the sample run is too noisy; cap at 5-rolling. |
| [x] | FX002-5 | **Ctrl-C exits cleanly with safe terminal restoration.** In `src/cli/commands/view.ts` and `src/cli/commands/run.ts`, change the SIGINT handler to: `(1) call handle.unmount()` (sync), `(2) wait for next macrotask via setImmediate(...)` so Ink's terminal-restore + cursor-reset side effects flush, `(3) then process.exit(130)` (130 = standard Ctrl-C exit code). Match the same path on SIGTERM. **Note (validated)**: today's code only calls `handle.unmount()` and lets `await handle.waitUntilExit()` drain — there's no explicit exit guarantee, so the process may continue waiting for the SDK session. The fix makes exit explicit and protects the terminal from being left in raw mode (Ink's cleanup includes `cli-cursor` show + raw-mode reset; setImmediate gives those a tick to land). **Verify post-fix**: after Ctrl-C in `--human` mode, the process exits within 2 seconds AND the user's terminal cursor is visible AND no zombie `minih-mcp-*` / copilot-sdk children remain. **Completed `view <slug>` auto-exit**: when the run is terminal at attach time (`runStatus ∈ {completed, failed}`), `view.ts` should print a final paint and then auto-exit on the user's first key press OR after 5s of no input — record as a follow-up if the dossier scope is too tight; otherwise add as a sub-bullet here. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/view.ts`, `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | Manual smoke: Ctrl-C unmounts TUI and exits within 2s; cursor visible after exit; `ps aux \| grep minih` shows no leftover children. Completed-run viewing exits on key-press or 5s timeout (or follow-up tracked). | Per validation 2026-04-30 H4 + M5: setImmediate guard for raw-mode cleanup; completed-view auto-exit added as sub-bullet. |

## Workshops Consumed

None. Plan 009's Workshops 001 (layout) and 003 (pause copy) remain authoritative; this fix doesn't deviate from them, only fixes implementation defects against them.

## Acceptance

- [ ] **A1 — Render stability**: Running `minih run code-review-companion --human` for ≥ 60s shows the TUI repainting in-place at the bottom of the terminal; no stack of empty bordered panes accumulates at top.
- [ ] **A2 — Transcript content visible**: Transcript shows actual reasoning ("Let me understand…", etc.) from `thinking` events AND finalised assistant messages with non-empty content. No row is just an actor label with nothing else.
- [ ] **A3 — Workbench readable**: Workbench column is at least 30 characters wide; "State outside / inside" labels render on one line each.
- [ ] **A4 — Ctrl-C exits**: After Ctrl-C in `--human` or `view` mode, the process exits within 2 seconds; no leftover `minih-mcp-*` or copilot-sdk children in `ps`.
- [ ] **A5 — `just fft` green**: All existing 682 tests still pass; new reducer tests added in FX002-1 + FX002-2 pass.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

**Implementation order**: FX002-1 → FX002-2 → FX002-3 → FX002-4 → FX002-5. Reducer changes (1+2) first since pane changes (3+4) consume the new transcript-entry shape. Lifecycle fix (5) last — independent.

**Estimated scope**: 5 tasks across 6 files (4 source, 1 test, 1 type). All within `cli` + `runner` domains. No domain-map changes. No new deps.

---

## Validation Record (2026-04-30)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth | Factual Accuracy, Concept Documentation, Hidden Assumptions, Domain Boundaries | 1 MED + 1 LOW (both folded into task notes) | ✅ |
| Completeness | Edge Cases & Failures, Hidden Assumptions, Deployment & Ops, Performance & Scale, User Experience, Integration & Ripple | 4 HIGH + 4 MED + 2 LOW (all addressed below) | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility | 1 MED + 2 LOW (all folded) | ⚠️ → ✅ |

**Lens coverage**: 9/12 (above the 8-floor).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Phase 3 snapshot mode | `feed.readSnapshot()` + same reducer should render `'Inside agent (thinking)'` identically without special-casing | shape mismatch | ✅ | FX002 is additive in the reducer; Phase 3 plan reuses the same `HumanViewModel`; the new label flows through automatically once the transcript renderer handles it. |
| /plan-6 implementor | Tasks self-contained with exact paths, Done When, and clear implementation anchors | encapsulation lockout | ✅ (after fix) | FX002-1 now specifies insertion line (~154 in `projectTranscript`); FX002-3 now spells out replace-vs-add prop changes explicitly. |
| Reducer test consumers | New fixture shape available + called out | test boundary | ✅ (after fix) | FX002-1 now explicitly adds `makeThinking()` helper to `human-view-fixtures.ts` and audits existing 11 tests for actorLabel widening fallout. |
| Companion-mode documentation | Docs note any user-visible TUI behavior drift | contract drift | ✅ | `AGENTS_README.md § Companion mode` is lifecycle/protocol focused; doesn't describe transcript rendering or layout, so no docs obligation. |

**Outcome alignment**: FX002 as shipped does advance "Make the agent run legible to a human as it happens, support attaching to a running run, and let an outside actor send messages from the same console without exposing the internal coordination mode," but only if the thinking-row rendering and layout fixes are completed alongside the reducer change.

**Standalone?**: No — three downstream consumers named in Vector with concrete needs.

### Issues addressed inline

| # | Sev | Lens | Issue | Action |
|---|-----|------|-------|--------|
| 01 | HIGH | Edge Cases | `<Static>` + new streaming row interleaving rule undefined | **FIXED**: FX002-3 now defines explicit "Static = past-window finalised; dynamic = current window; streaming = always dynamic" rule |
| 02 | HIGH | Performance | `maxRows=80` cap + `<Static>` (append-only) conflict | **FIXED**: FX002-3 Static-mounts AFTER rows scroll out of the maxRows window, not while visible |
| 03 | HIGH | UX | 266 thinking events overwhelm transcript | **FIXED**: FX002-4 caps at last-5-rolling thinking rows + dim summary line for older |
| 04 | HIGH | Hidden Assumptions | `process.exit(130)` after sync unmount may leave terminal in raw mode | **FIXED**: FX002-5 wraps in `setImmediate` to let Ink's cli-cursor + raw-mode reset flush before exit |
| 05 | MED | Edge Cases | Terminal resize unaddressed | **DEFERRED** with note in dossier: known v1 limitation, captured as future work |
| 06 | MED | Deployment & Ops | text_delta heuristic may break existing tests | **FIXED**: FX002-2 explicitly requires audit + comment-update on flipped assertions |
| 07 | MED | Integration & Ripple | actorLabel widening blast radius understated | **FIXED**: FX002-1 includes fixture builders + test exhaustive-switch audit |
| 08 | MED | UX | Completed `view <slug>` stays mounted forever | **FIXED**: FX002-5 sub-bullet adds key-press / 5s timeout auto-exit |
| 09 | MED | Factual Accuracy | SIGINT "swallowed" claim unverified | **FIXED**: FX002-5 reworded to "no explicit exit guarantee" |
| 10 | MED | Forward-Compat | `makeThinking()` fixture builder not called out | **FIXED**: FX002-1 now lists fixture file + helper |
| 11 | LOW | Concept Doc | actorLabel widening test-visibility | **FIXED**: FX002-1 audit clause |
| 12 | LOW | Forward-Compat | Insertion point in `projectTranscript` not specified | **FIXED**: FX002-1 specifies "~line 154, immediately before `case 'message':`" |
| 13 | LOW | Forward-Compat | Replace-vs-add ambiguity in FX002-3 | **FIXED**: FX002-3 now lists "add X / replace Y / remove Z" explicitly |
| 14 | LOW | Edge Cases | Non-TTY rows fallback only partially reasoned | **FIXED**: FX002-3 JSDoc clause |
| 15 | LOW | UX | 60/40 split arbitrary on 80-col terminals | **ACCEPTED**: 32/48 cols on 80-col is acceptable; minWidth=30 protects |

**Verdict**: ⚠️ VALIDATED WITH FIXES — 4 HIGH + 4 MED + 4 LOW addressed inline; 1 MED (terminal resize) deferred with rationale; 1 LOW accepted as is.
