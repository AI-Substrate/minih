import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSender } from '../../src/adapter/events.js';
import type {
  NativeWatcher,
  WatchEventType,
} from '../../src/runner/file-watcher.js';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import {
  defaultForwarderWatermark,
  readForwarderWatermark,
  withInboxOffset,
  writeForwarderWatermark,
} from '../../src/runner/forwarder-watermark.js';
import {
  createInboxForwarder,
  InvalidInboxMessageError,
} from '../../src/runner/inbox-forwarder.js';

let tmpDir: string;
let agentsDir: string;
const slug = 'code-review';
const runId = 'run-123';

class FakeNativeWatcher implements NativeWatcher {
  closeCalls = 0;
  private errorListener: ((error: Error) => void) | undefined;

  constructor(
    private readonly listener: (
      eventType: WatchEventType,
      filename: string | Buffer | null,
    ) => void,
  ) {}

  on(event: 'error', listener: (error: Error) => void): NativeWatcher {
    if (event === 'error') this.errorListener = listener;
    return this;
  }

  close(): void {
    this.closeCalls++;
  }

  emit(eventType: WatchEventType, filename: string | Buffer | null): void {
    this.listener(eventType, filename);
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-inbox-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sender(responses: Array<'ok' | Error> = []): SessionSender & {
  prompts: string[];
} {
  const prompts: string[] = [];
  return {
    prompts,
    async send(prompt: string) {
      prompts.push(prompt);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? 'ok';
    },
  };
}

function writeInbox(lines: string[]): string {
  const target = inboxLanePath(
    coordinationRunLocation(slug, agentsDir, runId),
    'outside',
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join(''));
  return target;
}

function message(id: string, subject: string, body = 'Body text') {
  return `${JSON.stringify({
    id,
    sender: 'outside',
    type: 'note',
    subject,
    body,
    ts: '2026-04-26T00:00:00Z',
  })}\n`;
}

function tracedMessage(id: string, subject: string, traceparent: string) {
  return `${JSON.stringify({
    id,
    sender: 'outside',
    type: 'task',
    subject,
    body: 'Body text',
    ts: '2026-04-26T00:00:00Z',
    traceparent,
  })}\n`;
}

function forwarder(testSender = sender()) {
  return createInboxForwarder({
    slug,
    agentsDir,
    runId,
    sender: testSender,
  });
}

describe('inbox forwarder', () => {
  it('does nothing for an absent inbox and leaves default watermark progress', async () => {
    const testSender = sender();
    const result = await forwarder(testSender).drain();

    expect(result).toEqual({
      startOffset: 0,
      endOffset: 0,
      sent: 0,
      stoppedOnTornLine: false,
    });
    expect(testSender.prompts).toEqual([]);
    expect(readForwarderWatermark({ slug, agentsDir, runId }).value).toEqual(
      defaultForwarderWatermark(),
    );
  });

  it('forwards a message carrying a producer traceparent (link path) without error', async () => {
    const traceparent =
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    writeInbox([
      tracedMessage('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Traced', traceparent),
    ]);
    const testSender = sender();
    const result = await forwarder(testSender).drain();

    expect(result.sent).toBe(1);
    expect(testSender.prompts).toHaveLength(1);
    expect(testSender.prompts[0]).toContain('Traced');
  });

  it('forwards complete outside inbox messages in order and advances byte offset', async () => {
    const first = message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'First');
    const second = message(
      '01BRZ3NDEKTSV4RRFFQ69G5FAV',
      'Second',
      'Second body',
    );
    const inboxPath = writeInbox([first, second]);
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result).toEqual({
      startOffset: 0,
      endOffset: fs.statSync(inboxPath).size,
      sent: 2,
      stoppedOnTornLine: false,
    });
    expect(testSender.prompts).toHaveLength(2);
    expect(testSender.prompts[0]).toContain('Subject: First');
    expect(testSender.prompts[1]).toContain('Second body');
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.inbox
        .outsideOffset,
    ).toBe(fs.statSync(inboxPath).size);
  });

  it('does not re-forward already-watermarked messages on restart', async () => {
    const inboxPath = writeInbox([
      message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Already sent'),
    ]);
    writeForwarderWatermark(
      { slug, agentsDir, runId },
      withInboxOffset(defaultForwarderWatermark(), fs.statSync(inboxPath).size),
    );
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result.sent).toBe(0);
    expect(testSender.prompts).toEqual([]);
  });

  it('does not advance the watermark when sending fails', async () => {
    writeInbox([message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Retry me')]);
    const testSender = sender([new Error('session send failed')]);

    await expect(forwarder(testSender).drain()).rejects.toThrow(
      'session send failed',
    );
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.inbox
        .outsideOffset,
    ).toBe(0);
  });

  it('commits prior successful messages before a later send failure', async () => {
    const first = message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'First');
    const second = message('01BRZ3NDEKTSV4RRFFQ69G5FAV', 'Second');
    writeInbox([first, second]);
    const testSender = sender(['ok', new Error('second failed')]);

    await expect(forwarder(testSender).drain()).rejects.toThrow(
      'second failed',
    );

    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.inbox
        .outsideOffset,
    ).toBe(Buffer.byteLength(first));
  });

  it('stops at malformed complete lines without advancing past them', async () => {
    const first = message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'First');
    writeInbox([first, '{"id":\n']);
    const testSender = sender();

    await expect(forwarder(testSender).drain()).rejects.toThrow(
      InvalidInboxMessageError,
    );
    expect(testSender.prompts).toHaveLength(1);
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.inbox
        .outsideOffset,
    ).toBe(Buffer.byteLength(first));
  });

  it('leaves torn final lines for the next drain', async () => {
    const target = writeInbox([
      JSON.stringify({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        sender: 'outside',
        type: 'note',
        subject: 'Torn',
        body: 'not complete yet',
        ts: '2026-04-26T00:00:00Z',
      }),
    ]);
    const testSender = sender();

    const first = await forwarder(testSender).drain();
    expect(first.sent).toBe(0);
    expect(first.stoppedOnTornLine).toBe(true);
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.inbox
        .outsideOffset,
    ).toBe(0);

    fs.appendFileSync(target, '\n');
    const second = await forwarder(testSender).drain();

    expect(second.sent).toBe(1);
    expect(testSender.prompts[0]).toContain('Subject: Torn');
  });

  it('rejects inbox path symlink escapes before reading', async () => {
    const escaped = path.join(tmpDir, 'escaped');
    fs.mkdirSync(escaped);
    const inboxDir = path.dirname(
      inboxLanePath(coordinationRunLocation(slug, agentsDir, runId), 'outside'),
    );
    fs.mkdirSync(path.dirname(inboxDir), { recursive: true });
    fs.symlinkSync(escaped, inboxDir);

    await expect(forwarder(sender()).drain()).rejects.toThrow(
      /outside agentsDir/,
    );
  });

  it('tracks pending drains while work is in flight', async () => {
    writeInbox([message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Pending')]);
    let release: (() => void) | undefined;
    const testSender: SessionSender = {
      send: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve('ok');
          }),
      ),
    };
    const inboxForwarder = forwarder(testSender);

    const promise = inboxForwarder.drain();
    await vi.waitFor(() => expect(inboxForwarder.pendingCount()).toBe(1));
    release?.();
    await promise;

    expect(inboxForwarder.pendingCount()).toBe(0);
  });

  it('drains cold-start backlog before subscribing, then reacts to live watcher events', async () => {
    vi.useFakeTimers();
    const first = message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Cold backlog');
    const target = writeInbox([first]);
    const order: string[] = [];
    let fake: FakeNativeWatcher | undefined;
    const testSender: SessionSender & { prompts: string[] } = {
      prompts: [],
      async send(prompt: string) {
        order.push('send');
        this.prompts.push(prompt);
        return 'ok';
      },
    };
    const inboxForwarder = createInboxForwarder({
      slug,
      agentsDir,
      runId,
      sender: testSender,
      debounceMs: 1,
      watchFactory: (_filename, listener) => {
        order.push('watch');
        fake = new FakeNativeWatcher(listener);
        return fake;
      },
    });

    await inboxForwarder.start();

    expect(order).toEqual(['send', 'watch']);
    expect(testSender.prompts).toHaveLength(1);
    fs.appendFileSync(
      target,
      message('01BRZ3NDEKTSV4RRFFQ69G5FAV', 'Live update'),
    );
    fake?.emit('change', 'messages.ndjson');
    vi.advanceTimersByTime(1);

    await vi.waitFor(() => expect(testSender.prompts).toHaveLength(2));
    expect(testSender.prompts[1]).toContain('Subject: Live update');
  });

  it('counts debounced watcher events before their drain starts', async () => {
    vi.useFakeTimers();
    const target = writeInbox([]);
    let fake: FakeNativeWatcher | undefined;
    const testSender = sender();
    const inboxForwarder = createInboxForwarder({
      slug,
      agentsDir,
      runId,
      sender: testSender,
      debounceMs: 50,
      watchFactory: (_filename, listener) => {
        fake = new FakeNativeWatcher(listener);
        return fake;
      },
    });
    await inboxForwarder.start();

    fs.appendFileSync(
      target,
      message('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Debounced terminal event'),
    );
    fake?.emit('change', 'messages.ndjson');

    expect(inboxForwarder.pendingCount()).toBe(1);
    expect(testSender.prompts).toHaveLength(0);

    vi.advanceTimersByTime(50);
    await vi.waitFor(() => expect(testSender.prompts).toHaveLength(1));
    expect(inboxForwarder.pendingCount()).toBe(0);
  });
});

// ============================================================================
// Plan 013 T008 — renderInboxMessageForAgent label switch
// ============================================================================

describe('renderInboxMessageForAgent — reply chain label (plan 013 T008)', () => {
  it("renders 'In reply to:' for non-ack messages with ackOf", async () => {
    const { renderInboxMessageForAgent } = await import(
      '../../src/runner/inbox-forwarder.js'
    );
    const out = renderInboxMessageForAgent({
      id: '01HXYZXYZXYZXYZXYZXYZXYZAB',
      sender: 'outside',
      type: 'note',
      subject: 'follow-up',
      body: 'continuing the conversation',
      ts: '2026-04-29T00:00:00.000Z',
      ackOf: '01HPARENTPARENTPARENTPAREN',
    });
    expect(out).toContain('In reply to: 01HPARENTPARENTPARENTPAREN');
    expect(out).not.toContain('Acknowledges:');
  });

  it("renders 'Acknowledges:' for ack-typed messages with ackOf (no regression)", async () => {
    const { renderInboxMessageForAgent } = await import(
      '../../src/runner/inbox-forwarder.js'
    );
    const out = renderInboxMessageForAgent({
      id: '01HXYZXYZXYZXYZXYZXYZXYZAB',
      sender: 'outside',
      type: 'ack',
      subject: 'Ack: 01HPARENTPARENTPARENTPAREN',
      body: 'acknowledged',
      ts: '2026-04-29T00:00:00.000Z',
      ackOf: '01HPARENTPARENTPARENTPAREN',
    });
    expect(out).toContain('Acknowledges: 01HPARENTPARENTPARENTPAREN');
    expect(out).not.toContain('In reply to:');
  });

  it('omits the parent-pointer line when ackOf is absent', async () => {
    const { renderInboxMessageForAgent } = await import(
      '../../src/runner/inbox-forwarder.js'
    );
    const out = renderInboxMessageForAgent({
      id: '01HXYZXYZXYZXYZXYZXYZXYZAB',
      sender: 'outside',
      type: 'note',
      subject: 'no parent',
      body: 'standalone',
      ts: '2026-04-29T00:00:00.000Z',
    });
    expect(out).not.toContain('In reply to:');
    expect(out).not.toContain('Acknowledges:');
  });

  it('renders various non-ack types as "In reply to:"', async () => {
    const { renderInboxMessageForAgent } = await import(
      '../../src/runner/inbox-forwarder.js'
    );
    for (const type of ['question', 'review', 'directive', 'task']) {
      const out = renderInboxMessageForAgent({
        id: '01HXYZXYZXYZXYZXYZXYZXYZAB',
        sender: 'outside',
        type,
        subject: `s-${type}`,
        body: `b-${type}`,
        ts: '2026-04-29T00:00:00.000Z',
        ackOf: '01HPARENTPARENTPARENTPAREN',
      });
      expect(out, `type=${type}`).toContain(
        'In reply to: 01HPARENTPARENTPARENTPAREN',
      );
      expect(out, `type=${type}`).not.toContain('Acknowledges:');
    }
  });
});
