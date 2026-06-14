/**
 * Plan 014 T004 — wait_for_any settlement-race + filter unit tests.
 *
 * Uses FakeNativeWatcher (mirrored from inbox-forwarder.test.ts) so the tests
 * are deterministic and fast — no real fs.watch.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitForAny } from '../../src/runner/event-wait.js';
import type {
  NativeWatcher,
  WatchEventType,
} from '../../src/runner/file-watcher.js';
import {
  coordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from '../../src/runner/folder.js';

let tmpDir: string;
let agentsDir: string;
const slug = 'agent-x';
const runId = 'run-1';

class FakeNativeWatcher implements NativeWatcher {
  closeCalls = 0;
  // The watchFileChanges() helper subscribes to the parent directory and
  // filters by basename; the listener it registers receives (eventType, filename)
  // where filename is the basename of the changed file.
  constructor(
    private readonly listener: (
      eventType: WatchEventType,
      filename: string | Buffer | null,
    ) => void,
  ) {}
  on(_event: 'error', _listener: (error: Error) => void): NativeWatcher {
    return this;
  }
  close(): void {
    this.closeCalls++;
  }
  emit(eventType: WatchEventType, filename: string | Buffer | null): void {
    this.listener(eventType, filename);
  }
}

// Tracks every FakeNativeWatcher we hand out so tests can:
//   (a) emit fires by parent-dir path (the watchFactory's filename arg)
//   (b) assert close() was called
type WatcherIndex = Map<string, FakeNativeWatcher[]>;

function makeWatchFactory(index: WatcherIndex) {
  return (
    parentDir: string,
    listener: (
      eventType: WatchEventType,
      filename: string | Buffer | null,
    ) => void,
  ): NativeWatcher => {
    const watcher = new FakeNativeWatcher(listener);
    const list = index.get(parentDir) ?? [];
    list.push(watcher);
    index.set(parentDir, list);
    return watcher;
  };
}

function fireForFile(index: WatcherIndex, filePath: string): void {
  const parent = path.dirname(filePath);
  const basename = path.basename(filePath);
  const watchers = index.get(parent) ?? [];
  for (const w of watchers) {
    w.emit('change', basename);
  }
}

function totalCloseCalls(index: WatcherIndex): number {
  let total = 0;
  for (const list of index.values()) {
    for (const w of list) total += w.closeCalls;
  }
  return total;
}

function totalWatchers(index: WatcherIndex): number {
  let total = 0;
  for (const list of index.values()) total += list.length;
  return total;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-event-wait-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function location() {
  return coordinationRunLocation(slug, agentsDir, runId);
}

function writeInbox(lane: 'inside' | 'outside', lines: string[]): string {
  const target = inboxLanePath(location(), lane);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join(''));
  return target;
}

function makeMessage(
  id: string,
  type = 'task',
  extras: Record<string, unknown> = {},
) {
  return `${JSON.stringify({
    id,
    sender: 'outside',
    type,
    subject: `subject-${id}`,
    body: `body-${id}`,
    ts: '2026-04-30T00:00:00.000Z',
    ...extras,
  })}\n`;
}

function writeState(side: 'inside' | 'outside', state: object): string {
  const target = stateFilePath(location(), side);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state));
  return target;
}

function defaultOutsideState(extras: Record<string, unknown> = {}) {
  return {
    status: 'idle',
    data: {},
    updatedAt: '2026-04-30T00:00:00.000Z',
    updatedBy: 'outside',
    ...extras,
  };
}

function defaultInsideState(extras: Record<string, unknown> = {}) {
  return {
    status: 'idle',
    data: {},
    updatedAt: '2026-04-30T00:00:00.000Z',
    updatedBy: 'inside',
    ...extras,
  };
}

describe('waitForAny — settlement race + filter (plan 014 T004)', () => {
  it('AC-1 — inbox-only wait fires on append', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });

    // Append a new outside message and fire the watcher
    fs.appendFileSync(inboxLanePath(location(), 'outside'), makeMessage('m1'));
    fireForFile(index, inboxLanePath(location(), 'outside'));

    const result = await wait;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('inbox.message');
    expect(result.wait.matched).toBe(true);
    expect(result.wait.timedOut).toBe(false);
    if (result.events[0].kind === 'inbox.message') {
      expect(result.events[0].data.message.id).toBe('m1');
    }
    // AC-15 cleanup: every watcher closed
    expect(totalCloseCalls(index)).toBe(totalWatchers(index));
  });

  it('AC-2 — state.peer.changed fires on outside.json write', async () => {
    writeState('outside', defaultOutsideState());
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'state.peer.changed' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });

    writeState('outside', defaultOutsideState({ status: 'in-progress' }));
    fireForFile(index, stateFilePath(location(), 'outside'));

    const result = await wait;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('state.peer.changed');
    if (result.events[0].kind === 'state.peer.changed') {
      expect(result.events[0].data.newState.status).toBe('in-progress');
    }
    expect(totalCloseCalls(index)).toBe(totalWatchers(index));
  });

  it('AC-3 — mixed-kind wait wakes on whichever fires first', async () => {
    writeInbox('outside', []);
    writeState('outside', defaultOutsideState());
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });

    // Inbox fires first
    fs.appendFileSync(inboxLanePath(location(), 'outside'), makeMessage('m1'));
    fireForFile(index, inboxLanePath(location(), 'outside'));

    const result = await wait;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('inbox.message');
    expect(totalCloseCalls(index)).toBe(totalWatchers(index));
  });

  it('AC-4 — multi-event delivery: multiple inbox messages in one fire are batched and sorted', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });

    // Two messages appended; one watcher fire delivers both
    fs.appendFileSync(inboxLanePath(location(), 'outside'), makeMessage('m1'));
    fs.appendFileSync(inboxLanePath(location(), 'outside'), makeMessage('m2'));
    fireForFile(index, inboxLanePath(location(), 'outside'));

    const result = await wait;
    expect(result.events).toHaveLength(2);
    expect(
      result.events.map((e) =>
        e.kind === 'inbox.message' ? e.data.message.id : '',
      ),
    ).toEqual(['m1', 'm2']);
  });

  it('AC-6 — clean timeout returns empty events with timedOut: true', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const result = await waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }],
      waitMs: 50,
      watchFactory: makeWatchFactory(index),
    });
    expect(result.events).toHaveLength(0);
    expect(result.wait.timedOut).toBe(true);
    expect(result.wait.matched).toBe(false);
    expect(totalCloseCalls(index)).toBe(totalWatchers(index));
  });

  it('AC-12 — inbox filter passthrough: non-matching types do not wake', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message', filter: { types: ['question'] } }],
      waitMs: 100,
      watchFactory: makeWatchFactory(index),
    });

    // Append a non-matching type → fire should not wake
    fs.appendFileSync(
      inboxLanePath(location(), 'outside'),
      makeMessage('m1', 'note'),
    );
    fireForFile(index, inboxLanePath(location(), 'outside'));

    const result = await wait;
    expect(result.events).toHaveLength(0);
    expect(result.wait.timedOut).toBe(true);
  });

  it('AC-12 — inbox filter passthrough: matching type wakes', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message', filter: { types: ['question'] } }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });

    fs.appendFileSync(
      inboxLanePath(location(), 'outside'),
      makeMessage('m1', 'question'),
    );
    fireForFile(index, inboxLanePath(location(), 'outside'));

    const result = await wait;
    expect(result.events).toHaveLength(1);
    if (result.events[0].kind === 'inbox.message') {
      expect(result.events[0].data.message.type).toBe('question');
    }
  });

  it("AC-13 — self-write suppression: inside agent's own state write does NOT wake state.self.changed", async () => {
    writeState('inside', defaultInsideState());
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'state.self.changed' }],
      waitMs: 100,
      watchFactory: makeWatchFactory(index),
    });

    // Simulate agent's own state_set: rewrites inside.json with updatedBy='inside'
    writeState('inside', defaultInsideState({ status: 'reviewing' }));
    fireForFile(index, stateFilePath(location(), 'inside'));

    const result = await wait;
    expect(result.events).toHaveLength(0);
    expect(result.wait.timedOut).toBe(true);
  });

  it('AC-14 — cross-lane structural isolation: own inbox writes do NOT wake an outside-lane inbox watch', async () => {
    writeInbox('outside', []);
    writeInbox('inside', []);
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }],
      waitMs: 100,
      watchFactory: makeWatchFactory(index),
    });

    // Append to INSIDE lane (the agent's own writes go here) — should NOT wake
    fs.appendFileSync(inboxLanePath(location(), 'inside'), makeMessage('m1'));
    fireForFile(index, inboxLanePath(location(), 'inside'));

    const result = await wait;
    expect(result.events).toHaveLength(0);
    expect(result.wait.timedOut).toBe(true);
  });

  it('AC-15 — cleanup invariant: every watcher closed on event-fire path', async () => {
    writeInbox('outside', []);
    writeState('outside', defaultOutsideState());
    writeState('inside', defaultInsideState());
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [
        { kind: 'inbox.message' },
        { kind: 'state.peer.changed' },
        { kind: 'state.self.changed' },
      ],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });
    fs.appendFileSync(inboxLanePath(location(), 'outside'), makeMessage('m1'));
    fireForFile(index, inboxLanePath(location(), 'outside'));
    await wait;
    // 3 watchers registered, all closed
    expect(totalWatchers(index)).toBe(3);
    expect(totalCloseCalls(index)).toBe(3);
  });

  it('AC-15 — cleanup invariant: every watcher closed on timeout path', async () => {
    writeInbox('outside', []);
    writeState('outside', defaultOutsideState());
    const index: WatcherIndex = new Map();
    await waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
      waitMs: 50,
      watchFactory: makeWatchFactory(index),
    });
    expect(totalWatchers(index)).toBe(2);
    expect(totalCloseCalls(index)).toBe(2);
  });

  it('AC-15 — cleanup invariant: error path closes all watchers (F002)', async () => {
    // Write corrupt outside.json — when the watcher fires and tries to read,
    // it surfaces StateFileCorruptError → onError → settle → cleanup.
    writeInbox('outside', []);
    const outsidePath = stateFilePath(location(), 'outside');
    fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
    fs.writeFileSync(outsidePath, '{ this is not valid json');

    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });

    fireForFile(index, outsidePath);

    await expect(wait).rejects.toMatchObject({
      name: 'StateFileCorruptError',
    });
    // Both watchers must be closed even though one threw
    expect(totalWatchers(index)).toBe(2);
    expect(totalCloseCalls(index)).toBe(2);
  });

  it('AC-15 — cleanup invariant: registration-failure path closes prior watchers (F002)', async () => {
    writeInbox('outside', []);
    writeState('outside', defaultOutsideState());

    const index: WatcherIndex = new Map();
    let callCount = 0;
    const failingFactory = (
      parentDir: string,
      listener: (
        eventType: WatchEventType,
        filename: string | Buffer | null,
      ) => void,
    ): NativeWatcher => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('watchFactory failure on second registration');
      }
      const watcher = new FakeNativeWatcher(listener);
      const list = index.get(parentDir) ?? [];
      list.push(watcher);
      index.set(parentDir, list);
      return watcher;
    };

    await expect(
      waitForAny({
        location: location(),
        side: 'inside',
        events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
        waitMs: 30000,
        watchFactory: failingFactory,
      }),
    ).rejects.toThrow('watchFactory failure on second registration');

    // The first watcher (inbox) was registered before the failure — must be closed
    expect(totalWatchers(index)).toBe(1);
    expect(totalCloseCalls(index)).toBe(1);
  });

  it('AC-5 — discriminated-union envelope shape', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });
    fs.appendFileSync(inboxLanePath(location(), 'outside'), makeMessage('m1'));
    fireForFile(index, inboxLanePath(location(), 'outside'));
    const result = await wait;
    const e = result.events[0];
    expect(e.kind).toBe('inbox.message');
    expect(typeof e.ts).toBe('string');
    expect(typeof e.data).toBe('object');
    // ts is ISO-8601
    expect(Date.parse(e.ts)).not.toBeNaN();
  });

  it('AC-16 — pre-existing files: existing peer state in snapshot does NOT wake on first fire', async () => {
    writeState('outside', defaultOutsideState({ status: 'idle' }));
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'state.peer.changed' }],
      waitMs: 100,
      watchFactory: makeWatchFactory(index),
    });
    // Fire the watcher WITHOUT writing — file unchanged → no event
    fireForFile(index, stateFilePath(location(), 'outside'));
    const result = await wait;
    expect(result.events).toHaveLength(0);
    expect(result.wait.timedOut).toBe(true);
  });

  it('state.peer.changed: external peer write (updatedBy="outside") on inside agent\'s state.peer fires', async () => {
    writeState('outside', defaultOutsideState({ status: 'idle' }));
    const index: WatcherIndex = new Map();
    const wait = waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'state.peer.changed' }],
      waitMs: 30000,
      watchFactory: makeWatchFactory(index),
    });
    writeState(
      'outside',
      defaultOutsideState({ status: 'in-progress', data: { go: true } }),
    );
    fireForFile(index, stateFilePath(location(), 'outside'));
    const result = await wait;
    expect(result.events).toHaveLength(1);
    if (result.events[0].kind === 'state.peer.changed') {
      expect(result.events[0].data.newState.status).toBe('in-progress');
    }
  });

  it('exhaustiveness: empty events array still resolves (waitMs timeout) — caller validates min length at MCP boundary', async () => {
    writeInbox('outside', []);
    const index: WatcherIndex = new Map();
    const result = await waitForAny({
      location: location(),
      side: 'inside',
      events: [],
      waitMs: 50,
      watchFactory: makeWatchFactory(index),
    });
    expect(result.events).toHaveLength(0);
    expect(result.wait.timedOut).toBe(true);
    // No watchers registered → no close calls
    expect(totalWatchers(index)).toBe(0);
  });
});

describe('waitForAny — #40 inbox delivery parity (Phase 2)', () => {
  it('AC-3 (#40) — a peer message queued BEFORE the wait is returned by the immediate pass', async () => {
    // The #40 bug: the inbox.message branch snapshots ids at entry and only
    // ever emits on a watcher fire, so a message already queued before the call
    // (with no later write) is never delivered. Seed the peer lane, then wait
    // with NO subsequent fire — the immediate pass must return it.
    writeInbox('outside', [makeMessage('pre1', 'task')]);
    const index: WatcherIndex = new Map();
    const result = await waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }],
      waitMs: 200,
      watchFactory: makeWatchFactory(index),
    });

    expect(result.wait.matched).toBe(true);
    expect(result.wait.timedOut).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('inbox.message');
    if (result.events[0].kind === 'inbox.message') {
      // Assert the body, not just a count — RED-for-the-right-reason.
      expect(result.events[0].data.message.id).toBe('pre1');
      expect(result.events[0].data.message.body).toBe('body-pre1');
      expect(result.events[0].data.message.type).toBe('task');
    }
    // Settle-before-registration (V-2 / T003(d)): the immediate pass short-circuits
    // before any watcher or timeout is armed, so nothing was registered to leak.
    expect(totalWatchers(index)).toBe(0);
    expect(totalCloseCalls(index)).toBe(0);
  });

  it('AC-3 (#40) — immediate pass honours the type filter: a pre-queued non-matching type is NOT returned', async () => {
    // Negative guard: a message is already queued but its type is filtered out,
    // so the immediate pass must NOT settle — it falls through to a clean timeout.
    writeInbox('outside', [makeMessage('pre1', 'note')]);
    const index: WatcherIndex = new Map();
    const result = await waitForAny({
      location: location(),
      side: 'inside',
      events: [{ kind: 'inbox.message', filter: { types: ['question'] } }],
      waitMs: 100,
      watchFactory: makeWatchFactory(index),
    });

    expect(result.events).toHaveLength(0);
    expect(result.wait.matched).toBe(false);
    expect(result.wait.timedOut).toBe(true);
    // It fell through to the watcher path, which is torn down on timeout.
    expect(totalCloseCalls(index)).toBe(totalWatchers(index));
  });

  it('AC-3 (#40) — a torn peer lane at the immediate pass rejects with EventWaitInboxCorruptError', async () => {
    // V-1: the immediate pass adds a synchronous lane read at entry. The old
    // snapshotInboxIds SWALLOWED corruption (catch -> empty Set); the new read
    // must surface a torn lane as a typed error, not resolve-as-empty.
    const target = inboxLanePath(location(), 'outside');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // A truncated final line with no trailing newline = torn lane.
    fs.writeFileSync(target, '{"id":"torn","sender":"outside","type":"task"');
    const index: WatcherIndex = new Map();

    await expect(
      waitForAny({
        location: location(),
        side: 'inside',
        events: [{ kind: 'inbox.message' }],
        waitMs: 200,
        watchFactory: makeWatchFactory(index),
      }),
    ).rejects.toMatchObject({ name: 'EventWaitInboxCorruptError' });

    // Threw during the immediate pass, before any watcher/timeout was armed.
    expect(totalWatchers(index)).toBe(0);
  });
});
