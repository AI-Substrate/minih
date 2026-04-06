# Pretty Mode — Human-Friendly Agent Display

**Mode**: Simple

📚 This specification incorporates findings from [research-dossier.md](./research-dossier.md)

## Summary

Add a `--pretty` flag to `minih run` that replaces the scrolling line-per-event terminal output with a compact, in-place updating display. The current output produces 400+ lines of fragmented text for a 30-second agent run — unreadable for humans. Pretty mode accumulates streaming deltas, shows tool call lifecycle with live status updates, and renders a clean final summary.

**WHY**: minih agents are high-frequency dev-loop tools — developers run them hundreds of times. Every run currently requires scrolling through pages of timestamped fragments to understand what happened. A pretty display makes agent execution feel like watching a build tool, not reading a debug log.

## Goals

- Replace fragmented line-per-delta output with clean streaming text — thinking in gray italic, normal text in white, tool calls formatted clearly
- Accumulate streaming deltas into natural flowing text instead of one line per 5-char chunk
- Eliminate the delta/final duplication (SDK sends streaming chunks then a consolidated final — currently both are shown)
- Show tool calls with name, input preview, and output result — formatted readably
- Pin the agent's current intent (from `report_intent` tool calls) as an in-place updating status line at the bottom of the terminal
- Normal terminal scrolling — no TUI, no scroll override, can scroll back up
- Render a clean summary when the agent finishes
- Degrade gracefully in non-TTY environments (fall back to current verbose behavior)

## Non-Goals

- Full TUI dashboard (panels, scrollable regions, interactive controls)
- In-place updating status panels or live counters (except the pinned intent line)
- Changing the JSON envelope output on stdout (display changes only affect stderr)
- Modifying the NDJSON event recording (all events still written to events.ndjson)
- Adding pretty mode to other commands (list, doctor, etc.) — they're already clean
- Scroll position control or alternate screen buffer

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| runner | existing | **modify** | Add pretty display module alongside existing display.ts |
| cli | existing | **modify** | Wire `--pretty` flag in run command, pass display mode through |
| adapter | existing | **consume** | No changes — AgentEvent types are already sufficient |

No new domains needed. The change is contained within the existing display pipeline.

## Research Context

From the research dossier, the key findings are:

1. **Display pipeline**: `run.ts` → `runAgent(onEvent)` → `handleEvent` → `displayEvent()` → stderr. TTY-gated — non-TTY already skips display.
2. **Duplication**: SDK emits `reasoning_delta` (chunks) AND `reasoning` (final), both translated to `thinking` events. Same for `message_delta`/`message`. Display shows all of them.
3. **Event volume**: A 30s hello-world run produces ~400 events, ~100+ thinking deltas, 3-4 tool calls.
4. **Recommended approach**: `log-update` + chalk for lightweight in-place terminal updates.
5. **No existing cursor control**: display.ts uses only `process.stderr.write()` with newlines.

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1 (display.ts refactor + run.ts flag change), I=0 (no new deps — chalk already available, ANSI cursor for intent pin only), D=0 (no state changes), N=0 (well-specified), F=0 (standard), T=1 (needs tests for delta accumulation)
- **Total P**: 2 → CS-2
- **Confidence**: 0.9
- **Assumptions**: chalk supports italic; ANSI cursor save/restore works for pinned line
- **Dependencies**: None new — chalk already in package.json
- **Risks**: See table below
- **Phases**: Single phase — refactor display, wire flag, test

## Acceptance Criteria

1. Pretty mode is the **default** display when TTY is detected — current verbose scrolling becomes `--verbose` opt-in
2. Thinking text streams down the page in **gray italic** — accumulates delta chunks into natural flowing text (not one line per 5-char fragment)
3. Normal assistant text streams in **white** — standard terminal color
4. When a final consolidated `message`/`thinking` event arrives after deltas for the same content, the final is **suppressed** (no duplication)
5. Tool calls display clearly: tool name, input preview, and output result when complete — last 3–5 completed tools remain visible in the scroll, plus any currently pending tool
6. The agent's current **intent** (captured from `report_intent` tool calls) is printed as an inline styled one-liner when it changes — no ANSI pinning (tmux/ssh compatible)
7. Normal terminal scrolling — no alternate screen buffer, no scroll override, no cursor tricks, user can scroll back up
8. When the agent finishes, the pinned intent clears and a permanent summary block is printed
9. In non-TTY environments, pretty mode is skipped and falls back to current verbose behavior
10. `minih run <slug> --verbose` produces the current timestamped line-per-event scrolling output
11. The JSON envelope on stdout is unaffected by display mode
12. All events are still recorded to events.ndjson regardless of display mode

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pinned intent line flickers on fast event streams | Medium | Low | Use ANSI save/restore cursor; only redraw on intent change |
| Delta vs final detection fragile (messageId may be absent) | Medium | Medium | Use messageId when available; fall back to content-length heuristic |
| Thinking italic not supported in all terminals | Low | Low | Graceful degradation — just shows gray without italic |
| Terminal width causes awkward line wrapping | Medium | Low | Truncate tool previews to terminal columns - 10 |
| Breaking change: default display mode changes | Medium | Medium | Document in README; `--verbose` provides escape hatch |

## Open Questions

_All resolved — see Clarifications below._

## Testing Strategy

- **Approach**: Lightweight
- **Rationale**: Pretty display is mostly visual formatting. The testable logic is delta accumulation and final-event suppression.
- **Focus Areas**: Delta accumulation into flowing text, final event suppression when deltas already rendered, intent capture from `report_intent` tool calls
- **Excluded**: Visual layout testing (verify manually by running agents)
- **Mock Usage**: Targeted — use FakeAgentAdapter to emit controlled event sequences

## Documentation Strategy

- **Location**: README.md update — add note about display modes (`--verbose` for old behavior)
- **Rationale**: Small feature, one flag change, README already documents CLI reference

## Clarifications

### Session 2026-04-06

**Q1: Workflow Mode** → **Simple** — CS-2, single phase, quick path.

**Q2: Testing Strategy** → **Lightweight** — test delta accumulation + suppression logic, visual formatting verified manually.

**Q3: Default behavior** → **Pretty is the default.** Current verbose scrolling becomes `--verbose` opt-in. This inverts the original spec assumption.

**Q4: Tool call history** → **Show last 3–5 completed tools** + current pending tool. Gives context about what just happened.

**Q5: Thinking content** → **Stream all thinking text down the page** in light gray italic. Not collapsed, not in-place — natural terminal scrolling like a coding agent (Claude Code, Copilot CLI).

**Q6: Display model** → **Clean streaming, not TUI.** Thinking = gray italic, text = white, tool calls = formatted nicely. Normal terminal scrolling, no scroll override, can scroll back up. No in-place panels except the pinned intent line.

**Q7: Intent pinning** → **Yes.** Capture `report_intent` tool call data and pin as a persistent status line at the bottom. Updates in-place when intent changes.
