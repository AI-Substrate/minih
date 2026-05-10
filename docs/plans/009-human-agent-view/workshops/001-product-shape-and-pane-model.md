# Workshop: Product Shape and Pane Model

**Type**: CLI Flow / UX Model  
**Plan**: 009-human-agent-view  
**Spec**: Not created yet; research-first workshop  
**Created**: 2026-04-28T07:32:23+10:00  
**Status**: Review

**Related Documents**:
- [Research dossier](../research-dossier.md)
- [Ink/React TUI architecture research](../external-research/ink-react-tui-architecture.md)
- [Testing terminal TUIs research](../external-research/testing-terminal-tuis.md)
- [Workshop 006: One Agent Mode and Message Semantics](006-one-agent-mode-and-message-semantics.md)

**Domain Context**:
- **Primary Domain**: `cli` — owns user-facing commands, terminal presentation, JSON envelope discipline, and SDK composition wiring.
- **Related Domains**: `runner` provides run artifacts and event/state contracts; `adapter` provides normalized event types and `SessionSender`; `mcp` remains private inside-only and is not a public UI dependency.

---

## Purpose

Clarify the minimum useful human operator console for minih agent runs. This workshop defines panes, command entry points, mode labels, and mock-up scenarios so the scratch prototype and future implementation can aim at the same product shape.

## Key Questions Addressed

- What is the minimum useful operator console without overbuilding a dashboard?
- Which panes should exist, and what data does each pane own?
- How should start-and-view and attach-view feel identical while still exposing different capabilities?
- What should be scrollable, follow-mode, or fixed?
- Which interactions must exist in the first prototype?

---

## Design Principles

1. **Readable first**: the current pain is event/token dumping; grouping and labels matter more than density.
2. **One agent mode**: every run is shown as outside actor plus inside agent; do not expose coordinated/non-coordinated product modes.
3. **One console, two acquisition paths**: starting a run and attaching to a run should land in the same visual UI.
4. **Capabilities must be honest**: read-only attach should not pretend it can send/pause unless message delivery is available.
5. **stdout stays machine-readable**: the TUI is a human stderr/raw-TTY surface, never a stdout renderer.
6. **Terminal scrollback is a feature**: avoid alternate-screen dependence until the scratch prototype proves it is needed.
7. **Panes render a view model**: React components should not parse raw `events.ndjson`, inbox lanes, or state files.

---

## Command Surface

### Proposed Commands and Modes

| Command | Purpose | Opens TUI? | Control Capability |
| --- | --- | --- | --- |
| `minih run <slug> --human` | Start a fresh run and enter human view immediately. | Yes | Send outside messages when the run can accept input. |
| `minih view <slug>` | Attach to latest active run when unambiguous. | Yes | Send outside messages when delivery is available; otherwise read-only. |
| `minih view <slug> --run <runId>` | Attach to a specific run. | Yes | Depends on run state and input delivery availability. |
| `minih view <slug> --snapshot` | Print a one-shot human-readable summary and exit. | No full TUI | None. |
| `minih view <slug> --json` | Potential future machine output. | No | None. |

**Decision**: use `view` as the attach command name in planning. It is neutral, works for active and completed runs, and does not overload `connect` or `tail`.

**Workshop Run Decision**: plan for both surfaces. `minih run <slug> --human` is the start-and-view path; `minih view <slug> [--run <id>]` is the attach path. If implementation needs to stage delivery, `view` can ship read-only first, but the product language should reserve both concepts from the start.

---

## Run/View State Labels

The UI must label run state and input capability explicitly. These are not agent modes.

| Label | Meaning | Send Input | Pause Agent | Source |
| --- | --- | --- | --- | --- |
| `starting` | Run started but session ID/sender not ready yet. | Disabled | Disabled | Same process run. |
| `active / input available` | Active run can accept outside messages from this view. | Enabled | UI follow pause only. | `run --human` or attach with delivery. |
| `active / input read-only` | Active run is readable but this view cannot deliver messages. | Disabled | UI follow pause only. | `view`. |
| `completed` | Run has `completed.json`; transcript and summary only. | Disabled or resume-hint only. | Not applicable. | `view --run`. |

**Why this matters**: "same experience" means same panes, terms, and navigation. Input availability can vary, but the agent model does not.

---

## Pane Layout

### First Mock-up Layout

```text
+--------------------------------------------------------------------------------+
| minih human view | agent: coordination-loop-validator | run: 2026-... | active |
| session: 73e9... | mode: live-control | events: 4812 | tools: 40 | 05:36    |
+---------------------------------------------+----------------------------------+
| Transcript                                  | Tools                            |
|                                             | - bash: running                  |
| Outside actor: milestone area-1 ready       | - mcp inbox_list: ok             |
| Inside agent: I see area-1. I will validate | - check report.json: failed      |
|                                             +----------------------------------+
| Inside agent: The schema failed, repairing  | Coordination                     |
|                                             | outside -> milestone area-1      |
| Inside agent: PASS. Report rewritten        | inside  -> ack area-1            |
|                                             | state   -> inside reviewing      |
|                                             +----------------------------------+
|                                             | State / Output                   |
|                                             | inside: reviewing                |
|                                             | outside: in-progress             |
|                                             | output: degraded -> repaired     |
+---------------------------------------------+----------------------------------+
| Send outside message...                                   follow:on  ctrl+c quit |
+--------------------------------------------------------------------------------+
```

### Pane Responsibilities

| Pane | Primary Job | Scroll? | Data Source |
| --- | --- | --- | --- |
| Header | Identity, run status, capability mode, counters. | No | run manifest, status view, completed metadata. |
| Transcript | Human-readable outside-actor / inside-agent conversation. | Yes | grouped `AgentEvent` stream plus delivered outside messages. |
| Tools | Active and recent tool calls/results. | Yes | `tool_call`, `tool_result`, tool durations when available. |
| Messages / Activity | Messages, acks, state transitions, outside/inside events. | Yes | outside/inside message records, state history, selected event markers. |
| State / Output | Inside/outside status, output path, validation state. | No or small scroll | state files, completed metadata, check/validate events. |
| Input Footer | Draft message, send status, capability hints, key help. | No | control capability state. |

### Pane Priority

| Terminal Width | Layout |
| --- | --- |
| Wide (>=120 cols) | Split transcript left and workbench right; user can expand either side. |
| Medium (90-119 cols) | Transcript top, secondary panes stacked below with compact rows. |
| Narrow (<90 cols) | Single-column tabs/sections: transcript, tools, coordination, state. |

**Mock-up guidance**: implement only wide and medium initially. Narrow can show a clear "terminal too narrow" warning in scratch.

### Split Pane Behavior

Iteration feedback: the left transcript and right workbench should be a real split, not a fixed dashboard. Users should be able to expand either side depending on whether they are reading the conversation or inspecting tools/coordination.

| Action | Behavior |
| --- | --- |
| Default | 65/35 split: transcript has priority, workbench remains readable. |
| Expand transcript | 80/20 split: tool/coordination rows compact to one-line summaries. |
| Expand workbench | 45/55 split: transcript remains visible, workbench shows richer tools/coordination detail. |
| Reset split | Return to default 65/35. |

Suggested keys for prototype: `[` expands transcript, `]` expands workbench, `=` resets split. Exact keys can change after scratch testing.

---

## Transcript Rules

### Event Grouping

| Event Type | Transcript Behavior |
| --- | --- |
| `user_prompt` | Show as `Outside actor:` or `Prompt:` block. |
| `text_delta` | Coalesce by `messageId`; do not render one token per line. |
| `message` | Finalize block; suppress duplicate final if same as accumulated deltas. |
| `thinking` | Default collapsed as "thinking..." with last short excerpt; expandable later. |
| `session_error` | Show inline error marker and in status pane. |

### Example

Raw event stream:

```text
text_delta m1 "Hel"
text_delta m1 "lo"
message m1 "Hello"
```

Human transcript:

```text
Inside agent:
Hello
```

---

## Tool Pane Rules

### Tool Lifecycle Rows

| State | Display |
| --- | --- |
| Started | `running` with tool name and compact input summary. |
| Completed | `ok` with short output summary and duration if known. |
| Error | `error` with first useful error line. |
| Large output | collapsed `N lines / M chars`, with future expand affordance. |

### Example

```text
Tools
- bash npm test                         running  00:08
- mcp inbox_list waitForAny=milestone   ok       00:02
- minih check report.json               error    schema: /summary required
```

---

## Messages / Activity Pane Rules

The messages/activity pane should answer: "What passed between outside and inside, and what did each side think the state was?"

### Timeline Rows

| Row Type | Example |
| --- | --- |
| outside message | `outside -> milestone area-1 ready` |
| inside ack | `inside ack -> area-1 ready` |
| inside feedback | `inside -> feedback area-1 PASS` |
| state transition | `state inside: idle -> reviewing` |
| validation marker | `output check: degraded -> repaired` |
| retro/magic wand | `retro: wants coordination timeline` |

### Ack Correlation

If `InboxMessage.ackOf` references another message ID, render it as a child row or linked summary, not an unrelated message.

```text
outside milestone area-1 ready   id 01K...
  inside ack                     ackOf 01K...
  inside feedback PASS           ackOf 01K...
```

---

## Input Footer

### Footer States

| State | Text |
| --- | --- |
| Same-process ready | `Send outside message: [draft...]   Enter send | Ctrl+F follow | Ctrl+C quit` |
| Starting | `Waiting for session... input disabled` |
| Attached read-only | `Attached read-only. Use outside-send or run with --human for live input.` |
| Completed | `Run complete. Use minih resume <slug> --run <runId> "<message>" for follow-up.` |
| Control unavailable | `Original runner not reachable. View is read-only.` |

### First Keybindings

| Key | Action | Notes |
| --- | --- | --- |
| Enter | Send an outside-actor message when input is enabled. | For coordinated active runs, this should preserve outside-lane visibility and live delivery. |
| Ctrl+C | Clean up TUI and exit. | Must restore terminal. |
| Ctrl+F | Toggle follow latest / scroll paused. | UI-only pause. |
| PageUp/PageDown | Scroll active pane. | Prototype can fake this. |
| Tab | Cycle active pane. | Optional in scratch. |

---

## Mock-up Fixture Scenarios

The scratch prototype should include at least these fixtures:

| Fixture | Purpose |
| --- | --- |
| `active-simple.json` | Agent sends message, calls one tool, completes. |
| `active-token-stream.json` | Many `text_delta` events coalesced into one readable message. |
| `coordination-rich.json` | Outside milestones, inside acks, state transitions. |
| `degraded-repair.json` | Check failure, schema repair, validation pass. |
| `attached-read-only.json` | Shows disabled footer and attach capability label. |

---

## Open Questions

### Q1: Should the TUI use alternate screen?

**RESOLVED FOR ITERATION 001**: No. Default should avoid alternate screen for dogfood because prior pretty-mode learnings favored terminal scrollback. Revisit only after the scratch prototype proves normal scrollback is worse.

### Q2: Should `view` attach to completed runs by default?

**RESOLVED FOR NOW**: Prefer latest active. If no active run exists, show a completed-run transcript only if unambiguous and clearly labeled `completed`; otherwise ask for `--run`.

### Q3: Should "send" in the footer be the same as `outside-send`?

**REVISED AFTER WORKSHOP 006**: Footer input is an **outside actor** message, not a human-only chat channel. The UI should not expose coordinated/non-coordinated agent modes. If input delivery is available, Enter sends an outside message; if not, the footer explains why input is read-only.

### Q4: Should thinking be visible?

**RESOLVED FOR MOCK-UP**: Show collapsed thinking status by default. Avoid filling transcript with reasoning/thinking deltas.

---

## Workshop Run Outcome

The first mock-up should optimize for a human answering three questions quickly:

1. **What is the agent doing right now?** Header + transcript + active tool row.
2. **What is moving between outside and inside?** Coordination timeline with ack/state grouping.
3. **Can I act from here?** Footer mode label: `live-control`, `attached-read-only`, or `completed`.

### Iteration 001 Pane Order

| Priority | Pane | Rationale |
| --- | --- | --- |
| 1 | Header/status | Establish run identity and capability mode before anything else. |
| 2 | Transcript | Main human reading surface; must fix token-line dumping. |
| 3 | Workbench side column | Tools, coordination, and state/output are supporting context. |
| 4 | Input footer | Always visible, but honest about disabled/read-only states. |

### Iteration 001 Visual Rule

Use **one resizable transcript/workbench split**, not a dense four-quadrant dashboard. The workbench can stack `Tools`, `Coordination`, and `State / Output` because those panes are read-mostly context, but either side must be expandable.

---

## Quick Reference

```bash
# Start and enter human view
minih run coordination-loop-validator --human

# Attach to latest active run
minih view coordination-loop-validator

# Attach to a specific run
minih view coordination-loop-validator --run 2026-04-28T07-10-06-449Z-e403

# Snapshot without full TUI
minih view coordination-loop-validator --run 2026-... --snapshot
```

## Implementation Notes

- First build the panes against synthetic `HumanViewModel` fixtures.
- Do not wire live send/pause in attach mode until Workshop 002 is resolved.
- Preserve `tail`, `status`, and `connect`; the human view composes their concepts rather than replacing them.
