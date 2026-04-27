import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerContext } from '../../src/mcp/context.js';
import { inboxAck, inboxList, inboxSend } from '../../src/mcp/tools/inbox.js';
import { McpToolError } from '../../src/mcp/types.js';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
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
    inboxDir: path.join(agentDir, 'runs', 'run-123', 'inbox'),
    stateDir: path.join(agentDir, 'runs', 'run-123', 'state'),
    processMarker: 'minih-mcp-run-123',
  };
  fs.mkdirSync(context.runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('inboxList', () => {
  it('returns an empty list when lanes are absent', async () => {
    expect(await listed()).toEqual({
      messages: [],
      nextAfter: null,
    });
  });

  it('filters unread messages using append-only inside ack records', async () => {
    writeMessage('outside', peerMessage('m1', 'First'));
    writeMessage('outside', peerMessage('m2', 'Second'));
    writeMessage('inside', insideAck('m1'));

    expect(await listed({ unread: true })).toEqual({
      messages: [expect.objectContaining({ id: 'm2' })],
      nextAfter: null,
    });
  });

  it('filters by exact message type alongside unread filtering', async () => {
    writeMessage('outside', peerMessage('m1', 'First'));
    writeMessage('outside', peerMessage('m2', 'Directive', 'directive'));
    writeMessage('outside', peerMessage('m3', 'Status', 'status'));
    writeMessage('inside', insideAck('m3'));

    expect(await listed({ unread: true, type: 'directive' })).toEqual({
      messages: [expect.objectContaining({ id: 'm2', type: 'directive' })],
      nextAfter: null,
    });
  });

  it('supports bounded pagination', async () => {
    for (let i = 0; i < 5; i++) {
      writeMessage('outside', peerMessage(`m${i}`, `Subject ${i}`));
    }

    expect(await listed({ limit: 2 })).toMatchObject({
      messages: [{ id: 'm0' }, { id: 'm1' }],
      nextAfter: 'm1',
    });
    expect(await listed({ after: 'm1', limit: 2 })).toMatchObject({
      messages: [{ id: 'm2' }, { id: 'm3' }],
      nextAfter: 'm3',
    });
  });

  it('rejects invalid limits', async () => {
    await expect(inboxList(context, { limit: 201 })).rejects.toThrow(
      McpToolError,
    );
  });

  it('rejects malformed and torn peer lane data', async () => {
    writeRaw('outside', '{"id":');
    await expect(inboxList(context)).rejects.toThrow(/torn final line/);

    writeRaw('outside', '{"id":\n');
    await expect(inboxList(context)).rejects.toThrow(/malformed JSON/);
  });

  it('rejects malformed own-lane ack data used for unread filtering', async () => {
    writeMessage('outside', peerMessage('m1', 'First'));
    writeRaw('inside', '{"ackOf":');

    await expect(inboxList(context, { unread: true })).rejects.toThrow(
      /torn final line/,
    );
  });

  it('bounds large inbox output', async () => {
    for (let i = 0; i < 250; i++) {
      writeMessage('outside', peerMessage(`m${i}`, `Subject ${i}`));
    }

    const result = await listed({ limit: 200 });
    expect(result?.messages).toHaveLength(200);
    expect(result?.nextAfter).toBe('m199');
  });

  it('preserves the immediate response shape when waitMs is omitted or zero', async () => {
    writeMessage('outside', peerMessage('m1', 'First'));

    expect(await listed()).toEqual(await listed({ waitMs: 0 }));
    expect(await listed({ waitMs: 0 })).not.toHaveProperty('wait');
  });

  it('rejects invalid waitMs values', async () => {
    for (const waitMs of [-1, 1.5, Number.POSITIVE_INFINITY, 30001]) {
      await expect(inboxList(context, { waitMs })).rejects.toThrow(
        /waitMs must be an integer from 0 to 30000/,
      );
    }
    await expect(inboxList(context, { waitMs: '30' })).rejects.toThrow(
      /waitMs must be a number/,
    );
  });

  it('returns immediately with wait metadata when a matching message exists', async () => {
    writeMessage('outside', peerMessage('m1', 'Directive', 'directive'));

    expect(await listed({ type: 'directive', waitMs: 1000 })).toMatchObject({
      messages: [{ id: 'm1', type: 'directive' }],
      nextAfter: null,
      wait: {
        requestedMs: 1000,
        timedOut: false,
        matched: true,
      },
    });
  });

  it('waits until a newly appended matching outside message arrives', async () => {
    const pending = listed({ unread: true, type: 'directive', waitMs: 1000 });

    setTimeout(() => {
      writeMessage('outside', peerMessage('m1', 'Noise', 'note'));
    }, 10);
    setTimeout(() => {
      writeMessage('outside', peerMessage('m2', 'Directive', 'directive'));
    }, 30);

    await expect(pending).resolves.toMatchObject({
      messages: [{ id: 'm2', type: 'directive' }],
      wait: {
        requestedMs: 1000,
        timedOut: false,
        matched: true,
      },
    });
  });

  it('times out with explicit wait metadata when no matching message arrives', async () => {
    const result = await listed({ type: 'directive', waitMs: 25 });

    expect(result).toMatchObject({
      messages: [],
      nextAfter: null,
      wait: {
        requestedMs: 25,
        timedOut: true,
        matched: false,
      },
    });
    expect(result?.wait?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('settles overlapping waits independently', async () => {
    const statusWait = listed({ type: 'status', waitMs: 1000 });
    const directiveWait = listed({ type: 'directive', waitMs: 1000 });

    setTimeout(() => {
      writeMessage('outside', peerMessage('m1', 'Status', 'status'));
    }, 10);
    setTimeout(() => {
      writeMessage('outside', peerMessage('m2', 'Directive', 'directive'));
    }, 30);

    await expect(statusWait).resolves.toMatchObject({
      messages: [{ id: 'm1', type: 'status' }],
      wait: { timedOut: false, matched: true },
    });
    await expect(directiveWait).resolves.toMatchObject({
      messages: [{ id: 'm2', type: 'directive' }],
      wait: { timedOut: false, matched: true },
    });
  });

  it('surfaces corrupt inbox files during a wait instead of timing out', async () => {
    const pending = inboxList(context, { type: 'directive', waitMs: 1000 });

    setTimeout(() => {
      writeRaw('outside', '{"id":\n');
    }, 10);

    await expect(pending).rejects.toThrow(/malformed JSON/);
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
      .readFileSync(inboxLanePath(location(), 'inside'), 'utf8')
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
    return expect(listed({ unread: true })).resolves.toMatchObject({
      messages: [],
    });
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

async function listed(input: Record<string, unknown> = {}) {
  return (await inboxList(context, input)).structuredContent;
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
  const filePath = inboxLanePath(location(), lane);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (append) fs.appendFileSync(filePath, content);
  else fs.writeFileSync(filePath, content);
}

function readLane(lane: Side): InboxMessage[] {
  const filePath = inboxLanePath(location(), lane);
  return fs
    .readFileSync(filePath, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as InboxMessage);
}

function location() {
  return coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );
}
