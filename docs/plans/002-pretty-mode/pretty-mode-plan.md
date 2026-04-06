# Pretty Mode Implementation Plan

**Mode**: Simple
**Plan Version**: 1.1.0
**Created**: 2026-04-06
**Spec**: [pretty-mode-spec.md](./pretty-mode-spec.md)
**Status**: DRAFT
**DYK Applied**: 2026-04-06 — 5 insights, plan v1.0→v1.1

## Summary

Replace minih's default `minih run` display with clean streaming output — thinking in gray italic, normal text in white, tool calls formatted clearly, and intent changes printed inline. The current verbose line-per-event output becomes opt-in via `--verbose`. No new dependencies — uses chalk (already installed). No ANSI scroll regions or cursor tricks (tmux/ssh compatible).

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | **modify** | New pretty display module, refactor existing display.ts |
| cli | existing | **modify** | Wire `--verbose` flag, change default display mode |
| adapter | existing | **modify** | Add `isDelta` field to thinking events (2-line change) |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/runner/pretty.ts` | runner | internal | NEW — pretty display: event accumulation, streaming text, inline intent |
| `src/runner/display.ts` | runner | internal | MODIFY — rename exported functions to clarify "verbose" role |
| `src/runner/index.ts` | runner | contract | MODIFY — export new pretty display handler |
| `src/cli/commands/run.ts` | cli | internal | MODIFY — add `--verbose` flag, switch default to pretty, SIGINT cleanup |
| `src/adapter/events.ts` | adapter | contract | MODIFY — add `isDelta?: boolean` to AgentThinkingEvent |
| `src/adapter/sdk-copilot.ts` | adapter | internal | MODIFY — set `isDelta: true/false` on thinking events |
| `test/runner/pretty.test.ts` | runner | internal | NEW — delta accumulation, suppression, intent capture tests |
| `README.md` | — | — | MODIFY — document display modes |

## Harness Strategy

Harness: Not applicable — minih IS the CLI tool. Validation via `npm run build && npx minih run hello-world`.

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Both `reasoning_delta` and `reasoning` SDK events translate to `thinking` with no delta/final marker. | **DYK #5**: Add `isDelta?: boolean` to `AgentThinkingEvent.data`. Adapter sets `true` for reasoning_delta, `false` for reasoning. Pretty mode skips `isDelta: false`. 2-line adapter change. |
| 02 | High | `text_delta` and `message` events carry optional `messageId` — can suppress message finals, but `messageId` is `string | undefined`. | **DYK #2**: Two-layer suppression: (1) messageId match when available, (2) fallback boolean flag "am I in a delta stream?" — if deltas were accumulating and a `message` arrives, suppress it regardless. |
| 03 | High | `report_intent` is a regular `tool_call` event with `toolName === 'report_intent'`. Input contains `{intent: "..."}`. | Detect in pretty handler, extract intent string, print inline as styled one-liner. No ANSI pinning. |
| 04 | High | No existing tests for display.ts. | Add lightweight tests for new pretty.ts logic (accumulation, suppression, intent capture). Don't test visual output. |
| 05 | High | **DYK #1**: ANSI cursor save/restore breaks with scrolling content. Scroll regions (`\x1b[r`) are fragile in tmux/split panes. | **Drop pinned intent.** Print intent inline as a styled one-liner when it changes. Works everywhere — tmux, ssh, VS Code terminal, dumb terminals. |
| 06 | Medium | `runAgent` signature is `(adapter, definition, config, onEvent?, agentsDir?)` — no display mode param. Pretty mode is just a different `onEvent` callback. | No API change needed. `run.ts` creates the appropriate handler based on `--verbose` flag. |
| 07 | Medium | **DYK #3**: In clean streaming, "tool history" is just terminal scroll history. No buffer needed. | Simplify tool display — just format tool_call and tool_result nicely as they scroll by. No re-rendering or history buffer. |
| 08 | Medium | **DYK #4**: SIGINT handler in run.ts must clean up PrettyDisplay state (flush accumulated text). | Give PrettyDisplay a `cleanup()` method. SIGINT handler calls it before exit. |

## Implementation

**Objective**: Replace default display with clean streaming output; make current verbose mode opt-in.
**Testing Approach**: Lightweight — test delta accumulation, message suppression, and intent capture logic. Visual formatting verified manually.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Add `isDelta` to thinking events | adapter | `src/adapter/events.ts`, `src/adapter/sdk-copilot.ts` | `AgentThinkingEvent.data` has `isDelta?: boolean`. Adapter sets `true` for `reasoning_delta`, `false` for `reasoning`. Existing display.ts unaffected (field is optional). | DYK #5. 2-line adapter change + 1-line type change. |
| [x] | T002 | Create PrettyDisplay class | runner | `src/runner/pretty.ts` | Class handles all event types: `thinking` (isDelta=true) → gray italic streaming text, `thinking` (isDelta=false) → suppressed, `text_delta` → white streaming text (accumulates, sets inDeltaStream flag), `message` → suppressed when inDeltaStream or messageId matches, `tool_call` → formatted with name + preview (report_intent captured as intent), `tool_result` → ✓/✗ with output preview, `usage` → silent, `session_error` → prominent red. Has `cleanup()` to flush buffers. | Per findings 01-03, 07, 08. ~150 LOC. |
| [x] | T003 | Wire --verbose flag in run command | cli | `src/cli/commands/run.ts` | Add `--verbose` flag. Default (no flag + TTY) uses PrettyDisplay. `--verbose` or non-TTY uses current displayEvent. PrettyDisplay.cleanup() called in SIGINT handler. Update displayHeader/displaySummary calls — pretty mode uses its own header. | Per findings 06, 08. Default-flip. |
| [x] | T004 | Export from barrel | runner | `src/runner/index.ts` | Export `PrettyDisplay` from runner barrel. | Keep import surface clean. |
| [x] | T005 | Write tests | runner | `test/runner/pretty.test.ts` | Tests: (1) thinking isDelta=true accumulates into buffer, (2) thinking isDelta=false suppressed, (3) message suppressed when messageId matches prior deltas, (4) message suppressed when inDeltaStream flag is set (no messageId), (5) message shown when no prior deltas, (6) report_intent tool_call captured as intent string, (7) cleanup() flushes accumulated text. | Lightweight — test logic, not visual output. |
| [x] | T006 | Update README | — | `README.md` | Document: pretty is default, `--verbose` for old scrolling output. Add note in CLI reference section. | Small change. |
| [x] | T007 | Manual verification | — | — | Run `minih run hello-world` (pretty default), `minih run hello-world --verbose` (old behavior). Verify: thinking gray italic, text white, tools formatted, intent inline, no duplication, SIGINT cleans up. | Visual verification — can't automate. |

### Acceptance Criteria

- [ ] AC1: `minih run <slug>` (default) produces clean streaming output — thinking gray italic, text white, tools formatted
- [ ] AC2: Thinking deltas (`isDelta: true`) accumulate into flowing text, not one line per fragment
- [ ] AC3: Thinking finals (`isDelta: false`) suppressed — no duplication
- [ ] AC4: `message` events suppressed when `text_delta` events were streaming (via messageId or inDeltaStream flag)
- [ ] AC5: Tool calls show `🔧 name  preview`, results show `✓`/`✗` with output preview
- [ ] AC6: Intent changes (from `report_intent` tool calls) printed inline as styled one-liner
- [ ] AC7: `--verbose` flag produces current timestamped line-per-event scrolling output
- [ ] AC8: Non-TTY falls back to verbose behavior automatically
- [ ] AC9: JSON envelope on stdout unaffected
- [ ] AC10: events.ndjson records all events regardless of display mode
- [ ] AC11: SIGINT cleanup flushes PrettyDisplay state
- [ ] AC12: `just fft` passes (lint, format, build, typecheck, test, audit)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `messageId` absent on text_delta — suppression misses | Medium | Medium | Two-layer: messageId + inDeltaStream boolean flag |
| Default change surprises users | Low | Medium | `--verbose` escape hatch; document in README |
| Terminal width causes tool preview wrapping | Medium | Low | Truncate to `process.stderr.columns - 10` |
| SIGINT leaves partial output | Medium | Low | PrettyDisplay.cleanup() in SIGINT handler |
| `isDelta` adapter change breaks existing consumers | Low | Low | Field is optional (`isDelta?: boolean`), backward compatible |
