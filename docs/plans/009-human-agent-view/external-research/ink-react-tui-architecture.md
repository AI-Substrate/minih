# External Research: Ink/React TUI Architecture for Node CLIs

**Generated**: 2026-04-28T07:32:23+10:00  
**Method**: Perplexity Deep Research  
**Related plan**: `docs/plans/009-human-agent-view/research-dossier.md`  

## Research Question

How should minih build a simple human operator console with the "React TUI thing" while preserving stdout for machine-readable JSON envelopes and keeping UI code out of runner/adapter domains?

## Context Supplied

- TypeScript strict, ESM package, Node >=20.19.
- Commander CLI.
- Existing dependencies: `chalk`, `cli-table3`, `commander`; no React/Ink dependency yet.
- CLI convention: stdout is machine JSON; human output goes to stderr or a raw terminal UI.
- Domain boundary: CLI owns presentation and composition; runner owns run folders/events/metadata; adapter owns normalized SDK events and `SessionSender`.

## Executive Recommendation

Use **Ink + React** for the prototype and likely product TUI, but keep it isolated in the CLI domain and feed it through a pure run-view model. Ink is a good fit for a basic-to-moderate pane layout because it gives React components, hooks, and flexbox-style layout without manually managing terminal coordinates. It should not become the source of truth for run state.

The smallest safe strategy is:

1. Build `scratch/human-agent-view/` first with static fixtures and synthetic event updates.
2. Add a pure `RunViewModel` pipeline before productizing any Ink components.
3. Render Ink to `process.stderr` or an explicit TTY stream so stdout remains envelope-only.
4. Throttle/coalesce frequent token deltas before they enter React state.
5. Avoid alternate-screen/full-screen assumptions at first so normal terminal scrollback remains useful.

## Key Findings

### ER-01: Ink is viable for this use case, but should be a rendering shell

Perplexity found Ink remains the strongest React-style TUI option for a Node CLI: it uses React's component model and Yoga-style flexbox layout, which matches the requested pane-based UI without requiring manual cursor math. Ink is better suited than lower-level terminal libraries when the UI is mostly text panes, status bars, and input rather than a large widget framework.

**Implication for minih**: Put Ink components under `src/cli/` later; do not import Ink from runner. Runner should expose data/helpers only.

**Sources**:
- Ink repository: https://github.com/vadimdemedes/ink
- Ink releases: https://github.com/vadimdemedes/ink/releases
- Node stream docs: https://nodejs.org/api/stream.html

### ER-02: stdout preservation is the first architectural constraint

The research reinforced the existing minih rule: stdout must remain machine-readable. Ink normally renders to an output stream; the product code should pass an explicit stream and treat stderr/raw TTY as the human UI channel. Any `console.log` or dependency output must be audited because it can corrupt envelopes.

**Recommended pattern**:

```ts
import React from 'react';
import { render } from 'ink';

export function startHumanView(model: RunViewModel): () => void {
  const instance = render(<HumanView model={model} />, {
    stdin: process.stdin,
    stdout: process.stderr,
    stderr: process.stderr,
    exitOnCtrlC: false,
  });

  return () => {
    instance.unmount();
  };
}
```

**Implication for minih**: Use this only for interactive commands/modes. For non-TTY contexts, emit a JSON envelope and a clear hint instead of trying to run a TUI.

**Sources**:
- Node stdout/stderr guidance: https://nodejs.org/learn/command-line/output-to-the-command-line-using-nodejs
- Node input guidance: https://nodejs.org/learn/command-line/accept-input-from-the-command-line-in-nodejs
- Node TTY docs: https://nodejs.org/api/tty.html

### ER-03: Panes should be model-backed, not event-line-backed

Perplexity's strongest implementation guidance was to keep React state small and semantic. A pane should receive already-grouped data: transcript messages, active tool calls, completed tool results, status summary, coordination messages, and state transitions. Raw `events.ndjson` lines should not be rendered directly.

**Recommended model slice**:

```ts
interface HumanViewModel {
  header: {
    slug: string;
    runId: string;
    sessionId: string | null;
    status: 'starting' | 'active' | 'stale' | 'completed' | 'failed';
    elapsedMs: number;
    eventCount: number;
    toolCallCount: number;
  };
  transcript: TranscriptEntry[];
  tools: ToolCallView[];
  coordination: CoordinationTimelineEntry[];
  input: {
    enabled: boolean;
    mode: 'same-process' | 'attached-read-only' | 'attached-control';
  };
}
```

**Implication for minih**: The UI should consume `HumanViewModel`, not raw files. This keeps the first product increment testable without Ink.

**Sources**:
- NDJSON log processing context: https://ndjson.com/use-cases/log-processing/
- Parsing large NDJSON in Node: https://www.bennadel.com/blog/3233-parsing-and-serializing-large-datasets-using-newline-delimited-json-in-node-js.htm

### ER-04: Scrollback should be explicit and bounded

Ink can render panes, but it does not remove the need for application-level buffers. The TUI should maintain bounded ring buffers per pane and expose follow/paused-scroll modes. This also prevents high-frequency token deltas from forcing huge React renders.

**Recommended behavior**:

- Transcript pane stores grouped message blocks, not individual token lines.
- Tool pane stores active tool call rows and completed summaries.
- Coordination pane stores merged timeline entries with ack/state correlations.
- Input footer remains fixed.
- The UI can support "follow latest" and "scrollback paused" separately from run pause.

**Sources**:
- Ink input hook source: https://github.com/vadimdemedes/ink/blob/master/src/hooks/use-input.ts
- Windows Terminal panes as conceptual pane reference: https://learn.microsoft.com/en-us/windows/terminal/panes

### ER-05: Use minimal dependencies first

Perplexity compared Ink, Blessed, react-blessed, and readline/manual output:

| Option | Fit | Tradeoff |
| --- | --- | --- |
| Ink | Best fit for React-style simple panes and typed components. | Adds React/Ink dependency and requires careful stream/TTY handling. |
| Blessed | Powerful imperative widgets. | Heavier mental model and more direct terminal control than needed. |
| react-blessed | React API over Blessed. | More maintenance risk and extra renderer complexity. |
| readline/manual output | Smallest dependency footprint. | Pane layout, scrollback, and input quickly become custom terminal code. |

**Recommendation**: Use Ink for the prototype. Defer helper packages until the mock-up proves they are needed. If input is annoying, add a small, focused input package rather than a full widget suite.

**Sources**:
- Blessed repository: https://github.com/chjj/blessed
- react-blessed repository: https://github.com/Yomguithereal/react-blessed
- Node readline docs: https://nodejs.org/api/readline.html

### ER-06: Terminal cleanup and raw mode need explicit ownership

The research highlighted common failure modes: raw mode left enabled, cursor state not restored, Ctrl+C not handled, non-TTY sessions attempting interactive rendering, and React DevTools/environment gotchas.

**Recommended minih behavior**:

- TUI command checks `process.stderr.isTTY` and `process.stdin.isTTY`.
- `SIGINT` unmounts Ink, restores raw mode if changed, and exits cleanly.
- Non-TTY mode returns a JSON envelope with a "use --snapshot/status/tail" hint.
- Avoid alternate screen initially so terminal scrollback remains available.
- Add a central cleanup function that command handlers can call from `finally`.

**Sources**:
- Node TTY docs: https://nodejs.org/api/tty.html
- Node process signal patterns: https://coreui.io/answers/how-to-handle-process-signals-in-nodejs/
- React effect cleanup background: https://reacttraining.com/blog/useEffect-cleanup

### ER-07: Frequent token deltas should be throttled/coalesced

Ink can handle updates, but rendering every token delta as a React state update is the path back to the current noisy UX plus potential performance churn. The view model should coalesce `text_delta` events by `messageId`, batch refreshes, and only render human-scale updates.

**Recommended policy**:

- Coalesce deltas by `messageId`.
- Flush rendered transcript at a fixed cadence, e.g. 50-150ms, or on message finalization.
- Collapse duplicate final `message` events when they repeat accumulated deltas.
- Summarize large tool outputs with expandable/details affordance later.

**Sources**:
- Ink repository/performance issue context: https://github.com/vadimdemedes/ink
- Existing minih prior learning in `docs/plans/002-pretty-mode/pretty-mode-plan.md`.

## Practical Starter Shape

```tsx
function HumanView({ model, onSubmit, onToggleFollow }: Props) {
  return (
    <Box flexDirection="column" height="100%">
      <Header status={model.header} />
      <Box flexGrow={1}>
        <Box width="60%" flexDirection="column">
          <TranscriptPane entries={model.transcript} follow={model.follow} />
        </Box>
        <Box width="40%" flexDirection="column">
          <ToolPane calls={model.tools} />
          <CoordinationPane entries={model.coordination} />
          <StatePane state={model.state} />
        </Box>
      </Box>
      <InputFooter
        enabled={model.input.enabled}
        mode={model.input.mode}
        onSubmit={onSubmit}
        onToggleFollow={onToggleFollow}
      />
    </Box>
  );
}
```

## Integration Guidance for minih

1. **Scratch**: build `scratch/human-agent-view/` against static fixtures and fake timers.
2. **Foundation**: add pure run-view model helpers and tests before React dependencies.
3. **Command**: add a CLI-owned `view`/`human` command or `run --human` mode after the view model is stable.
4. **Stream safety**: render UI to stderr/raw TTY; stdout stays JSON.
5. **Attach honesty**: show attached runs as read-only until a control channel exists.
6. **Dependency gate**: add `react` + `ink` only when moving from scratch to product.

## Open Questions for Workshops

- Should the TUI use alternate screen, or preserve normal terminal scrollback?
- Should attach mode initially be read-only?
- Is "send" in attach mode an inbox message, a live session send, or both with explicit labels?
- What does "pause" mean: UI follow pause, coordination pause, forwarder pause, or session interrupt?
- Which command name is best: `view`, `human`, `watch`, or `run --human` plus `view` for attach?
