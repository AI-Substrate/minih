# MCP Server Leak Validation — Empirical Test (2026-04-26)

**Triggered by**: Perplexity research finding referencing GitHub Issue #1132 (`docs/plans/007-backgrounding/external-research/sdk-session-ttl.md`) which claimed that `session.disconnect()` does NOT terminate spawned stdio MCP server child processes, leading to process accumulation across runs.

**Hypothesis to test**: Does minih's current `minih run --mcp-config` flow leak the spawned MCP server process after the run completes?

**Verdict**: ❌ **NOT REPRODUCED in our SDK version + usage pattern.** The MCP server process is cleanly reaped within 5 seconds of run completion. Three sequential test cycles produced ZERO accumulated orphans.

---

## Test Setup

- minih branch: `007-backgrounding`
- Built CLI: `dist/cli/index.js`
- SDK peer dep: `@github/copilot-sdk >=0.1.32` (installed: see `node_modules/@github/copilot-sdk/`)
- Bundled CLI: `node_modules/@github/copilot/node_modules/@github/copilot-darwin-arm64/copilot`
- Agent: `mcp-smoke-test` (existing test agent at `agents/mcp-smoke-test/`)
- MCP server fixture: `scripts/mcp-test-server.cjs` (zero-dep stdio JSON-RPC stub: `echo`, `add`)
- Config: `test/fixtures/mcp-config.json`
- Model: `gpt-5.5 --no-reasoning` (per session policy)
- Filter command: `pgrep -f "scripts/mcp-test-server.cjs"`

## Methodology

For each cycle:
1. Snapshot `mcp-test-server` count and `minih copilot --headless` count.
2. Run `node dist/cli/index.js run mcp-smoke-test --model gpt-5.5 --no-reasoning --mcp-config test/fixtures/mcp-config.json`.
3. Snapshot count immediately after CLI exit.
4. Sleep 5s, snapshot.
5. Sleep additional 10s (total +15s), snapshot.

A "leak" would manifest as the +15s count being ≥ 1 *and* attributable to a PID that was spawned during this cycle's run.

## Results

| Cycle | Pre | Run duration | Post immediate | Post +5s | Post +15s |
|-------|-----|--------------|----------------|----------|-----------|
| 1 | 1 (preexisting orphan from prior testing) | 72s | 2 | 1 | n/a |
| 2 | 0 (after pkill) | 68s | 1 | 0 | 0 |
| 3 | 0 | 69s | 1 | 0 | 0 |

**Final orphan count after 3 cycles**: 0.

`session-state` directory grew from 729 → 730 → 731 → 732 (one new dir per run, as expected — local-first session state survives until explicit `client.deleteSession`).

`minih copilot --headless` count remained 0 throughout — the bundled CLI process is also reaped.

## Why This Works (Root Cause)

Inspecting `~/github/copilot-sdk/nodejs/src/client.ts`:

- **Line 14**: `import { spawn, type ChildProcess } from "node:child_process";`
- **Line 468**: `async stop(): Promise<Error[]>` — graceful client shutdown
- **Line 537**: `this.cliProcess.kill();` — kills the bundled CLI process during `stop()`

The bundled CLI process (`copilot --headless`) spawns the MCP server child processes. When `client.stop()` calls `cliProcess.kill()`, the CLI dies, and its MCP server children die with it (Unix process-group cascade since `detached: false` is the default).

minih's `sdk-runtime.ts:198-202` calls `client.stop()` in the `finally` block of every run:

```ts
const cleanup = () => {
  process.removeListener('SIGINT', sigintHandler);
  delete process.env.NODE_NO_WARNINGS;
  client.stop().catch(() => {});
};
```

So every minih run path — success, failure, timeout, even SIGINT (handled separately) — triggers the cascade cleanup. **The leak documented in Issue #1132 only manifests when `session.disconnect()` is called WITHOUT a subsequent `client.stop()`**, i.e., long-lived clients holding many sessions. minih's one-shot pattern doesn't hit it.

## Implications for Plan 007

**For the inside-channel MCP server (the one minih will spawn per run)**: ✅ Safe. As long as we follow the same `client.stop()` pattern in `finally` (which we already do in `sdk-runtime.ts`), the inside-MCP server will be reaped together with the bundled CLI when minih shuts down the run. We don't need a custom reaper.

**For the future eventing/daemon plan**: 🟡 Caveat. A long-running daemon that creates many sessions over time and disconnects them but does NOT call `client.stop()` between sessions would risk the leak. Pattern to use:
- One `CopilotClient` instance per long-running daemon process is fine.
- Per backgrounded agent: `createSession` → ... → `session.disconnect()`. Sessions accumulate on disk (intentional, for resumption); MCP servers spawned for each session cascade-die when the bundled CLI eventually exits.
- If the daemon needs to stop (SIGTERM): call `client.stop()` first → triggers cascade cleanup.
- If a session needs a unique MCP server set per agent (likely for our inside-channel pattern), spawning a NEW `CopilotClient` per agent (or per logical "agent run") is the safest pattern. Each client gets its own bundled CLI subtree which can be independently `stop()`ed.

**Separate observation (unrelated to minih)**: The user's machine has 48+ orphan `copilot --yolo` processes from prior interactive `npm-global copilot` CLI usage. These are *interactive Copilot CLI* sessions that exited without proper `client.stop()` cleanup — a real bug, but in the interactive CLI, not in minih or in this test path. Worth filing upstream if not already known.

## What This Doesn't Cover

- **Concurrent sessions from one client**: We tested sequential runs only. Long-running daemon with many simultaneous sessions could still hit Issue #1132 patterns.
- **MCP server crashes**: We tested a well-behaved MCP server. A crashing/hanging MCP server might not respond to SIGTERM cascade cleanly.
- **Long-idle sessions** (>30 min): Per Perplexity research, idle timeout cleans up in-memory state. Untested whether MCP server cleanup is bound to in-memory cleanup or to `client.stop()` only.
- **`infiniteSessions: true`**: Untested. May behave differently because background compaction keeps activity going.

## Recommendations

1. **No change needed** to minih's current MCP cleanup logic for the prerequisite work.
2. **Document the rule** in plan 007 spec: "every code path that creates a `CopilotClient` MUST call `client.stop()` in `finally`. Never rely on garbage collection."
3. **Add a regression test** for plan 007: after building the inside-channel MCP server, add an integration test that runs the agent through it and asserts `pgrep -f "<inside-mcp-process-marker>"` returns 0 within 5s of run completion.
4. **For the future daemon plan**: design the supervisor to call `client.stop()` on every clean exit path AND on SIGTERM/SIGHUP. Add a startup reaper that scans for stale process markers from prior daemon crashes (defense in depth).
