# Domain: mcp

**Purpose**: Provides the inside-only MCP coordination server that lets an agent read/write the active run's inbox and state during a coordinated run.

## Boundary

**Owns**: MCP tool contracts, hidden run-context validation, stdio server startup, tool dispatch, inside-server spawn config, MCP-specific integration/leak tests

**Excludes**: CLI command parsing and outside peer commands (cli), run orchestration and artifact lifecycle (runner), SDK session management (adapter), daemon-light file forwarders (runner), public server lifecycle commands. There is intentionally no `minih serve --mcp`; the server is spawned only as a private per-run inside agent server.

## Composition

| File | Classification | Purpose |
|------|----------------|---------|
| `src/mcp/types.ts` | contract | Six tool names, input schemas including bounded `inbox_list.waitMs`, result/error envelope helpers, MCP error codes |
| `src/mcp/context.ts` | contract | Hidden context loader/validator for baked run env; canonical path containment and redacted errors |
| `src/mcp/tools/inbox.ts` | internal | `inbox_list`, `inbox_send`, `inbox_ack` over append-only NDJSON lanes, including bounded long-poll reads for peer messages |
| `src/mcp/tools/state.ts` | internal | `state_get`, `state_set`, `state_transition` over runner state helpers and schema validation |
| `src/mcp/server.ts` | internal | Stdio MCP server, six-tool manifest, async-safe dispatcher, signal cleanup, process marker |
| `src/mcp/spawn.ts` | contract | `buildInsideMcpServerConfig(...)` and private server-entry resolution |
| `src/mcp/index.ts` | contract | Barrel exports for CLI composition and tests |
| `test/mcp/*.test.ts` | test | Contract, tool, dispatcher, spawn, coexistence, real stdio, and leak-regression coverage |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `buildInsideMcpServerConfig(options)` | Function | cli (`run`, `resume`) |
| `resolveInsideMcpServerEntry(moduleUrl?)` | Function | mcp spawn config tests |
| `MINIH_COORDINATION_SERVER_NAME` | Const | mcp tests, future collision checks |
| `MCP_TOOL_NAMES` / `TOOL_CONTRACTS` / `MAX_INBOX_WAIT_MS` | Const | mcp server, tools, tests |
| `loadMcpContext(env?)` / `McpServerContext` | Function/Type | mcp server/tools |
| `MCP_ENV_KEYS` | Const | mcp spawn config and tests |
| `McpToolError` / `McpErrorCode` | Error/Type | mcp tools/server |
| `createMinihMcpServer(context)` / `runStdioMcpServer(env?)` | Function | private server entrypoint, real stdio tests |
| `dispatchToolCall(context, name, args)` | Async Function | mcp server, dispatcher tests |
| Six coordination tools | MCP tools | `inbox_list`, `inbox_send`, `inbox_ack`, `state_get`, `state_set`, and `state_transition` |

## Concepts

The inside MCP server exposes exactly six coordination tools to the active inside agent:

- Inbox: `inbox_list`, `inbox_send`, `inbox_ack`
- State: `state_get`, `state_set`, `state_transition`

All tool handlers are backed by hidden baked context, not by client-supplied path arguments. The context bakes `runId`, `runDir`, `agentSlug`, `agentsDir`, inbox/state directories, side, and the process marker into the private server environment after the runner has allocated the run, keeping the MCP client scoped to the current run's coordination files and artifacts.

| Concept | Definition |
|---------|------------|
| Inside-only MCP surface | The server is spawned per coordinated run for the inside agent. It is not a public external `minih serve --mcp` mode. |
| Hidden baked context | Spawn config bakes `runId`, `runDir`, `agentSlug`, `agentsDir`, run-scoped inbox/state directories, side, and process marker into env so the model never passes paths or run IDs. |
| Runner env reuse | The context contract reuses `MINIH_INBOX_DIR`, `MINIH_STATE_DIR`, and `MINIH_CONTEXT`; MCP adds only `MINIH_MCP_*` run metadata. |
| Append-only inbox | `inbox_send` and `inbox_ack` append single-line NDJSON records to the inside lane; `inbox_list({ unread: true })` reconstructs unread from peer messages and own ack records. |
| State as data | State tools use runner persistence helpers. `state_transition` validates status through inside-state JSON Schema and appends history; it does not enforce peer-gated rules. |
| Blocking inbox read | `inbox_list({ unread: true, type, waitMs })` can wait up to `MAX_INBOX_WAIT_MS` for a filter-matching outside-lane message, returning explicit `wait` metadata on match or timeout while preserving immediate response shape when omitted or zero. |
| Private server artifact | Spawn config resolves `dist/mcp/server.js` as an implementation detail in dev/package modes; the artifact path is not a user-facing contract. |
| Leak marker | Spawned server sets `process.title` to `minih-mcp-<runId>` so opt-in tests can assert cleanup without broad process killing. |

The current supported validation surface is the MCP server/spawn/leak test suite (`test/mcp/*.test.ts`, including `MINIH_PGREP=1 npx vitest run test/mcp/leak-regression.test.ts`). The cleanup requirement traces to MCP workshop Finding 02 and validates success, failure, timeout, and interrupt paths. Workshop 009 documents a future standalone probe-harness idea; it is not an existing `scripts/mcp-harness.mjs` command.

## Dependencies

### This Domain Depends On

| Domain | Contract Used |
|--------|---------------|
| runner | `CoordinationRunLocation`, `inboxLanePath`, `stateFilePath`, `historyPath`, `watchFileChanges`, `readStateLazy`, `writeState`, `appendHistory`, `ulid`, coordination types/schemas |

### Domains That Depend On This

| Domain | Contract Used |
|--------|---------------|
| cli | `buildInsideMcpServerConfig(...)` as the composition-root factory supplied to runner |

## History

| Phase | Changes |
|-------|---------|
| 007-backgrounding P4 | Created MCP domain with six inside tools, redacted context validation, stdio server, spawn config, runner/CLI merge seam, coexistence tests, real stdio MCP tests, and opt-in process-marker leak regression. |
| 007-backgrounding P7 | Finalized the domain doc wording for the completed inside-only six-tool server, public/outside CLI boundary, hidden baked context, private spawn lifecycle, and leak-validation provenance. |
| 008-canonical-coordination-loop | Changed the exposed MCP tool manifest to backend-safe underscore names (`inbox_list`, `state_get`, etc.) after live CAPI 400 failures with dotted names; kept dotted names as local dispatcher aliases. |
| 008 FX001 | Moved hidden context validation and all inside tools to run-scoped `runs/<runId>/{inbox,state}` paths, rejecting agent-scoped directories. |
| 008 FX002 | Added bounded `waitMs` long-poll support to private `inbox_list`, made MCP dispatch async-safe, and covered direct plus real stdio wait behavior. |
