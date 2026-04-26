# Domain: mcp

**Purpose**: Provides the inside-only MCP coordination server that lets an agent read/write its per-agent inbox and state during a coordinated run.

## Boundary

**Owns**: MCP tool contracts, hidden run-context validation, stdio server startup, tool dispatch, inside-server spawn config, MCP-specific integration/leak tests

**Excludes**: CLI command parsing (cli), run orchestration and artifact lifecycle (runner), SDK session management (adapter), outside CLI surface (future Phase 5)

## Composition

| File | Classification | Purpose |
|------|----------------|---------|
| `src/mcp/types.ts` | contract | Six tool names, input schemas, result/error envelope helpers, MCP error codes |
| `src/mcp/context.ts` | contract | Hidden context loader/validator for baked run env; canonical path containment and redacted errors |
| `src/mcp/tools/inbox.ts` | internal | `inbox.list`, `inbox.send`, `inbox.ack` over append-only NDJSON lanes |
| `src/mcp/tools/state.ts` | internal | `state.get`, `state.set`, `state.transition` over runner state helpers and schema validation |
| `src/mcp/server.ts` | internal | Stdio MCP server, six-tool manifest, dispatcher, signal cleanup, process marker |
| `src/mcp/spawn.ts` | contract | `buildInsideMcpServerConfig(...)` and private server-entry resolution |
| `src/mcp/index.ts` | contract | Barrel exports for CLI composition and tests |
| `test/mcp/*.test.ts` | test | Contract, tool, dispatcher, spawn, coexistence, real stdio, and leak-regression coverage |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `buildInsideMcpServerConfig(options)` | Function | cli (`run`, `resume`) |
| `resolveInsideMcpServerEntry(moduleUrl?)` | Function | mcp spawn config tests |
| `MINIH_COORDINATION_SERVER_NAME` | Const | mcp tests, future collision checks |
| `MCP_TOOL_NAMES` / `TOOL_CONTRACTS` | Const | mcp server, tests |
| `loadMcpContext(env?)` / `McpServerContext` | Function/Type | mcp server/tools |
| `MCP_ENV_KEYS` | Const | mcp spawn config and tests |
| `McpToolError` / `McpErrorCode` | Error/Type | mcp tools/server |
| `createMinihMcpServer(context)` / `runStdioMcpServer(env?)` | Function | private server entrypoint, real stdio tests |
| `dispatchToolCall(context, name, args)` | Function | mcp dispatcher tests |

## Concepts

| Concept | Definition |
|---------|------------|
| Inside-only MCP surface | The server is spawned per coordinated run for the inside agent. It is not a public external `minih serve --mcp` mode. |
| Hidden baked context | Spawn config bakes `runId`, `runDir`, `agentSlug`, `agentsDir`, inbox/state directories, side, and process marker into env so the model never passes paths or run IDs. |
| Runner env reuse | The context contract reuses `MINIH_INBOX_DIR`, `MINIH_STATE_DIR`, and `MINIH_CONTEXT`; MCP adds only `MINIH_MCP_*` run metadata. |
| Append-only inbox | `inbox.send` and `inbox.ack` append single-line NDJSON records to the inside lane; `inbox.list({ unread: true })` reconstructs unread from peer messages and own ack records. |
| State as data | State tools use runner persistence helpers. `state.transition` validates status through inside-state JSON Schema and appends history; it does not enforce peer-gated rules. |
| Private server artifact | Spawn config resolves `dist/mcp/server.js` as an implementation detail in dev/package modes; the artifact path is not a user-facing contract. |
| Leak marker | Spawned server sets `process.title` to `minih-mcp-<runId>` so opt-in tests can assert cleanup without broad process killing. |

## Dependencies

### This Domain Depends On

| Domain | Contract Used |
|--------|---------------|
| runner | `inboxLanePath`, `stateFilePath`, `historyPath`, `readStateLazy`, `writeState`, `appendHistory`, `ulid`, coordination types/schemas |

### Domains That Depend On This

| Domain | Contract Used |
|--------|---------------|
| cli | `buildInsideMcpServerConfig(...)` as the composition-root factory supplied to runner |

## History

| Phase | Changes |
|-------|---------|
| 007-backgrounding P4 | Created MCP domain with six inside tools, redacted context validation, stdio server, spawn config, runner/CLI merge seam, coexistence tests, real stdio MCP tests, and opt-in process-marker leak regression. |
