import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCP_ENV_KEYS, type McpServerContext } from '../../src/mcp/context.js';
import {
  applyProcessMarker,
  createMinihMcpServerFromEnv,
  dispatchToolCall,
  listMinihMcpTools,
} from '../../src/mcp/server.js';
import { MCP_TOOL_NAMES } from '../../src/mcp/types.js';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

let tmpDir: string;
let context: McpServerContext;
let oldProcessTitle: string;

beforeEach(() => {
  oldProcessTitle = process.title;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-server-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const agentSlug = 'code-review';
  const agentDir = path.join(agentsDir, agentSlug);
  context = {
    context: 'inside',
    side: 'inside',
    runId: 'run-123',
    runDir: path.join(agentDir, 'runs', 'run-123'),
    agentSlug,
    agentsDir,
    agentDir,
    inboxDir: path.join(agentDir, 'runs', 'run-123', 'inbox'),
    stateDir: path.join(agentDir, 'runs', 'run-123', 'state'),
    processMarker: 'minih-mcp-run-123',
  };
  fs.mkdirSync(context.runDir, { recursive: true });
});

afterEach(() => {
  process.title = oldProcessTitle;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP server dispatcher', () => {
  it('lists exactly the six coordination tools', () => {
    const tools = listMinihMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
    expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(
      true,
    );
  });

  it('dispatches successful tool calls', () => {
    const result = dispatchToolCall(context, 'inbox_send', {
      subject: 'Hello',
      body: 'World',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      message: { sender: 'inside', subject: 'Hello', body: 'World' },
    });
  });

  it('dispatches typed tool errors through _meta.code', () => {
    const result = dispatchToolCall(context, 'inbox_ack', { msgId: 'missing' });

    expect(result.isError).toBe(true);
    expect(result._meta?.code).toBe('MCP_NOT_FOUND');
  });

  it('accepts legacy dotted tool names without exposing them in the manifest', () => {
    const result = dispatchToolCall(context, 'inbox.send', {
      subject: 'Hello',
      body: 'World',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      message: { sender: 'inside', subject: 'Hello', body: 'World' },
    });
  });

  it('rejects unknown tools without throwing', () => {
    const result = dispatchToolCall(context, 'unknown.tool', {});

    expect(result.isError).toBe(true);
    expect(result._meta?.code).toBe('MCP_NOT_FOUND');
  });

  it('loads context from env and applies the process marker', () => {
    const env = makeEnv();
    const created = createMinihMcpServerFromEnv(env);

    expect(created.context.processMarker).toBe('minih-mcp-run-123');
    expect(process.title).toBe('minih-mcp-run-123');
  });

  it('surfaces startup context errors cleanly', () => {
    const env = makeEnv();
    delete env.MINIH_INBOX_DIR;

    expect(() => createMinihMcpServerFromEnv(env)).toThrow(/MINIH_INBOX_DIR/);
  });

  it('sets process.title from the process marker', () => {
    applyProcessMarker(context);

    expect(process.title).toBe('minih-mcp-run-123');
  });
});

function makeEnv(): Record<string, string> {
  fs.mkdirSync(context.inboxDir, { recursive: true });
  fs.mkdirSync(context.stateDir, { recursive: true });
  writePeerMessage();
  return {
    MINIH_INBOX_DIR: context.inboxDir,
    MINIH_STATE_DIR: context.stateDir,
    MINIH_CONTEXT: 'inside',
    [MCP_ENV_KEYS.runId]: context.runId,
    [MCP_ENV_KEYS.runDir]: context.runDir,
    [MCP_ENV_KEYS.agentSlug]: context.agentSlug,
    [MCP_ENV_KEYS.agentsDir]: context.agentsDir,
    [MCP_ENV_KEYS.processMarker]: context.processMarker,
  };
}

function writePeerMessage(): void {
  const message: InboxMessage = {
    id: 'm1',
    sender: 'outside',
    type: 'note',
    subject: 'Peer message',
    body: 'Body',
    ts: '2026-04-26T00:00:00Z',
  };
  const filePath = inboxLanePath(
    coordinationRunLocation(
      context.agentSlug,
      context.agentsDir,
      context.runId,
    ),
    'outside',
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(message)}\n`);
}
