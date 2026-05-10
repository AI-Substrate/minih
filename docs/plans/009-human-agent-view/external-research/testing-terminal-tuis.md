# External Research: Testing Interactive Terminal UIs

**Generated**: 2026-04-28T07:32:23+10:00  
**Method**: Perplexity Deep Research  
**Related plan**: `docs/plans/009-human-agent-view/research-dossier.md`  

## Research Question

How should minih test a future Ink/React human operator console without creating brittle ANSI snapshot tests or breaking the existing stdout/stderr contract?

## Context Supplied

- TypeScript strict, ESM package, Node >=20.19.
- Vitest test suite.
- Commander CLI.
- stdout is machine-readable JSON envelopes; human output goes to stderr.
- Proposed architecture: pure `RunViewModel` from event NDJSON + run metadata + inbox/state/history, rendered by CLI-owned Ink components.

## Executive Recommendation

Use a **layered testing strategy**:

1. Put most coverage in pure view-model tests.
2. Use `ink-testing-library` for component-level behavior, not large snapshots.
3. Use child-process integration tests sparingly for CLI stream separation, TTY/non-TTY fallback, and command wiring.
4. Test control semantics (`send`, `pause`, attach) through injected ports/fakes before testing terminal rendering.

The product should not start with full-screen golden ANSI snapshots. They are brittle and obscure the real contracts.

## Recommended Test Pyramid

| Layer | Share | What to Test | Tools |
| --- | ---: | --- | --- |
| Pure model | 60-70% | event grouping, delta coalescing, tool lifecycle, coordination timeline, status derivation, attach modes | Vitest |
| Component behavior | 20-30% | pane rendering, input callbacks, key handling, scroll/follow state | `ink-testing-library` |
| CLI integration | 5-10% | command options, stdout/stderr separation, non-TTY fallback, SIGINT cleanup | `child_process`, Vitest |
| Manual/scratch | opportunistic | layout feel, terminal quirks, dogfood feedback | `scratch/` programs |

## Key Findings

### ER-TEST-01: Pure model tests should carry most confidence

The research strongly recommended separating terminal UI from business logic. For minih, this means the event/log readers and `RunViewModel` reducer should have no React/Ink dependency and should be tested like normal TypeScript.

**Example**:

```ts
it('coalesces text deltas and suppresses duplicate final message', () => {
  const model = buildRunViewModel({
    events: [
      textDelta('m1', 'Hel'),
      textDelta('m1', 'lo'),
      message('m1', 'Hello'),
    ],
    coordination: emptyCoordinationFixture(),
  });

  expect(model.transcript).toEqual([
    expect.objectContaining({ role: 'assistant', content: 'Hello' }),
  ]);
});
```

**Sources**:
- Vitest guide: https://vitest.dev/guide/cli
- Vitest isolation config: https://vitest.dev/config/isolate
- Snapshot alternatives discussion: https://stevekinney.com/courses/testing/snapshot-test-alternatives

### ER-TEST-02: Use `ink-testing-library` for component interaction

Perplexity identified `ink-testing-library` as the standard testing tool for Ink components. Its useful primitives include `render`, `lastFrame()`, `frames`, `rerender()`, and `stdin.write()` for simulated keyboard input.

**Example**:

```tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

it('submits the input footer on enter', () => {
  const onSubmit = vi.fn();
  const { stdin, lastFrame } = render(
    <InputFooter enabled={true} mode="same-process" onSubmit={onSubmit} />,
  );

  stdin.write('please check status');
  stdin.write('\r');

  expect(onSubmit).toHaveBeenCalledWith('please check status');
  expect(lastFrame()).toContain('same-process');
});
```

**Sources**:
- ink-testing-library repository: https://github.com/vadimdemedes/ink-testing-library
- Ink repository: https://github.com/vadimdemedes/ink

### ER-TEST-03: Prefer semantic assertions over ANSI snapshots

The research cautioned against large terminal-frame snapshots. They are fragile across terminal widths, colors, Unicode support, dependency changes, and minor layout tweaks.

**Recommended assertions**:

- Header contains run ID/status.
- Transcript pane contains grouped content once.
- Tool pane shows active and completed tool state.
- Input disabled label appears for read-only attach.
- No text appears on stdout for TUI mode.
- Non-TTY fallback exits with envelope and guidance.

**Avoid**:

- Full-frame snapshots of the whole TUI.
- Assertions on exact whitespace unless the layout contract explicitly depends on it.
- ANSI escape-code expectations except in one or two low-level smoke tests if needed.

**Sources**:
- Snapshot alternatives: https://stevekinney.com/courses/testing/snapshot-test-alternatives
- Golden tests background: https://ro-che.info/articles/2017-12-04-golden-tests

### ER-TEST-04: Timers and polling need injectable clocks

The future TUI will likely poll files, throttle token deltas, and update elapsed time. These are hard to test reliably with real timers.

**Recommended pattern**:

- View model reducers are pure.
- Polling is in an adapter/port that can be faked.
- Throttle/debounce uses injected scheduler or Vitest fake timers.
- Component tests use `vi.useFakeTimers()` only inside isolated tests with cleanup in `afterEach`.

**Example**:

```ts
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('flushes coalesced transcript updates on the configured cadence', () => {
  vi.useFakeTimers();
  const stream = createTranscriptAccumulator({ flushMs: 100 });

  stream.add(textDelta('m1', 'A'));
  stream.add(textDelta('m1', 'B'));
  expect(stream.snapshot()).toEqual([]);

  vi.advanceTimersByTime(100);
  expect(stream.snapshot()[0].content).toBe('AB');
});
```

**Sources**:
- Vitest setup/teardown: https://main.vitest.dev/guide/learn/setup-teardown
- Vitest async testing: https://main.vitest.dev/guide/learn/async
- Jest timer mocks background: https://jestjs.io/docs/timer-mocks

### ER-TEST-05: stdout/stderr separation deserves explicit tests

Because minih's contract is stdout JSON and human output on stderr, the TUI command/mode needs stream tests. This can be done without snapshotting the whole UI.

**Recommended integration assertions**:

- `minih view <slug> --snapshot` or non-TTY fallback writes parseable JSON to stdout.
- Interactive TUI mode writes no JSON fragments to stderr unless intentionally user-facing.
- TUI rendering never writes to stdout.
- Errors use existing envelope conventions when the TUI cannot start.

**Example**:

```ts
const result = execFileSync('node', [
  'dist/cli/index.js',
  'view',
  'demo-agent',
  '--no-interactive',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const envelope = JSON.parse(result.stdout);
expect(envelope.command).toBe('view');
expect(result.stderr).toContain('Human view unavailable');
```

**Sources**:
- Node child process docs: https://nodejs.org/api/child_process.html
- Node stdout/stderr article: https://dev.to/tene/understanding-err-stdout-and-stderr-in-nodejs-44ia

### ER-TEST-06: Keyboard input should be tested through stdin writes, not terminal automation

The research recommends simulating input at the Ink stream layer for component tests and reserving full process tests for a tiny number of smoke paths.

**Test cases**:

- Typing text updates footer draft.
- Enter calls `onSubmit`.
- Escape or Ctrl+C exits/cleans up.
- PageUp/PageDown or chosen scroll keys adjust scroll offset.
- Pause key toggles UI-follow pause, not run pause, until product semantics define more.

**Sources**:
- Ink input hook: https://github.com/vadimdemedes/ink/blob/master/src/hooks/use-input.ts
- Keyboard input in Node context: https://dev.to/sanjarcode/keyboard-input-in-nodejs-2j93

### ER-TEST-07: CI/non-TTY should be a first-class mode

Interactive UI tests can fail in CI if they assume TTY features. The product command should detect TTY availability and return a deterministic fallback.

**Recommended behavior**:

- If no TTY, do not render Ink.
- Return an envelope with the run ID, attach status, and suggested `tail --snapshot` or `status` alternative.
- Keep component tests in process via `ink-testing-library`.
- Keep CLI integration tests non-interactive unless specifically testing a pseudo-terminal later.

**Sources**:
- Node TTY docs: https://nodejs.org/api/tty.html
- CircleCI CLI testing discussion: https://circleci.com/blog/testing-command-line-applications/

## Minimal Test Plan for minih

### View Model Tests

1. Builds header from live manifest and completed metadata.
2. Resolves `latest-active`, `latest-completed`, and explicit run IDs.
3. Parses bounded event windows and skips malformed/torn lines consistently with `tail`.
4. Coalesces `text_delta` and `message` by `messageId`.
5. Correlates `tool_call` and `tool_result`.
6. Merges inbox messages, ack relationships, and state history into a coordination timeline.
7. Marks attached read-only mode when no control bridge is available.

### Component Tests

1. Header renders active/stale/completed status.
2. Transcript pane collapses duplicate final message.
3. Tool pane shows active tool call and error result.
4. Coordination pane shows outside milestone, inside ack, and state transition.
5. Input footer disables submit for read-only attach.
6. Enter submits in same-process mode.
7. Follow/pause-scroll toggle changes visible label.

### Integration Tests

1. `run --human` wires events into the view model with `FakeAgentAdapter`.
2. `view <slug> --run <id>` reads an existing run fixture.
3. `view <slug>` prefers latest active run and errors on ambiguity.
4. Non-TTY fallback preserves stdout JSON envelope.
5. SIGINT cleanup unmounts UI and exits without leaving raw mode.

## Pitfalls and Mitigations

| Pitfall | Mitigation |
| --- | --- |
| Full-frame snapshots fail on harmless layout changes. | Assert semantic content and behavior. |
| Tests mix real and fake timers. | Use `afterEach` cleanup and isolate timer tests. |
| Component tests accidentally rely on real TTY. | Use `ink-testing-library` streams. |
| stdout pollution breaks envelopes. | Child-process tests assert stdout parseability and stderr-only human output. |
| Control-channel tests become terminal tests. | Test control ports/fakes directly before rendering. |
| CI lacks raw TTY. | Provide deterministic non-TTY fallback and keep interactive smoke minimal. |

## Recommendation for Workshops

The workshop output should define contracts that make testing easy:

- `RunViewModel` interfaces.
- `RunViewEvent` reducer actions.
- `ControlPort` interface for `send`, `pause`, `attachStatus`.
- `RenderPort` or component props so Ink is a thin shell.
- Fixture files for active, completed, degraded, and coordination-heavy runs.
