import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { loadMcpContext, type McpServerContext } from './context.js';
import { inboxAck, inboxList, inboxSend } from './tools/inbox.js';
import { stateGet, stateSet, stateTransition } from './tools/state.js';
import {
  errorResult,
  McpToolError,
  type McpToolResult,
  MINIH_COORDINATION_SERVER_NAME,
  normalizeMcpToolName,
  TOOL_CONTRACTS,
} from './types.js';

const SERVER_VERSION = '0.1.0';

export function createMinihMcpServer(context: McpServerContext): Server {
  const server = new Server(
    { name: MINIH_COORDINATION_SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listMinihMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    dispatchToolCall(
      context,
      request.params.name,
      request.params.arguments ?? {},
    ),
  );

  return server;
}

export function createMinihMcpServerFromEnv(
  env: Record<string, string | undefined> = process.env,
): { server: Server; context: McpServerContext } {
  const context = loadMcpContext(env);
  applyProcessMarker(context);
  return { server: createMinihMcpServer(context), context };
}

export function listMinihMcpTools(): Tool[] {
  return TOOL_CONTRACTS.map((contract) => ({
    name: contract.name,
    description: contract.description,
    inputSchema: contract.inputSchema,
  })) as Tool[];
}

export function dispatchToolCall(
  context: McpServerContext,
  name: string,
  args: Record<string, unknown>,
): CallToolResult {
  const toolName = normalizeMcpToolName(name);
  if (toolName === null) {
    return toCallToolResult(
      errorResult(new McpToolError('MCP_NOT_FOUND', 'unknown MCP tool')),
    );
  }

  try {
    switch (toolName) {
      case 'inbox_list':
        return toCallToolResult(inboxList(context, args));
      case 'inbox_send':
        return toCallToolResult(inboxSend(context, args));
      case 'inbox_ack':
        return toCallToolResult(inboxAck(context, args));
      case 'state_get':
        return toCallToolResult(stateGet(context, args));
      case 'state_set':
        return toCallToolResult(stateSet(context, args));
      case 'state_transition':
        return toCallToolResult(stateTransition(context, args));
    }
  } catch (error) {
    if (error instanceof McpToolError) {
      return toCallToolResult(errorResult(error));
    }
    return toCallToolResult(
      errorResult(new McpToolError('MCP_INTERNAL_ERROR', 'MCP tool failed')),
    );
  }
}

export function applyProcessMarker(context: McpServerContext): void {
  process.title = context.processMarker;
}

export function installSignalHandlers(server: Server): () => void {
  const shutdown = (): void => {
    void server.close().finally(() => {
      process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  };
}

export async function runStdioMcpServer(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const { server } = createMinihMcpServerFromEnv(env);
  installSignalHandlers(server);
  await server.connect(new StdioServerTransport());
}

function toCallToolResult(result: McpToolResult): CallToolResult {
  return result as CallToolResult;
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(process.argv[1]).href === import.meta.url
  );
}

if (isMainModule()) {
  runStdioMcpServer().catch((error: unknown) => {
    if (error instanceof McpToolError) {
      console.error(error.message);
    } else {
      console.error('failed to start minih coordination MCP server');
    }
    process.exitCode = 1;
  });
}
