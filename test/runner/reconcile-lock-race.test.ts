/**
 * F002 fix pass (plan 025 review) — the post-steal WRITE race. A competitor
 * that completes its whole steal (unlink + write) between our unlink and our
 * 'wx' write must surface as ReconcileLockHeldError (the documented E190
 * contention contract), never as a raw EEXIST.
 *
 * The interleave point sits between two fs calls inside the SUT, so node:fs
 * is module-mocked here (passthrough by default); the unlink-side race needs
 * no mocks and lives in reconcile-lock.test.ts.
 */

import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, openSync: vi.fn(actual.openSync) };
});

import * as fs from 'node:fs';
import {
  acquireReconcileLock,
  ReconcileLockHeldError,
  reconcileLockPath,
} from '../../src/runner/reconcile-lock.js';

const fsActual = await vi.importActual<typeof import('node:fs')>('node:fs');
const openSyncMock = vi.mocked(fs.openSync);

let agentsDir: string;

beforeEach(() => {
  agentsDir = fsActual.mkdtempSync(path.join(tmpdir(), 'minih-lock-race-'));
});

afterEach(() => {
  openSyncMock.mockImplementation(fsActual.openSync);
  fsActual.rmSync(agentsDir, { recursive: true, force: true });
});

describe('reconcile lock steal race (write side)', () => {
  it('lost post-steal write race surfaces as ReconcileLockHeldError, competitor lock intact', () => {
    const lockPath = reconcileLockPath(agentsDir);
    fsActual.writeFileSync(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'original-dead-owner',
        pid: 4242,
        acquiredAtMs: 0,
      }),
    );

    // openSync call 1: our initial 'wx' → genuine EEXIST (original lock).
    // openSync call 2: our post-steal 'wx' — the competitor's fresh lock
    // lands first, so the real 'wx' open hits EEXIST again.
    let calls = 0;
    openSyncMock.mockImplementation((file, flags, mode) => {
      calls += 1;
      if (calls === 2) {
        fsActual.writeFileSync(
          file as fs.PathLike,
          JSON.stringify({
            version: 1,
            ownerId: 'competitor',
            pid: process.pid,
            acquiredAtMs: Date.now(),
          }),
        );
      }
      return fsActual.openSync(file, flags as fs.OpenMode, mode as fs.Mode);
    });

    expect(() =>
      acquireReconcileLock({ agentsDir, isProcessAlive: () => false }),
    ).toThrow(ReconcileLockHeldError);

    const onDisk = JSON.parse(fsActual.readFileSync(lockPath, 'utf-8'));
    expect(onDisk.ownerId).toBe('competitor');
  });
});
