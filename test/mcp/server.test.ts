import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES } from '../../src/mcp/types.js';
import {
  coordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from '../../src/runner/folder.js';
import type { InboxMessage, OutsideState } from '../../src/runner/types.js';
import {
  createTestMcpClient,
  type TestMcpClient,
} from './helpers/test-client.js';

let tmpDir: string;
let agentsDir: string;
let agentSlug: string;
let agentDir: string;
let client: TestMcpClient | null = null;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-server-'));
  agentsDir = path.join(tmpDir, 'agents');
  agentSlug = 'code-review';
  agentDir = path.join(agentsDir, agentSlug);
  fs.mkdirSync(path.join(agentDir, 'runs', 'run-123'), { recursive: true });
});

afterEach(async () => {
  await client?.close();
  client = null;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('real MCP stdio server', () => {
  it('lists the eight-tool manifest and executes every tool over JSON-RPC', async () => {
    seedOutsideInbox('m1', 'Please review');
    seedOutsideState();
    client = await createClient();

    const tools = await client.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);

    const listed = await client.callTool('inbox_list', { unread: true });
    expect(listed.isError).toBeUndefined();
    expect(listed.structuredContent).toMatchObject({
      messages: [{ id: 'm1', sender: 'outside' }],
    });

    seedOutsideInbox('m2', 'Directive', 'directive');
    const directives = await client.callTool('inbox_list', {
      type: 'directive',
    });
    expect(directives.structuredContent).toMatchObject({
      messages: [{ id: 'm2', type: 'directive' }],
    });

    const acked = await client.callTool('inbox_ack', { msgId: 'm1' });
    expect(acked.structuredContent).toMatchObject({
      acked: true,
      alreadyAcked: false,
      msgId: 'm1',
    });

    const sent = await client.callTool('inbox_send', {
      subject: 'Inside update',
      body: 'Implementation is ready.',
    });
    expect(sent.structuredContent).toMatchObject({
      message: { sender: 'inside', subject: 'Inside update' },
    });

    const bothStates = await client.callTool('state_get');
    expect(bothStates.structuredContent).toMatchObject({
      self: { status: 'idle', updatedBy: 'inside' },
      peer: { status: 'in-progress', updatedBy: 'outside' },
    });

    const outsideState = await client.callTool('state_get', {
      side: 'outside',
    });
    expect(outsideState.structuredContent).toMatchObject({
      state: { status: 'in-progress', updatedBy: 'outside' },
    });

    const outsideStatus = await client.callTool('state_get', {
      side: 'peer',
      key: 'status',
    });
    expect(outsideStatus.structuredContent).toMatchObject({
      key: 'status',
      value: 'in-progress',
    });

    const setState = await client.callTool('state_set', {
      status: 'reviewing',
      data: { phase: 4 },
    });
    expect(setState.structuredContent).toMatchObject({
      state: { status: 'reviewing', data: { phase: 4 }, updatedBy: 'inside' },
    });

    const transitioned = await client.callTool('state_transition', {
      to: 'complete',
      reason: 'review complete',
    });
    expect(transitioned.structuredContent).toMatchObject({
      transitioned: true,
      from: 'reviewing',
      to: 'complete',
      state: { status: 'complete', updatedBy: 'inside' },
    });
  });

  it('preserves typed _meta.code on representative errors', async () => {
    client = await createClient();

    const result = await client.callTool('inbox_ack', { msgId: 'missing' });

    expect(result.isError).toBe(true);
    expect(result._meta?.code).toBe('MCP_NOT_FOUND');
  });

  it('keeps long-poll inbox reads asynchronous over JSON-RPC', async () => {
    client = await createClient();

    const pending = client.callTool('inbox_list', {
      type: 'directive',
      waitMs: 1000,
    });
    setTimeout(() => {
      seedOutsideInbox('m1', 'Noise', 'note');
      seedOutsideInbox('m2', 'Directive', 'directive');
    }, 10);

    await expect(pending).resolves.toMatchObject({
      structuredContent: {
        messages: [{ id: 'm2', type: 'directive' }],
        wait: {
          requestedMs: 1000,
          timedOut: false,
          matched: true,
        },
      },
    });
  });

  it('inbox_send accepts ackOf for any type and round-trips it (plan 013 T009)', async () => {
    client = await createClient();
    const parentId = '01HXYZXYZXYZXYZXYZXYZXYZAB';

    // Send a non-ack reply with ackOf
    const sent = await client.callTool('inbox_send', {
      type: 'note',
      subject: 'Reply to parent',
      body: 'continuing the conversation',
      ackOf: parentId,
    });
    expect(sent.isError).toBeUndefined();
    expect(sent.structuredContent).toMatchObject({
      message: {
        sender: 'inside',
        type: 'note',
        subject: 'Reply to parent',
        ackOf: parentId,
      },
    });

    // Read it back via inbox_list — same lane (inside reads its own) is not
    // exposed to inbox_list (which reads peer/outside lane). Instead, verify
    // by reading the inside lane file directly.
    const insideLane = inboxLanePath(location(), 'inside');
    const content = fs.readFileSync(insideLane, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.ackOf).toBe(parentId);
    expect(last.type).toBe('note');
  });

  it('wait_for_any round-trips a clean timeout via stdio (plan 014 T009)', async () => {
    client = await createClient();

    const result = await client.callTool('wait_for_any', {
      events: [{ kind: 'inbox.message' }],
      waitMs: 100,
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      events: [],
      wait: { requestedMs: 100, timedOut: true, matched: false },
    });
  });
});

async function createClient(): Promise<TestMcpClient> {
  return createTestMcpClient({
    runId: 'run-123',
    runDir: path.join(agentDir, 'runs', 'run-123'),
    agentSlug,
    agentsDir,
  });
}

function seedOutsideInbox(id: string, subject: string, type = 'note'): void {
  const message: InboxMessage = {
    id,
    sender: 'outside',
    type,
    subject,
    body: `${subject} body`,
    ts: '2026-04-26T00:00:00Z',
  };
  const filePath = inboxLanePath(location(), 'outside');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(message)}\n`);
}

function seedOutsideState(): void {
  const state: OutsideState = {
    status: 'in-progress',
    data: { phase: 4 },
    updatedAt: '2026-04-26T00:00:00.000Z',
    updatedBy: 'outside',
  };
  const filePath = stateFilePath(location(), 'outside');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state));
}

function location() {
  return coordinationRunLocation(agentSlug, agentsDir, 'run-123');
}
