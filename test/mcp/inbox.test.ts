import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerContext } from '../../src/mcp/context.js';
import { inboxAck, inboxList, inboxSend } from '../../src/mcp/tools/inbox.js';
import { McpToolError } from '../../src/mcp/types.js';
import { inboxLanePath } from '../../src/runner/folder.js';
import type { InboxMessage, Side } from '../../src/runner/types.js';

let tmpDir: string;
let context: McpServerContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-inbox-'));
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
    inboxDir: path.join(agentDir, 'inbox'),
    stateDir: path.join(agentDir, 'state'),
    processMarker: 'minih-mcp-run-123',
  };
  fs.mkdirSync(context.runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('inboxList', () => {
  it('returns an empty list when lanes are absent', () => {
    expect(inboxList(context).structuredContent).toEqual({
      messages: [],
      nextAfter: null,
    });
  });

  it('filters unread messages using append-only inside ack records', () => {
    writeMessage('outside', peerMessage('m1', 'First'));
    writeMessage('outside', peerMessage('m2', 'Second'));
    writeMessage('inside', insideAck('m1'));

    expect(inboxList(context, { unread: true }).structuredContent).toEqual({
      messages: [expect.objectContaining({ id: 'm2' })],
      nextAfter: null,
    });
  });

  it('filters by exact message type alongside unread filtering', () => {
    writeMessage('outside', peerMessage('m1', 'First'));
    writeMessage('outside', peerMessage('m2', 'Directive', 'directive'));
    writeMessage('outside', peerMessage('m3', 'Status', 'status'));
    writeMessage('inside', insideAck('m3'));

    expect(
      inboxList(context, { unread: true, type: 'directive' }).structuredContent,
    ).toEqual({
      messages: [expect.objectContaining({ id: 'm2', type: 'directive' })],
      nextAfter: null,
    });
  });

  it('supports bounded pagination', () => {
    for (let i = 0; i < 5; i++) {
      writeMessage('outside', peerMessage(`m${i}`, `Subject ${i}`));
    }

    expect(inboxList(context, { limit: 2 }).structuredContent).toMatchObject({
      messages: [{ id: 'm0' }, { id: 'm1' }],
      nextAfter: 'm1',
    });
    expect(
      inboxList(context, { after: 'm1', limit: 2 }).structuredContent,
    ).toMatchObject({
      messages: [{ id: 'm2' }, { id: 'm3' }],
      nextAfter: 'm3',
    });
  });

  it('rejects invalid limits', () => {
    expect(() => inboxList(context, { limit: 201 })).toThrow(McpToolError);
  });

  it('rejects malformed and torn peer lane data', () => {
    writeRaw('outside', '{"id":');
    expect(() => inboxList(context)).toThrow(/torn final line/);

    writeRaw('outside', '{"id":\n');
    expect(() => inboxList(context)).toThrow(/malformed JSON/);
  });

  it('rejects malformed own-lane ack data used for unread filtering', () => {
    writeMessage('outside', peerMessage('m1', 'First'));
    writeRaw('inside', '{"ackOf":');

    expect(() => inboxList(context, { unread: true })).toThrow(
      /torn final line/,
    );
  });

  it('bounds large inbox output', () => {
    for (let i = 0; i < 250; i++) {
      writeMessage('outside', peerMessage(`m${i}`, `Subject ${i}`));
    }

    const result = inboxList(context, { limit: 200 }).structuredContent;
    expect(result?.messages).toHaveLength(200);
    expect(result?.nextAfter).toBe('m199');
  });
});

describe('inboxSend', () => {
  it('appends Phase-5-compatible inside-lane records', () => {
    const result = inboxSend(context, {
      subject: 'Review ready',
      body: 'Please check the implementation.',
      meta: { task: 'T003' },
    }).structuredContent;

    expect(result?.message).toMatchObject({
      sender: 'inside',
      type: 'note',
      subject: 'Review ready',
      body: 'Please check the implementation.',
      meta: { task: 'T003' },
    });
    expect(readLane('inside')).toEqual([result?.message]);
  });

  it('uses single-line append semantics for concurrent senders', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        Promise.resolve(
          inboxSend(context, {
            subject: `Subject ${index}`,
            body: `Body ${index}`,
          }),
        ),
      ),
    );

    const lines = fs
      .readFileSync(
        inboxLanePath(context.agentSlug, context.agentsDir, 'inside'),
        'utf8',
      )
      .trimEnd()
      .split('\n');
    expect(lines).toHaveLength(20);
    expect(lines.map((line) => JSON.parse(line))).toHaveLength(20);
  });
});

describe('inboxAck', () => {
  it('appends an ack message and makes unread filtering idempotent', () => {
    writeMessage('outside', peerMessage('m1', 'First'));

    const first = inboxAck(context, { msgId: 'm1' }).structuredContent;
    const second = inboxAck(context, { msgId: 'm1' }).structuredContent;

    expect(first).toMatchObject({
      acked: true,
      alreadyAcked: false,
      msgId: 'm1',
    });
    expect(second).toMatchObject({
      acked: true,
      alreadyAcked: true,
      msgId: 'm1',
    });
    expect(readLane('inside')).toHaveLength(1);
    expect(
      inboxList(context, { unread: true }).structuredContent?.messages,
    ).toEqual([]);
  });

  it('rejects missing and unknown message ids', () => {
    expect(() => inboxAck(context, { msgId: '' })).toThrow(/msgId/);
    expect(() => inboxAck(context, { msgId: 'missing' })).toThrow(/not found/);
  });
});

function peerMessage(id: string, subject: string, type = 'note'): InboxMessage {
  return {
    id,
    sender: 'outside',
    type,
    subject,
    body: `${subject} body`,
    ts: '2026-04-26T00:00:00Z',
  };
}

function insideAck(msgId: string): InboxMessage {
  return {
    id: `ack-${msgId}`,
    sender: 'inside',
    type: 'ack',
    subject: `Ack ${msgId}`,
    body: 'Acked',
    ts: '2026-04-26T00:00:00Z',
    ackOf: msgId,
  };
}

function writeMessage(lane: Side, message: InboxMessage): void {
  writeRaw(lane, `${JSON.stringify(message)}\n`, true);
}

function writeRaw(lane: Side, content: string, append = false): void {
  const filePath = inboxLanePath(context.agentSlug, context.agentsDir, lane);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (append) fs.appendFileSync(filePath, content);
  else fs.writeFileSync(filePath, content);
}

function readLane(lane: Side): InboxMessage[] {
  const filePath = inboxLanePath(context.agentSlug, context.agentsDir, lane);
  return fs
    .readFileSync(filePath, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as InboxMessage);
}
