# Research Dossier: --pretty mode for `minih run`

**Generated**: 2026-04-06T00:30:00Z
**Research Query**: "Add --pretty mode for human-friendly in-place terminal output"
**Plan**: 002-pretty-mode

---

## Executive Summary

### What Exists Now
The current display pipeline (`display.ts`) writes one line per event to stderr — every thinking delta, every tool call, every result. This produces ~400+ lines of scrolling output for a 30s agent run. Text deltas and thinking chunks arrive as tiny fragments (5-20 chars each), each on its own timestamped line, making the output nearly unreadable for humans.

### The Duplication Problem
The SDK sends **streaming deltas** (`assistant.message_delta` → `text_delta`, `assistant.reasoning_delta` → `thinking`) as small chunks, then a **final consolidated** event (`assistant.message` → `message`, `assistant.reasoning` → `thinking`). The current display shows ALL of them — you see the same text twice: once fragmented across 20+ lines, then once as the final version.

### What --pretty Would Do
Replace the scrolling line-per-event output with an in-place updating display that:
- Accumulates thinking/text deltas into a single updating line
- Shows current phase (thinking → tool call → result → thinking)
- Displays a live token counter and elapsed timer
- Suppresses final consolidated events when deltas already showed the content
- Renders a clean summary at the end

---

## Current Architecture

### Pipeline

```
run.ts (CLI command)
  ├── displayHeader()          → stderr (Unicode box)
  ├── displayPreflight()       → stderr (✓/✗ checks)
  ├── runAgent(adapter, def, config, isTTY ? displayEvent : undefined)
  │     └── adapter.run(onEvent: handleEvent)
  │           └── handleEvent:
  │                 ├── append to events.ndjson
  │                 ├── update stats (toolCallCount, eventCount)
  │                 └── onEvent?.(event)  →  displayEvent()  → stderr
  ├── displaySummary()         → stderr (plain text block)
  └── exitWithEnvelope()       → stdout (JSON)
```

### Key Files

| File | Role | LOC |
|------|------|-----|
| `src/runner/display.ts` | Format events → stderr | 120 |
| `src/runner/runner.ts` | Orchestration, event handling | ~370 |
| `src/cli/commands/run.ts` | CLI wiring, TTY detection | ~320 |
| `src/adapter/events.ts` | Event type definitions | 145 |
| `src/adapter/sdk-copilot.ts` | SDK → AgentEvent translation | ~250 |

### Event Flow & Duplication

```
SDK emits:                          minih translates to:        display.ts shows:
─────────                           ──────────────────          ─────────────────
assistant.reasoning_delta (chunk)  → thinking (small text)     → 💭 <5 chars>
assistant.reasoning_delta (chunk)  → thinking (small text)     → 💭 <5 chars>
assistant.reasoning_delta (chunk)  → thinking (small text)     → 💭 <5 chars>
assistant.reasoning (FINAL)        → thinking (full text)      → 💭 <80 chars>  ← DUPLICATE
                                                                
assistant.message_delta (chunk)    → text_delta (small text)   → <dim text>
assistant.message_delta (chunk)    → text_delta (small text)   → <dim text>
assistant.message (FINAL)          → message (full text)       → 📝 (N chars)   ← DUPLICATE
```

### Current Event Types (9 total)

| Event | Source | Frequency | Pretty Handling |
|-------|--------|-----------|-----------------|
| `text_delta` | message chunks | HIGH (~100s) | Accumulate in-place |
| `message` | final message | LOW (1 per turn) | Suppress if deltas shown |
| `thinking` | reasoning chunks + final | HIGH (~50s) | Accumulate in-place |
| `tool_call` | tool invocation | MEDIUM (~5-20) | Show name + status |
| `tool_result` | tool completion | MEDIUM (~5-20) | Update tool status ✓/✗ |
| `usage` | token metrics | LOW (~5-10) | Update counter |
| `session_idle` | session waiting | LOW (1) | Update status |
| `session_start` | session created | LOW (1) | Skip (already skipped) |
| `session_error` | errors | RARE | Show prominently |

---

## Recommended Approach

### Option: `log-update` + raw ANSI + chalk

**Why**: Lightest weight, ESM-compatible, pairs with existing chalk, handles streaming events naturally. `log-update` gives you exactly one thing: overwrite the last N lines of output. Perfect for an in-place status panel.

**Alternative considered**: `ink` (React for CLI) — too heavy for a status panel. `ora` — too limited (single line only).

### Pretty Display Layout

```
╭──────────────────────────────────────────────────╮
│  Agent: convention-check                        │
│  Model: claude-opus-4.6                         │
│  Status: 🔧 Running tool: bash                  │
╰──────────────────────────────────────────────────╯

  💭 Let me analyze the convention compliance...
  🔧 bash  npx minih doctor 2>/dev/null        ✓ 
  🔧 bash  cat agents/hello-world/prompt.md    ⏳

  ⏱ 45s   📊 in=21312 out=207   🔧 3 tools
```

### Key Design Decisions

1. **Accumulate deltas**: Buffer `text_delta` and `thinking` events, render the accumulated text on a single updating line (truncated to terminal width)
2. **Suppress finals**: When a `message` or final `thinking` arrives after deltas, don't render it — the deltas already showed the content
3. **Tool call lifecycle**: Show `🔧 toolName  input_preview  ⏳` on call, update to `✓`/`✗` on result (match by `toolCallId`)
4. **Live counters**: Update elapsed time and token count on every `usage` event
5. **Scroll on completion**: After agent finishes, clear the in-place panel and print the final summary (scrolling, permanent)

### Implementation Scope

| Component | Change |
|-----------|--------|
| `display.ts` | Add `PrettyDisplay` class with `update()` method, accumulator state |
| `run.ts` | Add `--pretty` flag, pass display mode to runner |
| `runner.ts` | Pass display mode through to event handler |
| `package.json` | Add `log-update` dependency |
| New: `src/runner/pretty.ts` | Pretty display implementation (~150-200 LOC) |

### Delta Accumulation Logic

```typescript
// Pseudocode for handling the delta/final duplication
class PrettyDisplay {
  private thinkingBuffer = '';
  private textBuffer = '';
  private lastDeltaMessageId?: string;

  handleEvent(event: AgentEvent) {
    switch (event.type) {
      case 'thinking':
        // Both deltas and finals come as 'thinking' type
        // If content is short (<100 chars), it's likely a delta — accumulate
        // If content matches accumulated buffer, it's the final — suppress
        if (this.thinkingBuffer.endsWith(event.data.content)) {
          return; // Final matches accumulated — suppress
        }
        this.thinkingBuffer += event.data.content;
        this.render();
        break;

      case 'text_delta':
        this.textBuffer += event.data.content;
        this.lastDeltaMessageId = event.data.messageId;
        this.render();
        break;

      case 'message':
        // If we've been accumulating deltas for this message, suppress
        if (event.data.messageId === this.lastDeltaMessageId) {
          this.textBuffer = ''; // Reset for next turn
          this.lastDeltaMessageId = undefined;
          return;
        }
        // Otherwise show it
        break;
    }
  }
}
```

---

## Prior Learnings

| Source | Learning | Relevance |
|--------|----------|-----------|
| Phase 4 execution | `tail` command is NOT an envelope command — direct stderr output | Pretty mode is also stderr-only, same pattern |
| Phase 5 review | display.ts upgraded from raw ANSI to chalk | Build on chalk, don't regress |
| DYK #1 (Phase 6) | Thinking deltas are both `reasoning_delta` (chunks) and `reasoning` (final) — both map to `thinking` event type | Core of the duplication problem |

---

## Next Steps

1. `/plan-1b-specify` to create the feature spec
2. Or just implement directly — this is a contained ~200 LOC change

**STOP**: Research complete. Awaiting user direction.
