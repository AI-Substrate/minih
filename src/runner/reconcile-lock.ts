/**
 * Reconcile lock — plan 025 FX011 (T011), mirroring `run-lock.ts`.
 *
 * One reconcile pass per agents dir at a time: `'wx'` first-write-wins on
 * `<agentsDir>/.reconcile.lock`. Two steal paths: age (`staleAfterMs`) and
 * dead owner (the recorded pid fails the T001 probe — definitive proof the
 * holder is gone, stolen regardless of age).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isProcessAliveDefault } from './run-eligibility.js';

export const RECONCILE_LOCK_HELD = 'RECONCILE_LOCK_HELD';

export interface ReconcileLockOptions {
  agentsDir: string;
  staleAfterMs?: number;
  now?: () => number;
  pid?: number;
  /** Inject the pid-liveness probe for dead-owner steal. */
  isProcessAlive?: (pid: number) => boolean;
}

export interface ReconcileLock {
  readonly lockPath: string;
  readonly ownerId: string;
  readonly released: boolean;
  release(): boolean;
}

interface ReconcileLockFile {
  version: 1;
  ownerId: string;
  pid: number;
  acquiredAtMs: number;
}

export class ReconcileLockHeldError extends Error {
  readonly code = RECONCILE_LOCK_HELD;

  constructor(readonly lockPath: string) {
    super(
      `a reconcile pass is already running (lock at ${lockPath}); retry once it finishes`,
    );
    this.name = 'ReconcileLockHeldError';
  }
}

export function acquireReconcileLock(
  options: ReconcileLockOptions,
): ReconcileLock {
  const lockPath = reconcileLockPath(options.agentsDir);
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const isAlive = options.isProcessAlive ?? isProcessAliveDefault;
  const ownerId = crypto.randomUUID();

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const lockFile: ReconcileLockFile = {
    version: 1,
    ownerId,
    pid,
    acquiredAtMs: now(),
  };

  try {
    writeNewLockFile(lockPath, lockFile);
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
    if (!isStealable(lockPath, options, now(), isAlive)) {
      throw new ReconcileLockHeldError(lockPath);
    }
    // Steal window — a competing stealer can interleave with either call
    // below. A lost race is the same contention surface as a held lock,
    // never a raw fs error.
    try {
      fs.unlinkSync(lockPath);
    } catch (unlinkError) {
      // The competitor's unlink landed first.
      if (!hasErrorCode(unlinkError, 'ENOENT')) throw unlinkError;
    }
    try {
      writeNewLockFile(lockPath, lockFile);
    } catch (writeError) {
      // The competitor's whole steal (unlink + write) landed first.
      if (!hasErrorCode(writeError, 'EEXIST')) throw writeError;
      throw new ReconcileLockHeldError(lockPath);
    }
  }

  let released = false;
  return {
    lockPath,
    ownerId,
    get released() {
      return released;
    },
    release() {
      if (released) return false;
      released = true;
      if (!fs.existsSync(lockPath)) return false;
      const current = readLockFile(lockPath);
      if (current?.ownerId !== ownerId) return false;
      fs.unlinkSync(lockPath);
      return true;
    },
  };
}

export async function withReconcileLock<T>(
  options: ReconcileLockOptions,
  fn: (lock: ReconcileLock) => Promise<T>,
): Promise<T> {
  const lock = acquireReconcileLock(options);
  try {
    return await fn(lock);
  } finally {
    lock.release();
  }
}

export function reconcileLockPath(agentsDir: string): string {
  return path.join(path.resolve(agentsDir), '.reconcile.lock');
}

function writeNewLockFile(lockPath: string, lockFile: ReconcileLockFile): void {
  const fd = fs.openSync(lockPath, 'wx');
  try {
    fs.writeFileSync(fd, `${JSON.stringify(lockFile, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === code
  );
}

function isStealable(
  lockPath: string,
  options: ReconcileLockOptions,
  nowMs: number,
  isAlive: (pid: number) => boolean,
): boolean {
  const current = readLockFile(lockPath);
  if (current === null) return false;
  // Dead owner — definitive: the holder can't release, steal regardless of age.
  if (!isAlive(current.pid)) return true;
  if (options.staleAfterMs === undefined) return false;
  return nowMs - current.acquiredAtMs > options.staleAfterMs;
}

function readLockFile(lockPath: string): ReconcileLockFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.ownerId !== 'string' ||
    typeof record.pid !== 'number' ||
    typeof record.acquiredAtMs !== 'number'
  ) {
    return null;
  }

  return record as unknown as ReconcileLockFile;
}
