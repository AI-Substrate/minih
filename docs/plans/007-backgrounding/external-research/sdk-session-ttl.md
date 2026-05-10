# External Research: SDK Session TTL & Resumption Failure Modes

**Source**: Perplexity Sonar Deep Research, 2026-04-26
**Grounded with local SDK source at `~/github/copilot-sdk/nodejs/src/`** — established facts fed in (disconnect/destroy delegate to same RPC; `~/.copilot/session-state/<uuid>/` is canonical store; `infiniteSessions` mode auto-compacts; `sessionFsProvider` is custom-backing extension point).

---

## TL;DR — Key Facts We Now Know

1. **30-minute idle timeout** triggers IN-MEMORY cleanup. On-disk session files in `~/.copilot/session-state/<uuid>/` are NOT auto-deleted by the timeout; permanent removal requires explicit `client.deleteSession(sessionId)`. (Cite: docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/session-persistence)

2. **`client.listSessions(filter?)` is the documented liveness probe.** Returns metadata (creation time etc.) without resuming. Use it to check whether a session ID is still resumable, NOT a speculative `resumeSession` call.

3. **`session.abort()` as an undocumented liveness check** — lightweight (no tokens, no state mutation), throws if session not found / inactive (#742). Less reliable than `listSessions`.

4. **MCP server processes leak** — GitHub issue #1132 documents that `session.disconnect()` (and the underlying `session.destroy` RPC) do NOT terminate stdio MCP server child processes the SDK spawned. This is a known unfixed bug as of report date. **Critical implication for minih**: every run with `mcpServers` configured today already leaks. Our new "spawn inside-only MCP server per run" pattern will compound the leak. Manual reaper required at the minih level until SDK ships fix (CLI #1790 proposes a `/cleanup` slash command — not yet released).

5. **Session corruption resume failure mode** — GitHub issue #772: schema mismatches across SDK versions can produce JSON-RPC `-32603` errors that can't be cleanly distinguished from other fatal errors. Wrap `resumeSession` in try/catch and have a "start fresh" fallback.

6. **Concurrent-resume bug** — GitHub issue #742: calling `resumeSession` on a session that's already active on the same client connection causes doubled `session.event` notifications. Don't do it.

7. **No official heartbeat / keep-alive.** The 30-min idle timer is hard. To keep a session alive longer, send real work (or use `infiniteSessions` mode which auto-compacts to handle context window growth — but the 30-min idle still applies).

8. **No session locking** — SDK explicitly doesn't provide it. Concurrent access from two clients to the same session = undefined behavior. App must serialize (mutex / message queue / single-writer pattern).

9. **Concurrent session limits** — not formally documented. Recommended pattern: `SessionManager` with `maxConcurrent ≈ 50` per CopilotClient, evicting older sessions via `disconnect()` (preserving on disk for resume). For backend services, headless server mode + load balancer + shared storage.

10. **GitHub Copilot enforces user-level rate limits**: per-session token cap + 7-day weekly cap. Auto-fallback to smaller model when weekly cap exhausted with premium remaining. SDK doesn't expose remaining budget — only reactive errors.

11. **Local-first architecture**: session state is on the user's machine; GitHub backend handles model inference only. So eviction is purely local. Offline mode (`COPILOT_OFFLINE=true` + local provider URL) keeps everything on-machine.

---

## Implications for Plan 007 & Backgrounding

### Inside-channel MCP server (architecture decision)
- **MCP server leak is the #1 risk.** When minih spawns its own inside-only MCP server and registers it with the SDK session, our spawned process WILL leak when the SDK doesn't reap it. We must:
  - Track the PID of the MCP server we spawned (we own its lifecycle, not the SDK).
  - Kill it ourselves in the run's `finally` block, alongside `client.stop()`.
  - Add a startup reaper that scans for stale `minih-mcp-*` pids from prior runs and kills them.
- The 30-min idle timeout is fine for our prerequisite work (synchronous one-shot runs always finish in well under 30 min).

### Future eventing/daemon plan
- **30-min idle = hard ceiling for naive backgrounding.** A code-review agent that watches files but receives no changes for 30 min will have its in-memory session cleaned up. When the next file change arrives, we must `resumeSession` from disk. So the daemon should:
  - Treat every "wake" as `resumeSession + sendAndWait`, NOT assume the session is still warm.
  - Use `client.listSessions(filter: {sessionId})` to verify before sending.
  - Have a fallback: if resume fails (corruption, deletion), brief a fresh session using inbox/state files we own.
- **`infiniteSessions` mode is the right default for backgrounded agents** — auto-compaction handles context-window growth from long-running observation. Configure `backgroundCompactionThreshold ≈ 0.80`, `bufferExhaustionThreshold ≈ 0.95`.
- **Periodic cleanup job** for the daemon: scan `~/.copilot/session-state/` for sessions older than (e.g.) 24 hours that we no longer track in our run folders, and `client.deleteSession` them.

### Session-state contract for our run folder
- Today we store `sessionId` in `completed.json` and assume `findRunSession` returns a resumable session. After this research:
  - We should treat `findRunSession` as best-effort and ALWAYS confirm with `listSessions` before exposing the sessionId for resumption.
  - On resume failure, fall back to "start a fresh session, brief it from inbox + state."
  - Surface session-status field in `completed.json` (e.g., `sessionStatus: "active" | "evicted-from-memory" | "deleted" | "corrupted"`) at next-resume time.

---

## Full Perplexity Output (verbatim)

> Note: the verbatim Perplexity research output is large (~9,000 words with 41 citations). Key citations referenced above:
> - [2] docs.github.com session-persistence (canonical session lifecycle docs)
> - [10] github.com/github/copilot-sdk/issues/1132 (MCP server cleanup bug)
> - [19] github.com/github/copilot-sdk/issues/772 (corrupted session JSON-RPC -32603)
> - [21][26] github.com/github/copilot-sdk/issues/742 (concurrent resume doubled events)
> - [29] github.com/github/copilot-cli/issues/1790 (proposed `/cleanup` command)
> - [18] docs.github.com scaling guide (SessionManager pattern)
> - [8] docs.github.com backend-services (headless mode + persistent volumes)
>
> Top 3 source URLs:
> - https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/session-persistence
> - https://github.com/github/copilot-sdk/issues/1132
> - https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/scaling

If we need the full text for review, it's in conversation history (turn that started the Perplexity research call).

---

## Open follow-ups (not deal-breakers, but worth knowing)

- **Doc gap**: nominal failure mode of `resumeSession` on a never-existed sessionId is not explicitly documented. We should verify empirically (write a tiny script: `client.resumeSession('nonexistent-uuid')` → log error shape, exit code, exception type).
- **Recency confidence**: Perplexity cited some 2025-dated docs but couldn't pin every claim to a specific SDK version. We're on `>= 0.1.32` peer dep; should test against the version we target before committing to design.
