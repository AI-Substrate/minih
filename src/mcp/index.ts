/**
 * MCP domain public barrel.
 *
 * CLI imports `buildInsideMcpServerConfig()` from here at the composition
 * boundary and passes it to runner as a generic factory. Runner must not import
 * this domain directly.
 */

export {
  coordinationEnvKeys,
  loadMcpContext,
  MCP_ENV_KEYS,
  McpContextError,
  type McpServerContext,
} from './context.js';
export {
  applyProcessMarker,
  createMinihMcpServer,
  createMinihMcpServerFromEnv,
  dispatchToolCall,
  installSignalHandlers,
  listMinihMcpTools,
  runStdioMcpServer,
} from './server.js';
export {
  type BuildInsideMcpServerConfigOptions,
  buildInsideMcpServerConfig,
  type MinihMcpServerEntry,
  resolveInsideMcpServerEntry,
} from './spawn.js';
// Plan 027 Phase 4 — `coordination_status` tool exported for unit-test
// importability (a deliberate deviation from the permission-status precedent,
// PIC-E).
export {
  type CoordinationStatusResult,
  coordinationStatus,
} from './tools/coordination-status.js';
export {
  errorResult,
  isMcpToolName,
  jsonResult,
  MCP_TOOL_NAMES,
  type McpErrorCode,
  McpToolError,
  type McpToolName,
  type McpToolResult,
  MINIH_COORDINATION_SERVER_NAME,
  TOOL_CONTRACTS,
} from './types.js';
