# Workshop: View Model and Timeline

**Type**: Data Model / Timeline Contract  
**Plan**: 009-human-agent-view  
**Spec**: Not created yet; research-first workshop  
**Created**: 2026-04-28T07:32:23+10:00  
**Status**: Review

**Related Documents**:
- [Research dossier](../research-dossier.md)
- [Testing terminal TUIs research](../external-research/testing-terminal-tuis.md)
- [Workshop 001: Product Shape and Pane Model](001-product-shape-and-pane-model.md)
- [Workshop 002: Attach and Control Channel](002-attach-and-control-channel.md)

**Domain Context**:
- **Primary Domain**: `runner` should own pure run artifact readers and model derivation if shared beyond the TUI.
- **Related Domains**: `cli` owns TUI rendering and command errors; `adapter` owns `AgentEvent`; `mcp` contributes data indirectly through run-scoped inbox/state files.

---

## Purpose

Define the canonical `HumanViewModel` and merged timeline that turn machine-shaped run artifacts into readable TUI panes. This model should be testable without Ink and reusable by scratch, CLI, and future reporting.

## Key Questions Addressed

- What TypeScript shape should TUI panes consume?
- How do raw agent events become readable transcript/tool rows?
- How do inbox messages, acks, state transitions, and validation events merge into one coordination timeline?
- How do we represent attach capability and control state?
- What fixtures should tests use?

---

## Source Artifacts

| Source | Path | Owner | Use |
| --- | --- | --- | --- |
| Agent events | `runs/<runId>/events.ndjson` | runner | Transcript, tools, usage, session status. |
| Live manifest | `runs/<runId>/run.json` | future runner | Live status, session ID, control availability. |
| Completion metadata | `runs/<runId>/completed.json` | runner | Final result, validation, artifacts, counts. |
| Inbox lanes | run-scoped inbox files | runner/mcp/cli | Outside/inside messages and acks. |
| State files | run-scoped state files | runner/mcp/cli | Current inside/outside status. |
| State history | `state/history.ndjson` | runner | Timeline of state transitions. |
| Output/check artifacts | `output/report.json`, validation results | runner/cli | Output pane and repair markers. |

---

## Top-Level Model

```ts
export interface HumanViewModel {
  header: HumanHeaderView;
  transcript: TranscriptEntry[];
  tools: ToolCallView[];
  coordination: CoordinationTimelineEntry[];
  state: StatePaneView;
  output: OutputPaneView;
  input: InputFooterView;
  diagnostics: ViewDiagnostic[];
}
```

### Header

```ts
export interface HumanHeaderView {
  slug: string;
  runId: string;
  sessionId: string | null;
  model: string | null;
  status: 'starting' | 'active' | 'stale' | 'completed' | 'failed' | 'unknown';
  capability: 'starting' | 'live-control' | 'attached-read-only' | 'attached-control' | 'completed';
  elapsedMs: number | null;
  eventCount: number;
  toolCallCount: number;
  unreadCount: number;
}
```

### Transcript

```ts
export interface TranscriptEntry {
  id: string;
  ts: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  status: 'streaming' | 'final' | 'collapsed' | 'error';
  sourceEventIds: string[];
  messageId: string | null;
}
```

### Tools

```ts
export interface ToolCallView {
  id: string;
  toolName: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'ok' | 'error';
  inputSummary: string;
  outputSummary: string | null;
  outputTruncated: boolean;
}
```

### Coordination Timeline

```ts
export type CoordinationTimelineEntry =
  | InboxTimelineEntry
  | StateTransitionTimelineEntry
  | ValidationTimelineEntry
  | ControlTimelineEntry
  | DiagnosticTimelineEntry;

export interface InboxTimelineEntry {
  kind: 'inbox';
  id: string;
  ts: string;
  lane: 'outside' | 'inside';
  type: string;
  subject: string;
  bodyPreview: string;
  ackOf: string | null;
  ackState: 'not-ack' | 'acks-other' | 'acked' | 'unacked';
}

export interface StateTransitionTimelineEntry {
  kind: 'state-transition';
  id: string;
  ts: string;
  side: 'outside' | 'inside';
  from: string;
  to: string;
  reason: string | null;
  peerStatus: string | null;
}
```

### Input Footer

```ts
export interface InputFooterView {
  enabled: boolean;
  mode: 'same-process' | 'attached-read-only' | 'attached-control' | 'completed';
  disabledReason: string | null;
  draft: string;
  followPaused: boolean;
  pendingCommandCount: number;
}
```

---

## Reducer Pipeline

```text
raw files/events
  -> parse and validate
  -> normalize source records
  -> reduce into semantic entities
  -> sort/merge timeline
  -> project panes
```

### Step 1: Parse

| Input | Parser Rule |
| --- | --- |
| Event line | Skip/diagnose malformed lines; never crash TUI. |
| Inbox lane | Reuse schema validation logic; diagnose torn lines. |
| State file | Use `readStateLazy` semantics where possible. |
| History line | Enforce line-size/corruption behavior consistent with runner. |

### Step 2: Normalize Events

| AgentEvent | Normalized Entity |
| --- | --- |
| `user_prompt` | `TranscriptEntry(role: user)` |
| `text_delta` | Accumulator bucket by `messageId` |
| `message` | Final assistant transcript entry |
| `thinking` | Collapsed transcript/system status |
| `tool_call` | `ToolCallView(status: running)` |
| `tool_result` | Complete matching `ToolCallView` |
| `usage` | Header/token stats if present |
| `session_start` | Header session identity |
| `session_idle` | Header status marker |
| `session_error` | Error transcript and diagnostic |

### Step 3: Merge Coordination

Ack correlation:

```ts
function computeAckState(message: InboxMessage, all: InboxMessage[]) {
  if (message.ackOf) return 'acks-other';
  return all.some((candidate) => candidate.ackOf === message.id)
    ? 'acked'
    : 'unacked';
}
```

Timeline sorting:

1. Sort by timestamp.
2. For equal timestamps, stable source order: control, inbox, state, event, validation.
3. Preserve source IDs for debugging.

---

## Example Transformation

### Input

```json
{"type":"text_delta","timestamp":"2026-04-28T01:00:00Z","data":{"messageId":"m1","content":"Hel"}}
{"type":"text_delta","timestamp":"2026-04-28T01:00:00Z","data":{"messageId":"m1","content":"lo"}}
{"type":"message","timestamp":"2026-04-28T01:00:01Z","data":{"messageId":"m1","content":"Hello"}}
{"type":"tool_call","timestamp":"2026-04-28T01:00:02Z","data":{"toolCallId":"t1","toolName":"bash","input":"npm test"}}
{"type":"tool_result","timestamp":"2026-04-28T01:00:05Z","data":{"toolCallId":"t1","output":"passed","isError":false}}
```

### Output

```ts
{
  transcript: [
    {
      id: 'msg:m1',
      role: 'assistant',
      content: 'Hello',
      status: 'final',
      messageId: 'm1',
      sourceEventIds: ['...'],
    },
  ],
  tools: [
    {
      id: 't1',
      toolName: 'bash',
      status: 'ok',
      inputSummary: 'npm test',
      outputSummary: 'passed',
      outputTruncated: false,
    },
  ],
}
```

---

## Diagnostics

The view model should surface degraded data without crashing.

```ts
export interface ViewDiagnostic {
  severity: 'info' | 'warning' | 'error';
  source: 'events' | 'inbox' | 'state' | 'history' | 'manifest' | 'completed';
  message: string;
  filePath?: string;
  line?: number;
}
```

Examples:

| Diagnostic | UI Placement |
| --- | --- |
| Malformed event line skipped. | Diagnostics row or status pane warning. |
| Inbox lane torn final line. | Coordination pane warning. |
| Manifest stale. | Header `stale`; input disabled. |
| Tool result without call. | Tool pane warning row. |

---

## Fixture Set

```text
test/fixtures/human-view/
  active-simple/
    events.ndjson
    run.json
  token-deltas/
    events.ndjson
  coordination-rich/
    events.ndjson
    inbox/outside.ndjson
    inbox/inside.ndjson
    state/inside.json
    state/outside.json
    state/history.ndjson
  degraded-repair/
    events.ndjson
    completed.json
    output/report.json
  malformed/
    events.ndjson
    inbox/outside.ndjson
```

Scratch can copy a subset under `scratch/human-agent-view/fixtures/`.

---

## Test Targets

| Test | Assertion |
| --- | --- |
| Delta coalescing | `Hel` + `lo` + final `Hello` renders once. |
| Tool lifecycle | running call becomes ok/error result. |
| Ack correlation | inside ack appears linked under outside message. |
| State history | transitions render in chronological order. |
| Stale manifest | capability becomes read-only and input disabled. |
| Malformed line | diagnostic emitted; model still renders valid records. |

---

## Open Questions

### Q1: Should this module live in `runner` or `cli`?

**RESOLVED FOR MVP**: Start in CLI-owned code because the only initial consumer is the human view. Keep it pure and React-free so it can move to runner later if `status`, `tail`, or future reports need the same projection.

### Q2: Should timeline include every tool call?

**RESOLVED FOR MVP**: Tool calls have their own pane. Timeline should include only tool-derived milestones that affect coordination/output, such as validation failure/repair.

### Q3: Should large tool output be available in the model?

**RESOLVED FOR MVP**: Store summary plus truncated flag. Full output can remain in raw event details for future expansion.

---

## Workshop Run Outcome

The mock-up and MVP should render exactly one semantic model:

```ts
HumanViewModel = {
  header,
  transcript,
  tools,
  coordination,
  state,
  output,
  input,
  diagnostics,
}
```

### Iteration 001 Projection Rules

| Raw Source | Projection |
| --- | --- |
| `text_delta` | Coalesce into transcript by `messageId`. |
| duplicate final `message` | Suppress if it matches accumulated deltas. |
| `tool_call` + `tool_result` | One tool row with `running | ok | error`. |
| inbox `ackOf` | Child/linked coordination row. |
| state history | Coordination timeline row. |
| malformed source | Diagnostic row, not crash. |

### Mock-up Fixture Priority

1. `coordination-rich` because it exercises all panes.
2. `token-deltas` because it validates readability.
3. `attached-read-only` because it validates honest controls.

---

## Quick Reference

```text
Never render raw event lines.
Always render semantic pane entries.
Diagnostics are data, not crashes.
Ack and state transitions belong in the coordination timeline.
Ink components consume HumanViewModel only.
```
