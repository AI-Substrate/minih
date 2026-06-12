# Research Report: Stall watchdog + run budgets — guaranteed terminal artifact for stalled live runs

**Generated**: 2026-06-11T11:50:00Z
**Research Query**: "stall watchdog + run budgets so stalled live runs reach a terminal artifact (issue #44); include Copilot SDK currency check"
**Mode**: Pre-Plan
**Location**: docs/plans/026-stall-watchdog/research-dossier.md
**FlowSpace**: Not used (targeted Explore agents + direct reads)
**Findings**: 6 critical discoveries, 5 prior learnings, external research (verified/unverified split)
**Harness**: session-start seam — `harness doctor` **ok** (toolchain, extensions: boot loaded, record-types); boot extension available for pre-implement validation.

## Executive Summary

### What It Does
Issue [#44](https://github.com/AI-Substrate/minih/issues/44): long-running detached runs stall mid-`assistant.streaming_delta` and **never reach a terminal state** — no `completed.json`/`failed.json`/`report.json`, `run.json` stays `active` forever while the OS process is still alive. Pollers time the runs out and the agent's real work is never graded.

### Key Insights
1. **A run-level `--timeout` already exists** (`run.ts` `-t/--timeout`, default 900s; `Promise.race` at `runner.ts:1164-1170`) — contrary to what our own #44 triage comment claimed. The reporter's runs (~1000s+) should have been killed at 900s.
2. **The timeout's cleanup path can hang forever (CD-01, the headline bug)**: on timeout, the catch block does `await adapter.terminate(activeSessionId)` (`runner.ts:1174`), and `terminate()` (`sdk-copilot.ts:306-324`) awaits `resumeSession()` → `session.abort()` → `session.destroy()` — three JSON-RPC calls into the very subprocess that is hung. The `try/catch` absorbs *rejections*, not *hangs*. If any await never settles, the catch never completes, **no terminal artifact is ever written**, and `run.json` stays `active` — exactly #44's footprint, even with the timeout firing.
3. **There is no inactivity (stall) detection at all**: the adapter's completion contract is `await idlePromise` (`sdk-copilot.ts:204`), settled only by a `session.idle` event (resolve) or `session.error` event (reject). A stream that silently stops advancing settles neither; the only backstop is the global timeout — and then insight 2 bites.
4. **The SDK can't save us**: latest `@github/copilot-sdk` is **1.0.1** (published 2026-06-10; we're on 1.0.0). v1.0.1's release notes carry nothing stall/abort-related for Node. The watchdog must be built entirely on minih's side. (The "1.0.61" version we initially saw was a bad read — npm `dist-tags.latest` is 1.0.1, GitHub tags end at v1.0.1.)

### Quick Stats
- **Components**: runner (`runner.ts`, `run-manifest.ts`, `types.ts`), adapter (`sdk-copilot.ts`, `events.ts`, `fake.ts`), cli (`run.ts`, `resume.ts`, `status.ts`, `output.ts`)
- **Existing machinery to reuse**: global timeout + `timedOut` flag, `handleEvent` seam, `stats.messages` turn counter, `adapter.terminate()`, FakeAgentAdapter `suppressFinalIdle` seam (025 T008), injectable clock/probe idiom (025 T001/T002)
- **Prior Learnings**: 5 directly applicable (see PL table)
- **Domains**: adapter, runner, cli (all existing; no new domain)

## How It Currently Works

### Completion contract (the await that hangs)

`runAgent` (`src/runner/runner.ts:1124-1170`):

```ts
runPromise = adapter.run({ ... onEvent: handleEvent ... })
  .then(async (result) => { /* drain manifests, status 'completing', terminal condition */ })
  .finally(closeForwarders);
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutHandle = setTimeout(() => {
    timedOut = true;
    reject(new Error(`Agent timed out after ${config.timeout ?? 300}s`));
  }, timeoutMs);
});
agentResult = await Promise.race([runPromise, timeoutPromise]);
```

Inside the adapter (`src/adapter/sdk-copilot.ts:141-204`), `idlePromise` is settled by the `session.on(...)` handler:
- `session.idle` event → `resolve()` (the **only** success path)
- `session.error` event → `reject(...)` (the **only** error path)
- then `await initialSend; await idlePromise;`

If the Copilot CLI subprocess hangs or the server silently drops the turn, **neither event arrives**, `idlePromise` never settles, and only the global timeout fires.

### What happens on timeout today (`runner.ts:1171-1207`)

```ts
} catch (error) {
  if (timedOut) {
    try {
      await adapter.terminate(activeSessionId);   // ← CD-01: can hang forever
    } catch { /* best-effort */ }
    closeForwarders();
    ...
    agentResult = { status: 'killed', exitCode: 124, ... };
  }
```

When `terminate()` *does* settle, flow continues to the terminal writes (`runner.ts:1328-1399`): `completed.json` with `result: 'timeout'`, final manifest patch `status: 'failed'` — **but no `terminalReason`** is written for the timeout case (CD-04).

### terminate() — three unbounded awaits into a hung subprocess (`sdk-copilot.ts:306-324`)

```ts
async terminate(sessionId: string): Promise<AgentResult> {
  const session = await this._client.resumeSession(sessionId, {...}); // hang vector
  try {
    await session.abort();                                            // hang vector
  } finally {
    await session.destroy();                                          // hang vector
  }
  ...
}
```

A fourth unbounded await sits in the adapter's run `finally` (`sdk-copilot.ts:256-265`): `await session.disconnect()` — it can block `runPromise` from settling even after an error.

### Event/heartbeat machinery (the watchdog's observation point)

- `handleEvent` (`runner.ts:951-1014`): every adapter event → `fs.appendFileSync(events.ndjson)` + throttled manifest counter patch (250ms); guard `if (timedOut) return;` at entry.
- `run-manifest.ts:196`: every patch refreshes `updatedAt` — this is what `status` uses for the 60s stale threshold.
- `stats.messages` (`runner.ts:910-920`) already counts assistant messages → a natural **turn counter** for `--max-turns`.
- **No `AbortController`, no inactivity timer, no per-turn timeout anywhere** in `src/runner` or `src/adapter`.

### FX012 (plan 025) only covers the *erroring* stream

`provider_stream_aborted` is emitted **only in the adapter's catch block** (`sdk-copilot.ts:213-235`) when `idlePromise` *rejects* while a message is in flight. A silent hang never reaches that catch. The runner persists it post-run at `runner.ts:1249-1261` (`terminalReason: 'provider-stream-aborted'`).

## Critical Discoveries

### 🚨 CD-01: `await adapter.terminate()` on the timeout path can hang forever → no terminal artifact
**Impact**: Critical — this is the direct mechanism behind #44 (runs > 900s default timeout that still never finalized).
**Where**: `runner.ts:1174` → `sdk-copilot.ts:306-324` (`resumeSession`/`abort`/`destroy`, all unbounded JSON-RPC awaits); plus `disconnect()` in the run `finally` (`sdk-copilot.ts:263`).
**Required action**: every cleanup await on the abort path must be **deadline-bounded** (race against a short timer); terminal artifacts must be written **before or independent of** graceful cleanup; final escalation = `client.forceStop()` (SIGKILL the CLI subprocess — exists in SDK v1.0.0, `client.d.ts`) and/or direct child-process kill.

### 🚨 CD-02: No stall detection exists — `idlePromise` settles only on `session.idle`/`session.error`
**Impact**: Critical. A silently-stopped stream leaves the await pending; with a long `--timeout` (or the resume default mismatch, CD-05) that's hours of zombie `active`.
**Required action**: inactivity watchdog — a timer reset on **every** adapter event in `handleEvent`; on expiry: emit a synthetic diagnosis event (the FX012/permission-denied precedent), write terminal `failed` + `terminalReason: 'stalled-stream'`, then bounded abort/escalate.

### 🚨 CD-03: No `--max-turns` budget; `stats.messages` is a ready-made turn counter
**Impact**: High — #44 Q4 asked for self-capping; a looping agent today runs until wall-clock timeout only.
**Required action**: `--max-turns <n>` → on breach, same terminal-artifact-first sequence with `terminalReason: 'max-turns'`.

### 🚨 CD-04: Even the working timeout path writes no `terminalReason`
**Impact**: Medium — `completed.json` carries `result: 'timeout'` but `run.json` just says `failed`; tooling diffing 025's vocabulary (`pid-vanished`, `provider-stream-aborted`, `permission-denied`) gets nothing for timeouts.
**Required action**: write `terminalReason: 'timeout'` in the final manifest patch when `timedOut`; status/runs pass `terminalReason` through generically (`status.ts:368-379` — no CLI change needed).

### 🚨 CD-05: `run` and `resume` disagree on the default timeout (900s vs 300s); runner error message hardcodes `?? 300`
**Impact**: Medium — confusing operator surface; the runner message can lie about the configured value.
**Where**: `run.ts` DEFAULT_TIMEOUT 900s; `resume.ts:168-217` default 300s; `runner.ts:1167` message uses `config.timeout ?? 300`.

### 🚨 CD-06: Our #44 triage comment overstated the gap
**Impact**: Low (accuracy/comms) — the comment said "no `--timeout`/`--max-turns` flags exist today"; `--timeout` exists. The *real* claims (no watchdog; timeout doesn't guarantee a terminal artifact) hold via CD-01/CD-02. Correct the record when closing #44.

## SDK Surface (installed v1.0.0) & Upgrade Truth

From `node_modules/@github/copilot-sdk` `.d.ts`:

| API | Relevance |
|---|---|
| `session.abort(): Promise<void>` | aborts in-flight message; session stays valid. **Unbounded await risk if CLI hung.** |
| `session.destroy()` / `session.disconnect()` | dispose vs. preserve-state release; both JSON-RPC awaits. |
| `client.stop(): Promise<Error[]>` | graceful close of sessions + CLI process. |
| `client.forceStop(): Promise<void>` | **SIGKILL the CLI subprocess, no graceful cleanup — the reliable last rung of the escalation ladder.** |
| `sendAndWait(opts, timeout?)` | client-side wait timeout only — "does not abort in-flight agent work". We use `send()` + idle event, not this. |
| `CopilotClientOptions.sessionIdleTimeoutSeconds` | server-side cleanup of *inactive* sessions — not a stall fix (a stalled turn may not count as idle). |
| **No AbortSignal support** | no native cancellation tokens in v1.0.0. |

**Version truth (verified 2026-06-11)**: installed **1.0.0** (npm publish 2026-06-02); `dist-tags.latest` = **1.0.1** (2026-06-10). GitHub release v1.0.1 notes: Java experimental-gate annotation, canvas-snapshot bugfix (Node), generator fixes — **nothing stall/abort/timeout-related**. Upgrade is hygiene (do it, keep the `sdk-permission-shapes.test.ts` pin green, diff the `.d.ts` for surprises) — **the watchdog cannot be delegated to the SDK**.

## External Research (Perplexity deep-research, verified vs. not)

**Verified / citable:**
- [github/copilot-sdk#824](https://github.com/github/copilot-sdk/issues/824): long-running **non-idle** jobs killed at ~35 min with an "idle" error — server/CLI-side lifetime limits can end a turn without a clean `session.error` reaching the client. Supports "stall can originate server-side; client must self-defend".
- [github/copilot-cli#2525](https://github.com/github/copilot-cli/issues/2525): Windows subprocess spawn modes can yield zero stdout/stderr — Windows process/pipe handling is fragile; #44 is Windows.
- Node docs: Windows `detached: true` semantics differ (own console window, console-less when spawned from a detached parent) — relevant to #44's fire-and-forget pattern; not directly actionable for the watchdog.
- Pipe-buffer backpressure (generic OS fact): a full kernel pipe buffer blocks the writer. Plausible contributor when stdout is shell-redirected on Windows; **hypothesis, not confirmed** for #44.
- Industry watchdog best practice (consistent across LLM SDK ecosystems): **dual-layer** — an inactivity timer reset on every streamed chunk/event (typical 30-60s; longer grace while a tool executes) + an absolute wall-clock cap; escalation graceful-abort → hard-kill; **always emit the terminal record even when cleanup fails**.

**Discarded as fabricated** (claims Perplexity produced for SDK versions that don't exist — our prompt fed it the bogus "1.0.61"): "AbortController added ~1.0.35", "Windows process fixes in 1.0.42/1.0.51", "ping-aware streaming watchdog" (that citation is actually anthropics/anthropic-sdk-typescript#998). None of these inform the plan.

## Prior Learnings (institutional knowledge)

| ID | Source | Insight | Action for 026 |
|----|--------|---------|----------------|
| PL-01 | 025 plan D5 | Synthetic-event → manifest-write precedent exists end-to-end for `permission_denied` and `provider_stream_aborted` | Model the stall/budget terminal writes on it (`events.ts` creator + runner persistence) |
| PL-02 | 025 plan D6/T008 | `FakeAgentAdapter.setQueuedRun(..., { suppressFinalIdle: true })` simulates a never-settling stream | The watchdog's red tests ride this seam — no real timers needed |
| PL-03 | 025 fix-pass INS-002 | Injectable predicates/clocks double as deterministic interleave points | Watchdog timer must take an injectable clock/timer (vi.useFakeTimers or injected `now`/scheduler), mirroring `isProcessAlive` injection |
| PL-04 | 025 plan D4 | TS narrows closure-mutated `let`s inside catch blocks (the `inFlightMessage as ...` cast) | Same pattern will recur in stall-flag tracking |
| PL-05 | 025 retro INS-001 | Prefer `Record<union, T>` over ternary chains for rendering discriminated values | New `terminalReason` values in status TTY rendering |

## Domain Context

| Domain | Relationship | Touch |
|--------|-------------|-------|
| **adapter** | modify | bounded-cleanup `terminate()`/`disconnect()`, possible `forceStop` escalation, SDK 1.0.1 bump |
| **runner** | modify | stall watchdog in `handleEvent`, budgets in config/types, terminal-artifact-first ordering, `terminalReason` values |
| **cli** | modify | `--stall-timeout`/`--max-turns` flags (run + resume), default-timeout reconciliation, status/docs vocabulary, optional E170/E171 friendliness |

Existing contracts: `IAgentAdapter.terminate()` already public; `terminalReason` passes through `status`/`runs` generically; `computeStatusVerdict` untouched (a stalled run that gets terminalized becomes plain `failed`).

## Where the Watchdog Hooks (design seams, evidence-based)

1. **Observation**: `handleEvent` entry (`runner.ts:951`) — reset an inactivity deadline on every event (cheap; events already flow through one funnel).
2. **Trigger**: deadline expiry → set a `stalled` flag (mirror `timedOut`), emit synthetic `provider_stream_aborted`-style event with reason `stalled-stream` (PL-01), then settle the race (the watchdog can be a third arm of the `Promise.race`).
3. **Terminal-first ordering**: write `failed` + `terminalReason` + `completed.json` **before** (or raced ahead of) graceful cleanup — the artifact must never depend on the SDK cooperating (CD-01).
4. **Bounded cleanup ladder**: `session.abort()` raced vs ~5s → `session.destroy()` raced vs ~5s → `client.forceStop()` → done. Same bounding applied to the existing timeout path and the adapter `finally` `disconnect()`.
5. **Budgets**: wall-clock (`--timeout`, exists) and turns (`--max-turns`, new — count `stats.messages` or `session_idle` boundaries) share the same terminal-first machinery, distinct `terminalReason`s (`'timeout'`, `'max-turns'`, `'stalled-stream'`).
6. **Error codes**: E150–E172 region is sparse but E222+ is the clean block if a new CLI error is needed (likely not — runs end as `failed` with reasons, not CLI errors).

## Modification Considerations

- ✅ Safe: new config fields (`AgentRunConfig` additive), new terminalReason strings (status passes through), FakeAgentAdapter extensions.
- ⚠️ Caution: the `Promise.race` / `timedOut` / `adapterSettled` dance in `runner.ts:1124-1207` — adding a third race arm must respect the `.then()` chain's `timedOut` early-returns; the `handleEvent` `if (timedOut) return;` guard needs a stall-aware twin.
- ⚠️ Caution: docs vocabulary guard (`test/cli/docs-vocabulary.test.ts`, 025 T014) — new verdict/reason words must land in docs tables.
- 🚫 Danger: don't make `session.idle` semantics stricter (suppressing the final idle is how the fake simulates stalls; real streams may legitimately pause during tool execution — the inactivity timer must reset on **any** event including tool/thinking deltas, not just text deltas).

## E170/E171 friendliness (issue #44 minor note, 025 D2)

- E170 (`AMBIGUOUS_RUN_ID`) fires from `resolveRun({mode:'latest-active'})` with >1 active candidates (`run-resolver.ts:235-245`); `status` already has `--latest` to auto-pick. Friendlier default = auto-select newest with a notice, or compact listing.
- E171 (`RUN_NOT_FOUND`) when resolver nulls out. With 026 terminalizing stalls, accumulation of forever-`active` runs stops, which **mostly dissolves the reported pain**; remaining friendliness is a small, separable CLI task.

## External Research Opportunities

None outstanding — the Copilot-SDK question was researched in-line (above), with fabricated claims explicitly discarded. The one un-closable gap: the #44 reporter has not yet attached the sanitized `events.ndjson` tail; the stall anatomy above is grounded in code reading instead, and the watchdog design does not depend on which upstream cause applies (it defends against all of them).

## Recommendations

1. Fix CD-01 first conceptually: **terminal artifact must never depend on SDK cooperation** — bound every cleanup await, escalate to `forceStop`, write artifacts before/independent of cleanup.
2. Add the inactivity watchdog as a third race arm with its own `terminalReason: 'stalled-stream'`; default on (e.g. 120s, tool-tolerant), configurable/disable-able.
3. Add `--max-turns`; reconcile `run`/`resume` timeout defaults; write `terminalReason: 'timeout'`.
4. Bump SDK to 1.0.1 as a contained early task (lockfile + permission-shape pin + `.d.ts` sanity).
5. Treat Windows as documented-stance-only this plan (no Windows CI); the watchdog itself is the universal mitigation.
6. Keep E170/E171 friendliness as a small optional task or explicit non-goal — decide at spec time.

---
**Research Complete**: 2026-06-11T11:50:00Z
**Report Location**: docs/plans/026-stall-watchdog/research-dossier.md
