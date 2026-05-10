import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireRunLock,
  InvalidRunLockSlugError,
  RunLockHeldError,
  runLockPath,
  withRunLock,
} from '../../src/runner/run-lock.js';

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-run-lock-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('run lock', () => {
  it('acquires and releases an exclusive lock file', () => {
    const lock = acquireRunLock({
      slug: 'code-review',
      agentsDir,
      now: () => 1000,
      pid: 123,
    });

    expect(fs.existsSync(lock.lockPath)).toBe(true);
    expect(lock.release()).toBe(true);
    expect(lock.release()).toBe(false);
    expect(lock.released).toBe(true);
    expect(fs.existsSync(lock.lockPath)).toBe(false);
  });

  it('rejects a second active run with a typed error code', () => {
    const first = acquireRunLock({ slug: 'code-review', agentsDir });

    expect(() => acquireRunLock({ slug: 'code-review', agentsDir })).toThrow(
      RunLockHeldError,
    );
    try {
      acquireRunLock({ slug: 'code-review', agentsDir });
    } catch (error) {
      expect(error).toBeInstanceOf(RunLockHeldError);
      expect((error as RunLockHeldError).code).toBe('RUN_LOCK_HELD');
      expect((error as RunLockHeldError).slug).toBe('code-review');
    }

    first.release();
  });

  it('allows a new lock after release', () => {
    const first = acquireRunLock({ slug: 'code-review', agentsDir });
    first.release();

    const second = acquireRunLock({ slug: 'code-review', agentsDir });

    expect(second.ownerId).not.toBe(first.ownerId);
    second.release();
  });

  it('replaces stale locks when staleAfterMs is exceeded', () => {
    const stale = acquireRunLock({
      slug: 'code-review',
      agentsDir,
      now: () => 1000,
      pid: 123,
    });

    const fresh = acquireRunLock({
      slug: 'code-review',
      agentsDir,
      now: () => 3001,
      staleAfterMs: 2000,
      pid: 456,
    });

    expect(fresh.ownerId).not.toBe(stale.ownerId);
    expect(stale.release()).toBe(false);
    expect(fresh.release()).toBe(true);
  });

  it('does not replace non-stale locks', () => {
    const lock = acquireRunLock({
      slug: 'code-review',
      agentsDir,
      now: () => 1000,
    });

    expect(() =>
      acquireRunLock({
        slug: 'code-review',
        agentsDir,
        now: () => 2999,
        staleAfterMs: 2000,
      }),
    ).toThrow(RunLockHeldError);

    lock.release();
  });

  it('releases the lock in withRunLock finally when work throws', async () => {
    await expect(
      withRunLock({ slug: 'code-review', agentsDir }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(fs.existsSync(runLockPath('code-review', agentsDir))).toBe(false);
  });

  it('rejects invalid slugs', () => {
    expect(() => acquireRunLock({ slug: '../escape', agentsDir })).toThrow(
      InvalidRunLockSlugError,
    );
  });

  it('rejects lock path symlink escapes before replacing stale locks', () => {
    const escaped = path.join(tmpDir, 'escaped');
    fs.mkdirSync(escaped);
    const stateDir = path.dirname(runLockPath('code-review', agentsDir));
    fs.mkdirSync(path.dirname(stateDir), { recursive: true });
    fs.symlinkSync(escaped, stateDir);

    expect(() =>
      acquireRunLock({
        slug: 'code-review',
        agentsDir,
        staleAfterMs: 1,
        now: () => 1000,
      }),
    ).toThrow(/outside agentsDir/);
  });
});
