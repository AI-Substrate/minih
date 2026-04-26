import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildInsideMcpServerConfig } from '../../../src/mcp/spawn.js';

export interface TestMcpClientOptions {
  runId: string;
  runDir: string;
  agentSlug: string;
  agentsDir: string;
}

export interface TestMcpClient {
  client: Client;
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

export async function createTestMcpClient(
  options: TestMcpClientOptions,
): Promise<TestMcpClient> {
  const config = buildInsideMcpServerConfig(options);
  const entry = config['minih-coordination'];
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: entry.env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'minih-test-client', version: '0.0.0' });
  await client.connect(transport);

  return {
    client,
    async callTool(name: string, args: Record<string, unknown> = {}) {
      return (await client.callTool({
        name,
        arguments: args,
      })) as CallToolResult;
    },
    async close() {
      await client.close();
    },
  };
}
