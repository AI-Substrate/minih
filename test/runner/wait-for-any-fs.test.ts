/**
 * Plan 014 T010 — real `fs.watch` integration test for waitForAny.
 *
 * Most coverage lives in event-wait.test.ts under FakeNativeWatcher.
 * This test exercises the full file-watcher chain (real fs.watch + debounce)
 * against a tmpdir run folder so we have at least one cross-platform smoke
 * check that the wiring works end-to-end without any test seam.
 *
 * Per spec AC-2 and AC-16 with real fs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitForAny } from '../../src/runner/event-wait.js';
import type { WatchFactory } from '../../src/runner/file-watcher.js';
import {
  coordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from '../../src/runner/folder.js';

let tmpDir: string;
let agentsDir: string;
const slug = 'agent-x';
const runId = 'run-1';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-event-wait-fs-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function loc() {
  return coordinationRunLocation(slug, agentsDir, runId);
}

describe('waitForAny — real fs.watch integration (plan 014 T010)', () => {
  it('mixed-kind wait wakes when outside.json is written mid-wait', async () => {
    // Pre-create both files so the watcher can subscribe to existing parents
    const outsidePath = stateFilePath(loc(), 'outside');
    fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
    fs.writeFileSync(
      outsidePath,
      JSON.stringify({
        status: 'idle',
        data: {},
        updatedAt: '2026-04-30T00:00:00.000Z',
        updatedBy: 'outside',
      }),
    );

    const inboxOutside = inboxLanePath(loc(), 'outside');
    fs.mkdirSync(path.dirname(inboxOutside), { recursive: true });
    fs.writeFileSync(inboxOutside, '');

    // Start the wait
    const waitPromise = waitForAny({
      location: loc(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
      waitMs: 5000,
      // No watchFactory override — uses real fs.watch
    });

    // Give the watchers a moment to subscribe (real fs.watch needs the kernel
    // to wire up the inotify/FSEvents handle).
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update outside state (this should fire state.peer.changed)
    fs.writeFileSync(
      outsidePath,
      JSON.stringify({
        status: 'in-progress',
        data: { go: true },
        updatedAt: '2026-04-30T00:00:01.000Z',
        updatedBy: 'outside',
      }),
    );

    const result = await waitPromise;
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    const stateChange = result.events.find(
      (e) => e.kind === 'state.peer.changed',
    );
    expect(stateChange).toBeDefined();
    if (stateChange?.kind === 'state.peer.changed') {
      expect(stateChange.data.newState.status).toBe('in-progress');
    }
    expect(result.wait.matched).toBe(true);
    expect(result.wait.timedOut).toBe(false);
  });

  it('clean timeout when no write occurs', async () => {
    const outsidePath = stateFilePath(loc(), 'outside');
    fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
    fs.writeFileSync(
      outsidePath,
      JSON.stringify({
        status: 'idle',
        data: {},
        updatedAt: '2026-04-30T00:00:00.000Z',
        updatedBy: 'outside',
      }),
    );

    const result = await waitForAny({
      location: loc(),
      side: 'inside',
      events: [{ kind: 'state.peer.changed' }],
      waitMs: 200,
    });

    expect(result.events).toEqual([]);
    expect(result.wait.timedOut).toBe(true);
    expect(result.wait.matched).toBe(false);
    // elapsedMs should be at least the requested duration (allow some slack)
    expect(result.wait.elapsedMs).toBeGreaterThanOrEqual(150);
  });
});

// Wraps the REAL fs.watch but counts how many native watchers get close()d, so
// we can assert teardown is exactly-once under a genuine timeout-vs-fire race
// (Phase 2 T006 — the cleanup() re-entry guard / single-settle contract).
function countingRealFactory(counter: { closes: number }): WatchFactory {
  return (filename, listener) => {
    const native = fs.watch(filename, listener);
    return {
      on(event, l) {
        native.on(event, l);
        return this;
      },
      close() {
        counter.closes += 1;
        native.close();
      },
    };
  };
}

describe('waitForAny — real fs.watch teardown race (Phase 2 T006)', () => {
  function seedEmptyLanes(): void {
    const outsideState = stateFilePath(loc(), 'outside');
    fs.mkdirSync(path.dirname(outsideState), { recursive: true });
    fs.writeFileSync(
      outsideState,
      JSON.stringify({
        status: 'idle',
        data: {},
        updatedAt: '2026-04-30T00:00:00.000Z',
        updatedBy: 'outside',
      }),
    );
    const inboxOutside = inboxLanePath(loc(), 'outside');
    fs.mkdirSync(path.dirname(inboxOutside), { recursive: true });
    // Empty inbox lane → the immediate pass finds nothing → both watchers register.
    fs.writeFileSync(inboxOutside, '');
  }

  it('fire path: both watchers are closed exactly once (close-count == N)', async () => {
    seedEmptyLanes();
    const counter = { closes: 0 };
    const waitPromise = waitForAny({
      location: loc(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
      waitMs: 5000,
      watchFactory: countingRealFactory(counter),
    });

    // Let the real watchers wire up, then write outside.json to fire mid-wait.
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.writeFileSync(
      stateFilePath(loc(), 'outside'),
      JSON.stringify({
        status: 'in-progress',
        data: { go: true },
        updatedAt: '2026-04-30T00:00:01.000Z',
        updatedBy: 'outside',
      }),
    );

    const result = await waitPromise;
    expect(result.wait.matched).toBe(true);
    // 2 watchers (inbox + state.peer) registered; both closed exactly once.
    expect(counter.closes).toBe(2);
  });

  it('timeout path: both watchers are closed exactly once (close-count == N)', async () => {
    seedEmptyLanes();
    const counter = { closes: 0 };
    const result = await waitForAny({
      location: loc(),
      side: 'inside',
      events: [{ kind: 'inbox.message' }, { kind: 'state.peer.changed' }],
      waitMs: 200,
      watchFactory: countingRealFactory(counter),
    });
    expect(result.wait.timedOut).toBe(true);
    expect(counter.closes).toBe(2);
  });
});
