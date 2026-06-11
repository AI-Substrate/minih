/**
 * T011 (plan 025, FX011/AC-8) — reconcile lock: 'wx' first-write-wins,
 * age-based staleness, dead-owner steal via the T001 probe.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireReconcileLock,
  ReconcileLockHeldError,
  reconcileLockPath,
  withReconcileLock,
} from '../../src/runner/reconcile-lock.js';

let agentsDir: string;

beforeEach(() => {
  agentsDir = mkdtempSync(path.join(tmpdir(), 'minih-reconcile-lock-'));
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
});

describe('acquireReconcileLock', () => {
  it('writes the lock file and a concurrent acquire fails cleanly', () => {
    const lock = acquireReconcileLock({ agentsDir });

    expect(existsSync(lock.lockPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(lock.lockPath, 'utf-8'));
    expect(onDisk).toMatchObject({ version: 1, ownerId: lock.ownerId });

    expect(() =>
      acquireReconcileLock({ agentsDir, isProcessAlive: () => true }),
    ).toThrow(ReconcileLockHeldError);

    lock.release();
  });

  it('steals an age-stale lock', () => {
    const first = acquireReconcileLock({
      agentsDir,
      now: () => 1_000,
      isProcessAlive: () => true,
    });

    const second = acquireReconcileLock({
      agentsDir,
      staleAfterMs: 5_000,
      now: () => 10_000,
      isProcessAlive: () => true,
    });

    expect(second.ownerId).not.toBe(first.ownerId);
    expect(second.release()).toBe(true);
    // The superseded holder's release is a no-op (ownerId mismatch → gone).
    expect(first.release()).toBe(false);
  });

  it('steals a dead-owner lock regardless of age', () => {
    const first = acquireReconcileLock({ agentsDir, pid: 4242 });

    const second = acquireReconcileLock({
      agentsDir,
      isProcessAlive: (pid) => pid !== 4242,
    });

    expect(second.ownerId).not.toBe(first.ownerId);
    second.release();
  });

  it('holds against a live owner with no staleAfterMs', () => {
    const lock = acquireReconcileLock({ agentsDir, pid: process.pid });

    expect(() => acquireReconcileLock({ agentsDir })).toThrow(
      ReconcileLockHeldError,
    );

    lock.release();
  });

  // F002 (plan 025 review) — a competing stealer can unlink the lock between
  // our stealability read and our unlink. The injected probe fires exactly in
  // that window, so its side effect IS the competitor winning the unlink: the
  // resulting ENOENT must be tolerated, not surfaced raw.
  it('tolerates a competitor deleting the lock inside the steal window', () => {
    acquireReconcileLock({ agentsDir, pid: 4242 });
    const lockPath = reconcileLockPath(agentsDir);

    const second = acquireReconcileLock({
      agentsDir,
      isProcessAlive: (pid) => {
        if (pid === 4242) {
          unlinkSync(lockPath); // the competitor's unlink lands first
          return false; // dead owner → stealable
        }
        return true;
      },
    });

    expect(existsSync(lockPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(onDisk.ownerId).toBe(second.ownerId);
    expect(second.release()).toBe(true);
  });

  it('release is idempotent and respects ownership', () => {
    const lock = acquireReconcileLock({ agentsDir });

    expect(lock.release()).toBe(true);
    expect(lock.release()).toBe(false);
    expect(existsSync(reconcileLockPath(agentsDir))).toBe(false);
  });
});

describe('withReconcileLock', () => {
  it('releases on success and on throw', async () => {
    await withReconcileLock({ agentsDir }, async () => {
      expect(existsSync(reconcileLockPath(agentsDir))).toBe(true);
    });
    expect(existsSync(reconcileLockPath(agentsDir))).toBe(false);

    await expect(
      withReconcileLock({ agentsDir }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(reconcileLockPath(agentsDir))).toBe(false);
  });
});
