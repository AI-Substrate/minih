# Fix Tasks: Simple Mode

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Skip fresh-run input validation on resume
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/runner.ts
- **Issue**: Resumed runs for agents with required `input-schema.json` files fail before the SDK call because `runAgent()` validates empty `config.params` even when `config.sessionId` is set.
- **Fix**: Bypass fresh-run input validation and `paramsHint` generation when resuming, or persist/reload the original run params before validation so resume does not require the user to re-supply inputs the CLI cannot currently accept.
- **Patch hint**:
  ```diff
  - if (definition.inputSchemaPath) {
  + if (!isResume && definition.inputSchemaPath) {
      const params = config.params ?? {};
      const inputValidation = validateInput(definition.inputSchemaPath, params);
      ...
    }
  ```

### FT-002: Support optional message + stdin for `resume`
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts
- **Issue**: `resume` requires `<message>` and rejects stdin-only usage, so AC12 is impossible.
- **Fix**: Change the signature to `resume <slug> [message]`, read non-TTY stdin when the arg is absent, and fail only when both sources are empty/whitespace.
- **Patch hint**:
  ```diff
  - .command('resume <slug> <message>')
  + .command('resume <slug> [message]')
    ...
  - async (slug: string, message: string, opts) => {
  + async (slug: string, messageArg: string | undefined, opts) => {
  +   const message = messageArg ?? (process.stdin.isTTY ? '' : await readStdin());
  +   if (!message.trim()) {
  +     exitWithEnvelope(...);
  +   }
      ...
  ```

## Medium / Low Fixes

### FT-003: Find the latest completed session, not just the latest run folder
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/folder.ts
- **Issue**: One incomplete/corrupt latest run currently blocks `resume` and `connect` even when an older completed session exists.
- **Fix**: Walk run folders in descending order and return the first valid `completed.json` with a `sessionId`.
- **Patch hint**:
  ```diff
  - targetRunId = entries[0].name;
  - targetRunDir = path.join(runsDir, targetRunId);
  + for (const entry of entries) {
  +   const candidateRunId = entry.name;
  +   const candidateRunDir = path.join(runsDir, candidateRunId);
  +   const completedPath = path.join(candidateRunDir, 'completed.json');
  +   ...
  +   if (metadata.sessionId) {
  +     return { sessionId: metadata.sessionId, runId: candidateRunId, runDir: candidateRunDir };
  +   }
  + }
  + return null;
  ```

### FT-004: Return actionable guidance for runtime resume failures
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts
- **Issue**: Runtime resume failures still surface as generic `E120 AGENT_EXECUTION_FAILED` messages instead of the fresh-start guidance required by AC8.
- **Fix**: Detect/classify resume failures (for example missing/expired session errors) and return `AGENT_VALIDATION_FAILED` with an actionable message.
- **Patch hint**:
  ```diff
  - formatError('resume', ErrorCodes.AGENT_EXECUTION_FAILED, result.agentResult.output, ...)
  + const resumeMissing = /session.*not found|expired|resume/i.test(result.agentResult.output);
  + const envelope = resumeMissing
  +   ? formatError(
  +       'resume',
  +       ErrorCodes.AGENT_VALIDATION_FAILED,
  +       `Session not found — run \`minih run ${slug}\` for a fresh start.`,
  +       {...},
  +     )
  +   : formatError('resume', ErrorCodes.AGENT_EXECUTION_FAILED, result.agentResult.output, {...});
  + exitWithEnvelope(envelope);
  ```

### FT-005: Add examples to `resume --help`
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/resume.ts
- **Issue**: `minih resume --help` lacks examples, so AC9 is unmet.
- **Fix**: Add help text covering latest-run, `--run`, and stdin usage, and lock it with a CLI test.
- **Patch hint**:
  ```diff
    .command('resume <slug> [message]')
    .description('Send a follow-up message to a completed agent session')
  + .addHelpText(
  +   'after',
  +   '\nExamples:\n' +
  +     '  minih resume smoke-test "Check the test output too"\n' +
  +     '  minih resume smoke-test --run <runId> "Elaborate on the warning"\n' +
  +     '  echo "check tests" | minih resume smoke-test\n',
  + )
  ```

### FT-006: Add explicit timestamps to `connect --list`
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts
- **Issue**: `connect --list` omits the explicit timestamp field/column required by AC15.
- **Fix**: Include `completedAt` (or a parsed timestamp) in the JSON payload and the TTY table.
- **Patch hint**:
  ```diff
      return {
        runId: e.name,
        sessionId: meta.sessionId ?? null,
  +     completedAt: meta.completedAt ?? null,
        result: meta.result ?? 'unknown',
        durationMs: meta.durationMs ?? null,
      };
  ...
  - head: [chalk.bold('Run ID'), chalk.bold('Session ID'), chalk.bold('Result')]
  + head: [chalk.bold('Run ID'), chalk.bold('Timestamp'), chalk.bold('Session ID'), chalk.bold('Result')]
  ```

### FT-007: Shell-quote the generated connect command
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/connect.ts
- **Issue**: The generated `cd <runDir> && ...` command breaks when `runDir` contains spaces and is not safe to paste in the general shell case.
- **Fix**: Introduce a small shell-quoting helper and use it when composing the command string.
- **Patch hint**:
  ```diff
  + const quoteShellArg = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  - const command = `cd ${session.runDir} && copilot --yolo --resume=${session.sessionId}`;
  + const command = `cd ${quoteShellArg(session.runDir)} && copilot --yolo --resume=${session.sessionId}`;
  ```

### FT-008: Refresh domain docs/map for session lookup
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/minih/docs/domains/domain-map.md, /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md, /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md
- **Issue**: Domain artifacts lag the feature: the map omits `findRunSession()`, CLI docs still point at `run.ts` for the SDK bootstrap, and runner docs only partially describe session lookup / resume exceptions.
- **Fix**: Refresh the map edge label and both domain docs so they match the implemented contracts and concepts.
- **Patch hint**:
  ```diff
  - cli --listAgents, resolveAgent, runAgent, validate*, display*--> runner
  + cli --listAgents, resolveAgent, findRunSession, runAgent, validate*, display*--> runner
  ```

### FT-009: Tighten tests/evidence and remove new warnings
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/minih/test/runner/session.test.ts, /Users/jordanknight/substrate/minih/test/cli/commands.test.ts, /Users/jordanknight/substrate/minih/docs/plans/003-resume-prompt/execution.log.md
- **Issue**: Critical CLI edge cases are untested, `session.test.ts` adds new lint warnings, and `execution.log.md` does not record post-change verification.
- **Fix**: Add CLI tests for stdin/help/latest-completed-run/connect-list behavior, remove the new non-null assertions, and append post-fix verification evidence to `execution.log.md`.
- **Patch hint**:
  ```diff
  - expect(result!.sessionId).toBe('new-session');
  + expect(result?.sessionId).toBe('new-session');
  ...
  + it('resume accepts stdin when message arg is omitted', () => { ... });
  + it('connect --list includes completedAt', () => { ... });
  ```

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
