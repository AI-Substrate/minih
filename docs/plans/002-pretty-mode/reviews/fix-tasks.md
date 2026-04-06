# Fix Tasks: Simple Mode

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Restore non-TTY verbose fallback
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/run.ts
- **Issue**: `useVerbose` includes non-TTY runs, but the event callback is still omitted when `process.stderr.isTTY` is false, so stderr goes silent instead of falling back to verbose output.
- **Fix**: When `pretty` is disabled, route events through `displayEvent` regardless of TTY. Keep TTY gating only around pretty-mode setup such as the header/preflight block.
- **Patch hint**:
  ```diff
  - const onEvent = pretty
  -   ? (e: AgentEvent) => pretty.handleEvent(e)
  -   : isTTY
  -     ? displayEvent
  -     : undefined;
  + const onEvent = pretty
  +   ? (e: AgentEvent) => pretty.handleEvent(e)
  +   : displayEvent;
  ```

## Medium / Low Fixes

### FT-002: Preserve final-only thinking output
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/pretty.ts, /Users/jordanknight/substrate/minih/test/runner/pretty.test.ts
- **Issue**: `PrettyDisplay` suppresses every `thinking` event with `isDelta === false`, which drops final-only reasoning turns when no `reasoning_delta` was emitted first.
- **Fix**: Track whether delta reasoning was actually streamed for the current segment. Suppress `isDelta: false` only when it would duplicate already-rendered thinking; otherwise print the final reasoning text. Add a regression test for the final-only case.
- **Patch hint**:
  ```diff
  + private sawThinkingDelta = false;
  ...
  - if (event.data.isDelta === false) return;
  + if (event.data.isDelta === false) {
  +   if (this.sawThinkingDelta) return;
  +   process.stderr.write(chalk.gray.italic(event.data.content));
  +   return;
  + }
  + this.sawThinkingDelta = true;
  ```

### FT-003: Add CLI-level mode-selection coverage
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/test/cli/commands.test.ts
- **Issue**: The current tests validate `PrettyDisplay` in isolation but do not cover `run.ts` choosing between pretty, verbose, and non-TTY behavior.
- **Fix**: Add a regression test that exercises the run-command display path with stderr treated as non-TTY and with `--verbose`, or extract the mode-selection logic into a helper that can be unit tested directly.
- **Patch hint**:
  ```diff
  + it('falls back to verbose event display when stderr is not a TTY', async () => {
  +   // Arrange a fake adapter/run and assert displayEvent is selected.
  + });
  +
  + it('uses verbose display when --verbose is passed', async () => {
  +   // Assert PrettyDisplay is not selected.
  + });
  ```

### FT-004: Bring domain artifacts up to date
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md, /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md
- **Issue**: The runner docs do not list `PrettyDisplay` as a contract consumed by cli, and the adapter docs do not record the `isDelta` event-contract change introduced for pretty mode.
- **Fix**: Update the runner Contracts table and adapter History/Contracts/Concepts sections so the documented contract surface matches the code.
- **Patch hint**:
  ```diff
  + | `PrettyDisplay` | Class | cli (run command) |
  ...
  + | 002-pretty-mode | Added `AgentThinkingEvent.data.isDelta` and updated SDK thinking translation for pretty display suppression. |
  ```

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
