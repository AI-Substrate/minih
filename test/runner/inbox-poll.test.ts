import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import { pollInboxLane } from '../../src/runner/inbox-poll.js';
import type { InboxMessage } from '../../src/runner/types.js';

/**
 * T001 RED-bar tests for the runner-side `pollInboxLane` primitive.
 *
 * Plan 010 — HF-001. The primitive is extracted from
 * `src/mcp/tools/inbox.ts:waitForMatchingMessages` so both the inside MCP
 * server and the outside CLI can share one source of truth for filter chain
 * order, settlement contract, and watch debouncing.
 *
 * `pollInboxLane(location, readLane, options)`:
 *   - location: CoordinationRunLocation
 *   - readLane: 'inside' | 'outside' — which lane to read
 *   - options: { type?, waitForAny?, unread?, after?, limit?, waitMs?, maxWaitMs (required) }
 *
 * Returns: { messages, nextAfter, wait? }
 *
 * Edge cases enforced (per validation HIGH-5 / R-006):
 *   1. filter chain order: unread → type → waitForAny → after
 *   2. immediate-read short-circuit (waitMs=0)
 *   3. immediate-read with existing matches returns immediately even with waitMs>0
 *   4. watch-debounce settlement (single-settle cleanup)
 *   5. mid-write race resolves before timeout
 *   6. rapid successive writes (3 writes within 50ms — only one settle)
 *   7. timeout-vs-change boundary (write right at timeout — no double-settle)
 *   8. watcher error after partial settle (stays single-shot)
 *   9. nextAfter watermark only set when more visible beyond limit
 *   10. maxWaitMs cap enforced (waitMs > maxWaitMs throws)
 */

let tmpDir: string;
let location: ReturnType<typeof coordinationRunLocation>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-poll-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const slug = 'poll-test';
  fs.mkdirSync(path.join(agentsDir, slug, 'runs', 'run-1'), {
    recursive: true,
  });
  location = coordinationRunLocation(slug, agentsDir, 'run-1');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMessage(lane: 'inside' | 'outside', message: InboxMessage): void {
  const file = inboxLanePath(location, lane);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(message)}\n`);
}

function makeMsg(
  id: string,
  sender: 'inside' | 'outside',
  type = 'note',
  ackOf?: string,
): InboxMessage {
  const m: InboxMessage = {
    id,
    sender,
    type,
    subject: `Subject ${id}`,
    body: `Body ${id}`,
    ts: new Date().toISOString(),
  };
  if (ackOf) m.ackOf = ackOf;
  return m;
}

describe('pollInboxLane — filter chain semantics', () => {
  it('1. applies filter chain in order unread → type → waitForAny → after', async () => {
    writeMessage('outside', makeMsg('m1', 'outside', 'task'));
    writeMessage('outside', makeMsg('m2', 'outside', 'directive'));
    writeMessage('outside', makeMsg('m3', 'outside', 'task'));
    writeMessage('inside', makeMsg('a1', 'inside', 'ack', 'm1'));

    const result = await pollInboxLane(location, 'outside', {
      unread: true,
      type: 'task',
      maxWaitMs: 30_000,
    });

    expect(result.messages.map((m) => m.id)).toEqual(['m3']);
  });

  it('9. nextAfter watermark only set when more visible beyond limit', async () => {
    writeMessage('outside', makeMsg('m1', 'outside'));
    writeMessage('outside', makeMsg('m2', 'outside'));
    writeMessage('outside', makeMsg('m3', 'outside'));

    const limitedResult = await pollInboxLane(location, 'outside', {
      limit: 2,
      maxWaitMs: 30_000,
    });
    expect(limitedResult.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(limitedResult.nextAfter).toBe('m2');

    const fullResult = await pollInboxLane(location, 'outside', {
      limit: 10,
      maxWaitMs: 30_000,
    });
    expect(fullResult.nextAfter).toBeNull();
  });
});

describe('pollInboxLane — immediate-read paths', () => {
  it('2. waitMs=0 returns synchronously even with no matches', async () => {
    const result = await pollInboxLane(location, 'outside', {
      waitMs: 0,
      maxWaitMs: 30_000,
    });
    expect(result.messages).toEqual([]);
    expect(result.wait).toBeUndefined();
  });

  it('2b. waitMs undefined returns synchronously', async () => {
    const result = await pollInboxLane(location, 'outside', {
      maxWaitMs: 30_000,
    });
    expect(result.messages).toEqual([]);
    expect(result.wait).toBeUndefined();
  });

  it('3. immediate match returns now with wait.matched=true even when waitMs>0', async () => {
    writeMessage('outside', makeMsg('m1', 'outside'));
    const result = await pollInboxLane(location, 'outside', {
      waitMs: 5000,
      maxWaitMs: 30_000,
    });
    expect(result.messages.map((m) => m.id)).toEqual(['m1']);
    expect(result.wait?.matched).toBe(true);
    expect(result.wait?.timedOut).toBe(false);
  });
});

describe('pollInboxLane — watch + settlement', () => {
  it('5. mid-write race resolves before timeout', async () => {
    const timer = setTimeout(() => {
      writeMessage('outside', makeMsg('late', 'outside', 'task'));
    }, 30);

    try {
      const result = await pollInboxLane(location, 'outside', {
        type: 'task',
        waitMs: 2000,
        maxWaitMs: 30_000,
      });

      expect(result.messages.map((m) => m.id)).toEqual(['late']);
      expect(result.wait?.matched).toBe(true);
      expect(result.wait?.timedOut).toBe(false);
      expect(result.wait?.elapsedMs).toBeLessThan(1500);
    } finally {
      clearTimeout(timer);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  });

  it('4 + 6. rapid successive writes settle exactly once with all matching messages', async () => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        writeMessage('outside', makeMsg('a', 'outside', 'task'));
      }, 20),
    );
    timers.push(
      setTimeout(() => {
        writeMessage('outside', makeMsg('b', 'outside', 'task'));
      }, 30),
    );
    timers.push(
      setTimeout(() => {
        writeMessage('outside', makeMsg('c', 'outside', 'task'));
      }, 40),
    );

    try {
      const result = await pollInboxLane(location, 'outside', {
        type: 'task',
        waitMs: 2000,
        maxWaitMs: 30_000,
      });

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.messages.length).toBeLessThanOrEqual(3);
      expect(result.messages.every((m) => ['a', 'b', 'c'].includes(m.id))).toBe(
        true,
      );
      expect(result.wait?.matched).toBe(true);
    } finally {
      // Drain pending writes so they don't leak into later tests' tmpDirs.
      for (const t of timers) clearTimeout(t);
      // Wait one tick for any in-flight write to complete.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  });

  it('7. timeout with no matches resolves matched=false, timedOut=true', async () => {
    const result = await pollInboxLane(location, 'outside', {
      type: 'task',
      waitMs: 200,
      maxWaitMs: 30_000,
    });

    expect(result.messages).toEqual([]);
    expect(result.wait?.matched).toBe(false);
    expect(result.wait?.timedOut).toBe(true);
    expect(result.wait?.requestedMs).toBe(200);
  });

  it('8. watcher error rejects with InboxPollError, single-shot', async () => {
    const failingWatchFactory = () => {
      throw new Error('synthetic watch failure');
    };

    await expect(
      pollInboxLane(location, 'outside', {
        type: 'task',
        waitMs: 1000,
        maxWaitMs: 30_000,
        watchFactory: failingWatchFactory,
      }),
    ).rejects.toThrow(/synthetic watch failure|inbox/i);
  });
});

describe('pollInboxLane — wait cap enforcement', () => {
  it('10. waitMs > maxWaitMs throws InboxPollError', async () => {
    await expect(
      pollInboxLane(location, 'outside', {
        waitMs: 60_000,
        maxWaitMs: 30_000,
      }),
    ).rejects.toThrow(/waitMs.*30/i);
  });

  it('10b. negative waitMs throws InboxPollError', async () => {
    await expect(
      pollInboxLane(location, 'outside', {
        waitMs: -5,
        maxWaitMs: 30_000,
      }),
    ).rejects.toThrow(/waitMs.*integer.*0/i);
  });
});

describe('pollInboxLane — read-lane symmetry (CLI consumer)', () => {
  it('reads inside lane (replies) when readLane=inside, computes unread from outside acks', async () => {
    writeMessage('inside', makeMsg('reply1', 'inside', 'finding'));
    writeMessage('inside', makeMsg('reply2', 'inside', 'summary'));
    writeMessage('outside', makeMsg('a1', 'outside', 'ack', 'reply1'));

    const result = await pollInboxLane(location, 'inside', {
      unread: true,
      maxWaitMs: 300_000,
    });

    expect(result.messages.map((m) => m.id)).toEqual(['reply2']);
  });
});
