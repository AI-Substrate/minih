/**
 * T011 (Plan 010 HF-003) — TDD RED bar for resume-intent.lock primitives.
 *
 * Workshop 001 § Lock file contract describes:
 *   - Lock written at <runDir>/resume-intent.lock during takeover window
 *   - JSON content: { pid, startedAt, originalSessionId, kind }
 *   - Stale = lock ≥30s old AND owner pid dead → force-clear with warning
 *   - Concurrent resume: second caller waits up to 35s, errors if still held
 *
 * SIGTERM/SIGKILL signal protocol + TTY confirmation are covered by the
 * resume orchestration in `src/cli/commands/resume.ts` (T012); these
 * unit tests focus on the lock primitives and the wait/retry contract.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireResumeLock,
  clearResumeLock,
  type ResumeLockContent,
  readResumeLock,
  waitForResumeLock,
} from '../../src/runner/resume-lock.js';

let runDir: string;

const baseLock: ResumeLockContent = {
  pid: 99999,
  startedAt: '2026-04-28T10:00:00.000Z',
  originalSessionId: 'sess-1',
  kind: 'takeover',
};

beforeEach(() => {
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-lock-'));
});

afterEach(() => {
  if (runDir && fs.existsSync(runDir)) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

describe('acquireResumeLock', () => {
  it('writes resume-intent.lock with the supplied content when no lock exists', async () => {
    const result = await acquireResumeLock(runDir, baseLock);
    expect(result.acquired).toBe(true);
    const lockPath = path.join(runDir, 'resume-intent.lock');
    expect(fs.existsSync(lockPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(written).toMatchObject({
      pid: 99999,
      originalSessionId: 'sess-1',
      kind: 'takeover',
    });
  });

  it('refuses to acquire when an alive owner holds the lock', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify({ ...baseLock, pid: 1234 }),
    );
    const result = await acquireResumeLock(runDir, baseLock, {
      isProcessAlive: () => true,
      now: () => Date.parse('2026-04-28T10:00:01.000Z'),
    });
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.holder.pid).toBe(1234);
    }
  });

  it('force-clears lock when older than staleThresholdMs AND owner pid is dead', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify({ ...baseLock, pid: 1234 }),
    );
    const result = await acquireResumeLock(runDir, baseLock, {
      isProcessAlive: () => false,
      now: () => Date.parse('2026-04-28T10:01:00.000Z'),
      staleThresholdMs: 30_000,
    });
    expect(result.acquired).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(runDir, 'resume-intent.lock'), 'utf8'),
    );
    // The new lock content should have replaced the stale one.
    expect(written.pid).toBe(99999);
  });

  it('refuses to force-clear when lock is old but owner is still alive', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify({ ...baseLock, pid: 1234 }),
    );
    const result = await acquireResumeLock(runDir, baseLock, {
      isProcessAlive: () => true,
      now: () => Date.parse('2026-04-28T10:01:00.000Z'),
      staleThresholdMs: 30_000,
    });
    expect(result.acquired).toBe(false);
  });

  it('refuses to force-clear when lock is recent even if owner is dead', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify({ ...baseLock, pid: 1234 }),
    );
    const result = await acquireResumeLock(runDir, baseLock, {
      isProcessAlive: () => false,
      now: () => Date.parse('2026-04-28T10:00:10.000Z'),
      staleThresholdMs: 30_000,
    });
    expect(result.acquired).toBe(false);
  });

  it('succeeds when an existing lock file is torn (unparseable)', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      '{ this is not json',
    );
    const result = await acquireResumeLock(runDir, baseLock);
    expect(result.acquired).toBe(true);
  });
});

describe('clearResumeLock', () => {
  it('removes the lock file when present', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify(baseLock),
    );
    await clearResumeLock(runDir);
    expect(fs.existsSync(path.join(runDir, 'resume-intent.lock'))).toBe(false);
  });

  it('is a no-op when the lock file is absent', async () => {
    await clearResumeLock(runDir);
    expect(fs.existsSync(path.join(runDir, 'resume-intent.lock'))).toBe(false);
  });
});

describe('readResumeLock', () => {
  it('returns null when no lock file is present', async () => {
    const lock = await readResumeLock(runDir);
    expect(lock).toBeNull();
  });

  it('returns parsed content when lock is present and well-formed', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify(baseLock),
    );
    const lock = await readResumeLock(runDir);
    expect(lock).toEqual(baseLock);
  });

  it('returns null when lock is torn', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      '{ this is not json',
    );
    const lock = await readResumeLock(runDir);
    expect(lock).toBeNull();
  });
});

describe('waitForResumeLock', () => {
  it('returns immediately when no lock is held', async () => {
    const t0 = Date.now();
    const result = await waitForResumeLock(runDir, baseLock, {
      maxWaitMs: 200,
      pollIntervalMs: 50,
    });
    const elapsed = Date.now() - t0;
    expect(result.acquired).toBe(true);
    expect(elapsed).toBeLessThan(150);
  });

  it('waits until the lock is released and then acquires', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify({ ...baseLock, pid: 1234 }),
    );
    setTimeout(() => {
      // Release the lock 100ms in.
      fs.unlinkSync(path.join(runDir, 'resume-intent.lock'));
    }, 100);
    const t0 = Date.now();
    const result = await waitForResumeLock(runDir, baseLock, {
      maxWaitMs: 1_000,
      pollIntervalMs: 25,
      isProcessAlive: () => true,
    });
    const elapsed = Date.now() - t0;
    expect(result.acquired).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(800);
  });

  it('times out and reports holder when lock is alive longer than maxWaitMs', async () => {
    fs.writeFileSync(
      path.join(runDir, 'resume-intent.lock'),
      JSON.stringify({ ...baseLock, pid: 1234 }),
    );
    const result = await waitForResumeLock(runDir, baseLock, {
      maxWaitMs: 200,
      pollIntervalMs: 25,
      isProcessAlive: () => true,
    });
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.holder.pid).toBe(1234);
      expect(result.timedOut).toBe(true);
    }
  });
});
