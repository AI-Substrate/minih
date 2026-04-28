# Workshop: Ink/React Prototype

**Type**: Integration Pattern / Prototype Plan  
**Plan**: 009-human-agent-view  
**Spec**: Not created yet; research-first workshop  
**Created**: 2026-04-28T07:32:23+10:00  
**Status**: Review / Iteration 001

**Related Documents**:
- [Research dossier](../research-dossier.md)
- [Ink/React TUI architecture research](../external-research/ink-react-tui-architecture.md)
- [Testing terminal TUIs research](../external-research/testing-terminal-tuis.md)
- [Workshop 001: Product Shape and Pane Model](001-product-shape-and-pane-model.md)
- [Workshop 004: View Model and Timeline](004-view-model-and-timeline.md)
- [Workshop 006: One Agent Mode and Message Semantics](006-one-agent-mode-and-message-semantics.md)

**Domain Context**:
- **Primary Domain**: `cli` for eventual product UI.
- **Prototype Location**: `scratch/human-agent-view/`; scratch code is not a domain contract.
- **Related Domains**: `runner` supplies fixture shapes and eventual view model; adapter/MCP are not imported in scratch prototype.

---

## Purpose

Define a fast scratch prototype that lets us iterate on the human view layout, key handling, scrollback, and input affordances before adding Ink/React dependencies to the product package.

## Key Questions Addressed

- What should the scratch program prove?
- What data should it use?
- Which Ink behaviors need de-risking?
- What should not be productized yet?
- What output from the prototype should feed the next spec/plan?

---

## Prototype Goals

### In Scope

- Render the pane layout from Workshop 001.
- Use static and synthetic `HumanViewModel` fixtures from Workshop 004.
- Demonstrate grouped transcript, tool rows, coordination timeline, status header, and input footer.
- Support fake send by appending to local model state.
- Support `Pause scroll` as UI-only follow toggle.
- Test stderr/stdout behavior manually.

### Out of Scope

- No live SDK session.
- No real `SessionSender`.
- No run-scoped control lane.
- No production command registration.
- No package dependency decision beyond prototype evidence.
- No formal visual snapshot tests.

---

## Scratch Folder Shape

```text
scratch/human-agent-view/
  package.json              # optional scratch-only dependency sandbox
  README.md                 # how to run prototype and what to inspect
  fixtures/
    active-simple.json
    token-deltas.json
    coordination-rich.json
    degraded-repair.json
    attached-read-only.json
  src/
    app.tsx
    model.ts
    fixtures.ts
    panes/
      header.tsx
      transcript.tsx
      tools.tsx
      coordination.tsx
      state-output.tsx
      input-footer.tsx
```

**Note**: If adding a scratch-local `package.json` is awkward, use root dev dependencies only after explicit decision. Do not add product dependencies just to experiment.

---

## Prototype CLI

```bash
# Run default fixture
npx tsx scratch/human-agent-view/src/app.tsx

# Pick a fixture
npx tsx scratch/human-agent-view/src/app.tsx --fixture coordination-rich

# Simulate active stream
npx tsx scratch/human-agent-view/src/app.tsx --fixture token-deltas --play

# Force read-only attach mode
npx tsx scratch/human-agent-view/src/app.tsx --fixture attached-read-only
```

---

## UI Behavior to Prove

| Behavior | Success Signal |
| --- | --- |
| Pane layout | Wide terminal shows transcript left, side panes right. |
| Delta readability | Token fixture renders as one growing message, not one line per token. |
| Tool lifecycle | Running tool updates to ok/error in place or as a compact row. |
| Coordination timeline | Outside milestone, inside ack, state transition are readable together. |
| Input footer | Same-process fixture accepts fake message; read-only fixture disables input. |
| Follow toggle | Pausing follow stops auto-jump while new events count increases. |
| Ctrl+C cleanup | Terminal returns to normal prompt. |
| stdout safety | Prototype does not use stdout for UI logs. |

---

## Minimal Ink Shape

```tsx
import React, { useMemo, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';

function App({ initialModel }: { initialModel: HumanViewModel }) {
  const [model, setModel] = useState(initialModel);
  const [draft, setDraft] = useState('');
  const [followPaused, setFollowPaused] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }
    if (key.ctrl && input === 'f') {
      setFollowPaused((value) => !value);
      return;
    }
    if (key.return && model.input.enabled) {
      setModel(appendLocalUserMessage(model, draft));
      setDraft('');
      return;
    }
    if (input && !key.ctrl && model.input.enabled) {
      setDraft((value) => value + input);
    }
  });

  const view = useMemo(
    () => ({ ...model, input: { ...model.input, draft, followPaused } }),
    [model, draft, followPaused],
  );

  return <HumanView model={view} />;
}

render(<App initialModel={loadFixture()} />, {
  stdout: process.stderr,
  stderr: process.stderr,
  exitOnCtrlC: false,
});
```

This is deliberately small: no router, no global state library, no terminal widget suite.

---

## Fixture Example

```json
{
  "header": {
    "slug": "coordination-loop-validator",
    "runId": "2026-04-28T07-10-06-449Z-e403",
    "sessionId": "73e9ae6a-17b9-4af8-9dea-b5633bbd2831",
    "status": "active",
    "capability": "live-control",
    "elapsedMs": 336700,
    "eventCount": 4842,
    "toolCallCount": 40,
    "unreadCount": 0
  },
  "transcript": [
    {
      "id": "msg-1",
      "role": "assistant",
      "content": "I see milestone area-1. I will validate the handoff and reply.",
      "status": "final"
    }
  ],
  "tools": [
    {
      "id": "tool-1",
      "toolName": "minih check",
      "status": "error",
      "inputSummary": "check report.json",
      "outputSummary": "schema: missing required summary"
    }
  ],
  "coordination": [
    {
      "kind": "inbox",
      "lane": "outside",
      "type": "milestone",
      "subject": "area-1 ready for validation",
      "ackState": "acked"
    }
  ]
}
```

---

## Prototype Review Checklist

During dogfood, record answers:

| Question | Answer |
| --- | --- |
| Can I tell what the agent is doing within 5 seconds? |  |
| Is the transcript readable during token streaming? |  |
| Are tool calls useful without flooding? |  |
| Is coordination visible without running separate commands? |  |
| Is read-only attach obvious? |  |
| Does pause mean what the UI says it means? |  |
| Did stdout remain clean? |  |
| What was confusing? |  |
| Magic wand? |  |

---

## Transition to Product

Only after the prototype is useful:

1. Move pure model types/reducers into product code.
2. Add tests from Workshop 004 and external testing research.
3. Add `react`, `ink`, and maybe `ink-testing-library`.
4. Add CLI command registration.
5. Keep all Ink components in CLI-owned modules.
6. Add non-TTY fallback behavior before shipping.

---

## Open Questions

### Q1: Should scratch dependencies be local or root-level?

**RESOLVED FOR ITERATION 001**: Do not add product dependencies yet. If we build a runnable scratch program next, use a scratch-local setup or a zero-dependency ASCII simulator first; only add root `react`/`ink` once the layout feels right.

### Q2: Should prototype use alternate screen?

**RESOLVED FOR FIRST PASS**: No. Keep normal scrollback visible.

### Q3: Should prototype use real run artifacts?

**RESOLVED FOR ITERATION 001**: Start with synthetic fixtures. Add a real-run importer after the layout survives one iteration.

---

## Workshop Run Outcome

Iteration 001 should be a **readable operator console**, not a dense dashboard. It should put the transcript in the left/main reading position and stack operational context on the right, with a resizable split so either side can temporarily take more space.

### Mock-up Iteration 001: Wide Layout

```text
+----------------------------------------------------------------------------------+
| minih view  coordination-loop-validator                           active  05:36   |
| run 2026-04-28T07-10-06-449Z-e403   session 73e9ae6a   input available            |
+------------------------------------------------------+---------------------------+
| TRANSCRIPT                                           | WORKBENCH                 |
|                                                      |                           |
| Outside actor                                        | Tools                     |
| milestone: area-1 ready for validation               |  > bash npm test  running |
|                                                      |  ✓ inbox_list     00:02   |
| Inside agent                                         |  ! check report   schema  |
| I see area-1. I will validate the handoff and reply. |                           |
|                                                      | Messages                  |
| Inside agent                                         |  outside milestone area-1 |
| The report schema failed first. I am reading the     |    ↳ inside ack           |
| schema, rewriting the report, then checking again.   |    ↳ feedback PASS        |
|                                                      |  state inside reviewing   |
| Inside agent                                         |                           |
| PASS. Report rewritten and validated.                | State / Output            |
|                                                      |  inside  reviewing        |
|                                                      |  outside in-progress      |
|                                                      |  output  degraded->pass   |
+------------------------------------------------------+---------------------------+
| Send outside message...                                Enter send | Ctrl+F pause scroll |
+----------------------------------------------------------------------------------+
```

### Mock-up Iteration 001: Split States

Default split:

```text
+------------------------------------------------------+---------------------------+
| TRANSCRIPT 65%                                       | WORKBENCH 35%             |
+------------------------------------------------------+---------------------------+
```

Transcript expanded:

```text
+--------------------------------------------------------------------+-------------+
| TRANSCRIPT 80%                                                     | WORKBENCH   |
|                                                                    | Tools 3     |
| Inside agent                                                       | Coord 5     |
| The report schema failed first. I am reading the schema, rewriting | State ok    |
| the report, then checking again.                                   |             |
+--------------------------------------------------------------------+-------------+
```

Workbench expanded:

```text
+------------------------------------------+---------------------------------------+
| TRANSCRIPT 45%                           | WORKBENCH 55%                         |
| Inside agent                             | Tools                                 |
| PASS. Report rewritten and validated.    |  ! check report.json                  |
|                                          |    schema: /summary required          |
|                                          | Coordination                          |
|                                          |  outside milestone area-1             |
|                                          |    ack inside 01K...                  |
+------------------------------------------+---------------------------------------+
```

Suggested prototype keys:

| Key | Action |
| --- | --- |
| `[` | Expand transcript / shrink workbench. |
| `]` | Expand workbench / shrink transcript. |
| `=` | Reset to default split. |
| `Ctrl+F` | Pause/resume follow. |

### Mock-up Iteration 001: Attached Read-only Footer

```text
+----------------------------------------------------------------------------------+
| Attached read-only. Original runner control is not available.                     |
| Ctrl+F pause scroll | Ctrl+C close view | Use outside-send for coordination msgs  |
+----------------------------------------------------------------------------------+
```

### Mock-up Iteration 001: Completed Footer

```text
+----------------------------------------------------------------------------------+
| Run complete. Use: minih resume coordination-loop-validator --run 2026-... "..." |
+----------------------------------------------------------------------------------+
```

### What I Want to Learn From Iteration 001

| Question | Signal |
| --- | --- |
| Is the right column too busy? | If yes, split `Coordination` into a bottom pane. |
| Does the transcript have enough width? | If no, make tools/state collapsible. |
| Is `Workbench` the right label? | If no, try `Activity`, `Context`, or no label. |
| Is read-only attach clear enough? | If no, make mode a stronger header badge. |
| Does "Pause scroll" read correctly? | If no, try `Follow:on/off`. |
| Does split resizing feel necessary? | Yes: include split controls in scratch simulator. |

### Next Mock-up Move

If this shape feels directionally right, the next step is a scratch simulator with the `coordination-rich`, `token-deltas`, and `attached-read-only` fixtures plus split controls. If it feels wrong, iterate the ASCII layout first before touching code.

### Scratch Mock-up Implemented

The first runnable simulator now lives at:

```bash
node scratch/human-agent-view/src/app.mjs
```

Useful review commands:

```bash
node scratch/human-agent-view/src/app.mjs --fixture coordination-rich
node scratch/human-agent-view/src/app.mjs --fixture token-deltas --play
node scratch/human-agent-view/src/app.mjs --fixture attached-read-only
node scratch/human-agent-view/src/app.mjs --snapshot --split workbench --width 120 --height 34
```

It is intentionally zero-dependency and ASCII-only so the layout can be dogfooded before adding Ink/React to product code. It proves pane layout, split controls, fake outside-message send, read-only/completed labels, transcript scrollback, follow pause, and stderr-only rendering.

---

## Quick Reference

```text
Prototype proves:
  layout, readability, input, scroll pause, stderr rendering

Prototype does not prove:
  live attach control, real pause, SDK send, production deps
```
