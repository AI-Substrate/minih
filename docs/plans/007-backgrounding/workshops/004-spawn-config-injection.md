# Workshop: Spawn-Config Injection & MCP Child Ergonomics

**Type**: Integration Pattern
**Plan**: 007-backgrounding
**Spec**: [coordination-spec.md](../coordination-spec.md)
**Created**: 2026-04-26
**Status**: Draft

**Related Documents**:
- [external-research/mcp-leak-validation.md](../external-research/mcp-leak-validation.md) — empirical validation of cleanup cascade; root-cause analysis
- [external-research/sdk-session-ttl.md](../external-research/sdk-session-ttl.md) — Issue #1132 context; minih's `client.stop()`-in-finally pattern
- [003-mcp-tool-surface.md](003-mcp-tool-surface.md) — defines the tools the spawned server exposes
- [001-filesystem-layout.md](001-filesystem-layout.md) — defines the paths the spawned server reads/writes
- [research-dossier.md](../research-dossier.md) — Plan 005's `mcpServers` threading pattern (PL-06)

**Domain Context**:
- **Primary Domain**: `mcp` (NEW — owns spawn module, baked-context contract, server entry point)
- **Related Domains**: `cli` (composition root that calls into `mcp` from `sdk-runtime`); `adapter` (threads the additional `mcpServers` entry into the SDK session config)

---

## Purpose

Specify the load-bearing mechanism that hides per-session context from agents. The MCP server child process is spawned by minih ahead of `createSession`, registered into the SDK's `mcpServers` config, and lives for the duration of one run. **The agent calls tools by name; never sees IDs or paths.** Get this pattern right and the inside surface stays clean forever.

## Key Questions Addressed

- Which MCP server library to use?
- How does per-run context get into the spawned child? (CLI args vs env vars vs both)
- How does the child handle SIGTERM cleanly so `client.stop()` cascade works?
- How does the regression test pgrep reliably for leaks?
- Authentication / trust model — does the child need a per-run secret?
- How does the inside-channel server coexist with user-supplied `--mcp-config` servers (Plan 005)?
- Failure modes if the MCP server crashes mid-session?

## Resolved Open Questions From Spec

- **Outside agent persona** → **PARTIALLY RESOLVED**: "outside" is whoever invokes minih CLI commands (humans, Claude Code, CI). There's no formal "outside agent" identity in v1; sender field is `'outside'|'inside'` (per workshop 001). If a future eventing plan needs to distinguish "background daemon outside" from "human outside," extend with `meta.principal` then.

---

## Library Choice: `@modelcontextprotocol/sdk`

**Decision**: use `@modelcontextprotocol/sdk` (npm: `@modelcontextprotocol/sdk`). The official TypeScript SDK from Anthropic for both MCP clients and servers. Stdio transport ships built-in.

**Why not alternatives:**
- `mcp-framework` — wrapper around the official SDK; nothing it adds that we need.
- Hand-rolled JSON-RPC stdio server — `scripts/mcp-test-server.cjs` already shows we *could* do this in ~80 lines. But the official SDK gives us versioning, schema-validated tool registration, and protocol updates for free. Worth the dep.

**Dep cost** (to be confirmed at install time): single dep + a small transitive set; size estimate ~200 KB unpacked. Confirm before committing.

**Back-out plan**: if the SDK proves unsuitable, the test server in `scripts/mcp-test-server.cjs` is the working reference for hand-rolling. ~120 LOC including framing and tool dispatch.

---

## Spawn Mechanism

### Where in the codebase

New module: `src/mcp/inside-server.ts` (or `.cjs` after build for the spawn target).

The spawn happens in `src/cli/commands/sdk-runtime.ts`, which is already the composition root. Just before `createSdkRuntime` returns its result — we add the inside-channel MCP server entry to the `mcpServers` config that flows into `createSession`.

### Spawn config (the contract)

The `mcpServers` config we add looks like:

```jsonc
{
  "minih-coordination": {
    "command": "node",
    "args": ["<absolute-path-to>/dist/mcp/inside-server.cjs"],
    "env": {
      "MINIH_MCP_RUN_ID":          "<runId>",
      "MINIH_MCP_RUN_DIR":         "<runDir>",
      "MINIH_MCP_AGENT_SLUG":      "<slug>",
      "MINIH_MCP_AGENTS_DIR":      "<absolute agentsDir>",
      "MINIH_MCP_INBOX_DIR":       "<agentsDir>/<slug>/inbox",
      "MINIH_MCP_STATE_DIR":       "<agentsDir>/<slug>/state",
      "MINIH_MCP_SIDE":            "inside",
      "MINIH_MCP_PROCESS_MARKER":  "minih-mcp-<runId>",
      "NODE_NO_WARNINGS":          "1"
    }
  }
}
```

### Path resolution for the spawned server (didyouknow #4 — 2026-04-26)

The `args[0]` path is resolved at spawn time using `fileURLToPath(new URL('./inside-server.cjs', import.meta.url))` from `src/mcp/spawn.ts`:

- **Dev** (`npm run dev` via tsx): `import.meta.url` resolves to the `src/mcp/spawn.ts` location; `./inside-server.cjs` → `src/mcp/inside-server.cjs` (we ship a CJS server entry alongside the TS source for dev).
- **Built** (`npm run build && node dist/...`): `import.meta.url` resolves to `dist/mcp/spawn.js`; `./inside-server.cjs` → `dist/mcp/inside-server.cjs`.
- **System-wide install** (`npm i -g minih` or `npx -y minih`): same as Built — npm resolves the package and `import.meta.url` carries the installed location regardless of cache directory.

**Stance**: minih is intended for system-wide install (`npm i -g minih`) or `npx -y minih`. We don't bake env-detection or alternative resolution paths into spawn. Outside-side validation (e.g., `which minih` + `minih doctor` in a host CI script before delegating coordination work) is the **outside agent's** concern, not minih's. If `inside-server.cjs` can't be located at spawn time, the SDK surfaces the spawn failure cleanly via `events.ndjson` and `completed.json`; the outside agent's pre-flight should have caught this earlier.

The server name `minih-coordination` is part of the MCP namespace and shows up in `tools/list` outputs. Tool names get prefixed by the server name in some MCP clients (rendered as `minih-coordination/inbox.list`); in our own logging we strip back to bare names.

### Why env vars (not CLI args) for context

| Property | env vars | CLI args |
|----------|----------|----------|
| Visibility in `ps` output | private (only owner can see env) | visible to anyone (`ps -ef`) |
| Logging hygiene | not in standard logs | leaks into shell history, cron logs, CI logs |
| Security at scale | inheriting env is intentional, opt-out | inheriting argv is hard to redact |
| Editing during dev | `process.env.X = ...` in Node REPL | re-spawn required |
| Conventional precedent | matches existing `MINIH_*` env vars (PL-12) | inconsistent with existing pattern |

Env vars win on every axis we care about. (We could put `MINIH_MCP_PROCESS_MARKER` in argv too if `ps` visibility helps debugging — see "Process marker" below — but the *context* values stay in env.)

### Spawn ordering

```
1. minih run <slug>
2. resolveAgent → AgentDefinition
3. createSdkRuntime → CopilotClient + adapter
4. (NEW) build inside-coordination spawn config
5. (Plan 005) load user --mcp-config or auto-discover .mcp.json
6. (NEW) merge user mcpServers + minih-coordination entry
7. runAgent → adapter.run({ mcpServers: <merged> }) → SDK createSession
   ↓
   SDK spawns minih-coordination child + any user MCP children
   ↓
   Agent receives tools/list including ours
   ↓
   Agent calls tools as needed
8. Run completes / fails / times out / SIGINT
9. finally { runtime.cleanup() }
   ↓
   client.stop() → cliProcess.kill() → cascade kills minih-coordination + user MCP children
```

The merge step (6) preserves user's right to ship their own MCP servers (per Plan 005) AND adds ours. Tool name collisions detected at step 7 (the SDK calls `tools/list` against each server; collisions would surface as either: an error from the SDK, or two tools with the same name where the most-recently-registered wins). We'll explicitly check at step 6 — if any user server registered `inbox.*` or `state.*` tool names, we error out at startup with a clear message (AC-MCP-COEXIST).

### Merge rule

```ts
// pseudo-code in sdk-runtime.ts after createSdkRuntime
const userMcp = await loadMcpConfig(opts.mcpConfig); // Plan 005
const insideMcp = buildInsideMcpEntry({ runId, runDir, slug, agentsDir });
const mergedMcp = { ...userMcp.mcpServers, 'minih-coordination': insideMcp };

// Pre-flight: refuse if a user server claims minih-coordination namespace
if (userMcp.mcpServers?.['minih-coordination']) {
  exitWithEnvelope(formatError('run', ErrorCodes.MCP_NAMESPACE_RESERVED,
    `'minih-coordination' is a reserved MCP server name in minih. Rename your server in --mcp-config.`));
}

config.mcpServers = mergedMcp;
```

Tool-name collision (e.g. user MCP server defines `inbox.list`) is detected lazily by the SDK at `tools/list` time; we surface it as an error in `events.ndjson` and `completed.json`, not at pre-flight (we don't know what tools a user MCP exposes without spawning it).

---

## The MCP Server Process — `dist/mcp/inside-server.cjs`

### Skeleton

```ts
// src/mcp/inside-server.ts (compiled to dist/mcp/inside-server.cjs)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools, dispatchToolCall } from './tools.js';
import { loadContextFromEnv, type SpawnContext } from './context.js';

async function main() {
  // 1. Title for ps visibility
  if (process.env.MINIH_MCP_PROCESS_MARKER) {
    process.title = process.env.MINIH_MCP_PROCESS_MARKER;
  }

  // 2. Load and validate baked context
  const ctx: SpawnContext = loadContextFromEnv();

  // 3. Construct MCP server
  const server = new Server({
    name: 'minih-coordination',
    version: '0.1.0',
  }, {
    capabilities: { tools: {} },
  });

  // 4. Register the six tools (see workshop 003)
  server.setRequestHandler(/* ListToolsRequestSchema */, async () => ({ tools }));
  server.setRequestHandler(/* CallToolRequestSchema */, async (req) => dispatchToolCall(req, ctx));

  // 5. Signal handlers — clean exit on SIGTERM/SIGINT
  let exiting = false;
  const onSignal = async (sig: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    try {
      await server.close();
    } catch { /* noop */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT',  () => onSignal('SIGINT'));

  // 6. Start the stdio transport
  await server.connect(new StdioServerTransport());

  // Server runs forever (until parent kills us)
}

main().catch((err) => {
  process.stderr.write(`[minih-mcp] fatal: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
```

### `loadContextFromEnv` — strict validation

```ts
// src/mcp/context.ts

export interface SpawnContext {
  runId: string;
  runDir: string;
  agentSlug: string;
  agentsDir: string;
  inboxDir: string;
  stateDir: string;
  side: 'inside';
  processMarker: string;
}

const REQUIRED = [
  'MINIH_MCP_RUN_ID', 'MINIH_MCP_RUN_DIR', 'MINIH_MCP_AGENT_SLUG',
  'MINIH_MCP_AGENTS_DIR', 'MINIH_MCP_INBOX_DIR', 'MINIH_MCP_STATE_DIR',
  'MINIH_MCP_SIDE', 'MINIH_MCP_PROCESS_MARKER',
];

export function loadContextFromEnv(): SpawnContext {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`minih-mcp spawn config incomplete; missing env vars: ${missing.join(', ')}`);
  }
  if (process.env.MINIH_MCP_SIDE !== 'inside') {
    throw new Error(`MINIH_MCP_SIDE must be 'inside' (v1); got ${process.env.MINIH_MCP_SIDE}`);
  }
  return {
    runId:         process.env.MINIH_MCP_RUN_ID!,
    runDir:        process.env.MINIH_MCP_RUN_DIR!,
    agentSlug:     process.env.MINIH_MCP_AGENT_SLUG!,
    agentsDir:     process.env.MINIH_MCP_AGENTS_DIR!,
    inboxDir:      process.env.MINIH_MCP_INBOX_DIR!,
    stateDir:      process.env.MINIH_MCP_STATE_DIR!,
    side:          'inside',
    processMarker: process.env.MINIH_MCP_PROCESS_MARKER!,
  };
}
```

Strict validation at startup means a misconfigured spawn dies immediately with a clear stderr line — much easier to debug than a silent half-functional server.

### Tool dispatch — domain dependency direction

```ts
// src/mcp/tools.ts — depends on src/runner/{folder,state,validator}

import { isAllowedTransition, loadStateLazy, writeStateAtomic, appendHistory } from '../runner/state.js';
import { loadInboxLane, appendInboxMessage } from '../runner/folder.js';

export const tools = [
  { name: 'inbox.list',       inputSchema: INBOX_LIST_SCHEMA,       description: '...' },
  { name: 'inbox.send',       inputSchema: INBOX_SEND_SCHEMA,       description: '...' },
  { name: 'inbox.ack',        inputSchema: INBOX_ACK_SCHEMA,        description: '...' },
  { name: 'state.get',        inputSchema: STATE_GET_SCHEMA,        description: '...' },
  { name: 'state.set',        inputSchema: STATE_SET_SCHEMA,        description: '...' },
  { name: 'state.transition', inputSchema: STATE_TRANSITION_SCHEMA, description: '...' },
];

export async function dispatchToolCall(req: CallToolRequest, ctx: SpawnContext) {
  switch (req.params.name) {
    case 'inbox.list':       return inboxList(req.params.arguments, ctx);
    case 'inbox.send':       return inboxSend(req.params.arguments, ctx);
    case 'inbox.ack':        return inboxAck(req.params.arguments, ctx);
    case 'state.get':        return stateGet(req.params.arguments, ctx);
    case 'state.set':        return stateSet(req.params.arguments, ctx);
    case 'state.transition': return stateTransition(req.params.arguments, ctx);
    default: throw mcpError('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`);
  }
}
```

The `mcp` domain depends on `runner` (state.ts, folder.ts) and on the MCP SDK. It does NOT depend on `cli` or `adapter`. **Import direction**: `cli → mcp → runner → adapter` (sibling sub-edge `cli → runner` already exists).

The `mcp` server child has its own runtime — when running, it imports `runner` modules but does NOT touch the SDK or CLI. So no circular dependency at runtime either.

---

## Process Marker for Regression Test

### Why a marker

The spec's AC-MCP-CLEAN regression test needs to assert "no inside-channel MCP servers running 5s after run completion." A `pgrep` filter must uniquely identify the inside-channel server WITHOUT matching:
- minih's main process
- the SDK's bundled CLI
- user-supplied MCP servers
- shell processes from the test framework

### How

Two layers:

1. **`process.title = 'minih-mcp-<runId>'`** at server startup. `ps -axco command` will show this title on macOS and Linux. Distinct, run-unique, easy to grep.

2. **`MINIH_MCP_PROCESS_MARKER` env var** carrying the same value. `pgrep -f` (which matches arg list) won't see env, but on macOS `ps -E` does. On Linux, `cat /proc/<pid>/environ` does. Multiple grep paths.

### Regression test pseudocode

```ts
// test/coordination/mcp-cleanup.test.ts
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const runId = '2026-04-26T11-47-11-359Z-3a87';
const marker = `minih-mcp-${runId}`;

it('inside-channel MCP server is reaped within 5s of run completion', async () => {
  // Run the smoke-test agent (assume it's coordinated)
  execSync(`node dist/cli/index.js run mcp-coordination-smoke --model gpt-5.5 --no-reasoning`);

  // Immediately after run completes (synchronous execSync above blocks until exit):
  let aliveAt0 = pgrepCount(marker);
  // (could be 0 or 1 — process may already be reaped)

  await sleep(5000);
  let aliveAt5 = pgrepCount(marker);

  expect(aliveAt5).toBe(0);
});

function pgrepCount(marker: string): number {
  try {
    const stdout = execSync(`pgrep -f "${marker}"`).toString();
    return stdout.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0; // pgrep exits non-zero if no matches
  }
}
```

Note: the smoke-test agent for this is a new fixture — `agents/mcp-coordination-smoke/` — that exercises a representative inbox + state flow. Workshop 006 covers test fixtures; this regression test piggybacks on the smoke-test agent.

---

## Authentication & Trust

### Threat model (mini)

- **Adversary**: a malicious agent prompt running inside the SDK session that wants to spoof inbox messages, force state transitions, or leak baked-in context to disk.
- **Boundaries**: the MCP server only reads/writes inside `<agentsDir>/<slug>/{inbox,state}/`. Refuses paths that escape. Never echoes baked env vars in tool results.

### Trust by process descent

The MCP server child inherits its env from its parent (the SDK's bundled CLI process), which inherited it from minih. The agent inside the session can only call tools through MCP-RPC; it cannot read the MCP server's env vars or argv directly.

So the chain is:
1. minih spawns SDK CLI with mcpServers config (including our spawn entry).
2. SDK CLI spawns the MCP child with the env from the spawn config.
3. Agent calls tools via MCP RPC; the MCP child uses its env to resolve paths.
4. Agent sees only tool inputs/outputs. Never sees env, never sees argv.

**No per-session secret needed.** The MCP child only listens on stdio (no socket). Its parent is the SDK CLI; only its parent can talk to it. Process descent is the trust anchor.

### Path-safety in tool implementations

Every file path computed in tool implementations is built from `ctx.inboxDir`/`ctx.stateDir` plus a fixed leaf — never agent input. This is the structural guarantee: even a buggy agent calling `inbox.send({type: '../../../../etc/passwd', ...})` can't reach outside the inbox directory because the type field doesn't get used as a path component.

If a future tool ever takes a path-shaped input (e.g., `state.attach({file: '...'})`), enforce `path.resolve(ctx.stateDir, file).startsWith(ctx.stateDir)` before using.

---

## Cleanup Cascade — How `client.stop()` reaps the MCP child

### The chain (validated empirically)

```
minih main process (Node)
  └─ spawns SDK CLI as child via createSession
       └─ SDK CLI spawns minih-coordination MCP server as child
            (also spawns any user-configured MCP servers)
```

When `client.stop()` is called in `sdk-runtime.ts:201` finally:

1. `client.stop()` calls `client.ts:537 → this.cliProcess.kill()`.
2. SDK CLI process receives SIGTERM (default) → exits cleanly OR is force-killed.
3. SDK CLI's children (the MCP servers) are in the same process group (`detached: false` is the default).
4. Process-group cleanup: when SDK CLI exits, OS reaps its children that are in the same group.
5. Within ~1-5s, all child MCP servers are gone.

### What happens on SIGINT (Ctrl+C)

`sdk-runtime.ts:191` installs a SIGINT handler that calls:
1. `onSigint?.()` (pretty.cleanup)
2. `process.stderr.write` interruption notice
3. `process.exit(130)`

`process.exit(130)` terminates minih directly. The SDK's cleanup doesn't run via the explicit `client.stop()` path — instead:
1. minih main process dies.
2. OS cleans up minih's child (the SDK CLI) by closing its stdin (parent died).
3. SDK CLI detects parent death and exits.
4. SDK CLI's children (MCP servers) cascade-die.

This is slightly less clean than the explicit `client.stop()` path; small risk of "zombie second" where MCP server hasn't noticed parent death yet. To be safer, we could add an `onSigint` callback that explicitly calls `client.stop()` first — but this complicates the SIGINT handler. Punt to AC-MCP-CLEAN observed behavior.

### What happens on timeout

`runner.ts` calls `adapter.terminate(sessionId)` on timeout. Then the run completes and `finally { runtime.cleanup(); }` calls `client.stop()`. Same cleanup chain as success.

### What happens if the MCP server itself crashes mid-tool-call

The SDK observes the child died, propagates a tool error to the agent (typically a generic "tool failed" message). The session continues; agent can retry. minih's main process is unaffected.

If we observe agents getting confused by mid-call MCP crashes, we can add a "MCP server health check" before each session start — but that's overkill for v1.

---

## Failure-Mode Catalog

| Failure | Detection | Remediation |
|---------|-----------|-------------|
| Spawn config missing required env var | MCP child throws on startup, exits 1 | Fix sdk-runtime spawn entry; check unit tests cover all env vars |
| MCP child process never starts (path wrong, node missing) | SDK CLI logs `tools/list` failure; agent doesn't see our tools | Pre-flight in sdk-runtime: stat the dist/mcp/inside-server.cjs path before adding to mcpServers; clear error if missing |
| Tool name collision with user MCP server | `tools/list` returns conflicting names; SDK behavior is undefined (last-wins typically) | Pre-flight refuse if user names `minih-coordination`; document that `inbox.*`/`state.*` are reserved namespaces (will not pre-detect collisions on tool names — too brittle); surface collision errors that the SDK reports in `events.ndjson` |
| MCP child crashes mid-call | Tool call returns error to agent | Tool error text suggests retry; AC-MCP-CLEAN test ensures dead child is reaped |
| MCP child writes to inbox/state but parent crashes before run finishes | Inbox/state files are partially updated | Append-only NDJSON tolerates partial lines (consumer skips malformed lines); state.json uses write-then-rename so it's never partial |
| Two minih runs of the same agent in parallel | Both spawn their own MCP children; both write to same inbox/state files | Concurrent appends safe; concurrent state.json writes = last-wins (v1 acceptable; document) |
| `client.stop()` never called (caller bypassed our cleanup pattern) | MCP child becomes orphan | Documented as a contract violation; AC-MCP-CLEAN test ensures the official path always reaps; defense-in-depth = startup reaper in plan 008+ daemon |

---

## Diagram: Process Tree at Steady State

```
minih (PID 12345)                                node dist/cli/index.js run my-agent
└─ copilot --headless (PID 12346)                @github/copilot-darwin-arm64/copilot
   ├─ minih-coordination (PID 12347)             node dist/mcp/inside-server.cjs   ← OUR SPAWN
   │                                             [process.title = "minih-mcp-<runId>"]
   │                                             [env = MINIH_MCP_*]
   │
   ├─ user-mcp-server-foo (PID 12348)            (if user supplied --mcp-config)
   │
   └─ user-mcp-server-bar (PID 12349)            (if user supplied --mcp-config)
```

Cleanup at run end: `client.stop()` SIGTERMs PID 12346 → 12347, 12348, 12349 cascade-die within ~1-5s.

---

## Quick Reference

```ts
// In sdk-runtime.ts after createSdkRuntime, before runAgent:
import { buildInsideMcpEntry } from '../../mcp/spawn-config.js';

const insideMcpEntry = buildInsideMcpEntry({
  runId, runDir, agentSlug: definition.slug, agentsDir,
});
const userMcpServers = userMcpConfig?.mcpServers ?? {};

if ('minih-coordination' in userMcpServers) {
  exitWithEnvelope(formatError('run', ErrorCodes.MCP_NAMESPACE_RESERVED,
    `'minih-coordination' is reserved by minih. Rename your MCP server in --mcp-config.`));
}

config.mcpServers = { ...userMcpServers, 'minih-coordination': insideMcpEntry };
```

```bash
# Manual leak check (to mirror the regression test)
node dist/cli/index.js run my-agent  # blocks until done
sleep 5
pgrep -f "minih-mcp-" && echo "LEAKED!" || echo "clean"
```

---

## Open Questions

### Q1: Should the spawn entry be opt-out for non-coordinated agents?

**OPEN** (relates to workshop 005 / frontmatter): if an agent has `coordination: disabled` in frontmatter, should we skip the spawn entirely? Saves ~50ms cold-start per run.
- **Leaning**: yes, opt out at the spawn level when frontmatter says so. Default `coordination` is opt-in in the prompt-additions sense; opt-out in the spawn sense (= don't spawn unless something opts in). Workshop 005 will pin the toggling semantics.

### Q2: Bundle the MCP server as a separate npm-published binary?

**OPEN**: today the inside-server lives at `dist/mcp/inside-server.cjs`. If users install minih globally, the path is stable. If they `npx minih`, the path resolves through npm cache.
- **Leaning**: keep in the same package; resolve path via `__dirname` from `sdk-runtime.ts` so it works under both global and npx install.

### Q3: How does the spawn pattern handle being run via `npx`?

**OPEN**: the `command: "node"` + `args: [<path-to-inside-server.cjs>]` requires the path to be readable by the SDK CLI. Under npx, that path is in the npm cache; it's stable for the duration of the npx invocation but not across.
- **Leaning**: resolve absolute path at spawn time using `import.meta.url` or `__dirname`; should work under all installation modes. Test under `npx minih` as part of acceptance.

### Q4: Should we pass the entire `AgentDefinition` (or run config) to the MCP server?

**OPEN**: the server might want to know the agent's frontmatter (e.g., custom transition rules). Today the spawn config only carries paths.
- Pro: server can validate transitions against per-agent rules without re-reading frontmatter.
- Con: extra plumbing; rules can be reloaded from disk easily (frontmatter is already in the run folder snapshot).
- **Leaning**: server reads `<runDir>/prompt.md` itself to get frontmatter rules. Self-sufficient; no extra spawn-config field. Document.

### Q5: What about `outside`-side MCP server in the future?

**OPEN** (out of scope for v1): if a "outside agent" persona ever materializes (e.g., a daemon orchestrator that itself uses MCP), it would have its own MCP server with `MINIH_MCP_SIDE=outside`. Today we hardcode `inside` at the spawn entry and validate it in `loadContextFromEnv`. Forward-compatible with `side` parameterization later.

### Q6: Should the spawn entry forward `GH_TOKEN` to the MCP child?

**OPEN**: probably not — the MCP child only reads/writes filesystem; doesn't talk to GitHub. But if we ever add tools that do, env-forwarding becomes load-bearing.
- **Leaning**: don't forward sensitive env to the MCP child unless a tool needs it. Keep the spawn env minimal.
