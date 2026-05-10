import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateSlug } from './folder.js';
import { assertPathInsideAgentsDir } from './forwarder-watermark.js';

export const RUN_LOCK_HELD = 'RUN_LOCK_HELD';

export interface RunLockOptions {
  slug: string;
  agentsDir: string;
  staleAfterMs?: number;
  now?: () => number;
  pid?: number;
}

export interface RunLock {
  readonly lockPath: string;
  readonly ownerId: string;
  readonly released: boolean;
  release(): boolean;
}

interface RunLockFile {
  version: 1;
  ownerId: string;
  pid: number;
  slug: string;
  acquiredAtMs: number;
}

export class RunLockHeldError extends Error {
  readonly code = RUN_LOCK_HELD;

  constructor(
    readonly slug: string,
    readonly lockPath: string,
  ) {
    super(
      `agent "${slug}" already has an active run lock at ${lockPath}; only one live run may own coordination watchers at a time`,
    );
    this.name = 'RunLockHeldError';
  }
}

export class InvalidRunLockSlugError extends Error {
  constructor(slug: string, reason: string) {
    super(`invalid run-lock slug "${slug}": ${reason}`);
    this.name = 'InvalidRunLockSlugError';
  }
}

export function acquireRunLock(options: RunLockOptions): RunLock {
  ensureValidSlug(options.slug);
  const lockPath = runLockPath(options.slug, options.agentsDir);
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const ownerId = crypto.randomUUID();

  assertPathInsideAgentsDir(lockPath, options.agentsDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  assertPathInsideAgentsDir(lockPath, options.agentsDir);

  const lockFile: RunLockFile = {
    version: 1,
    ownerId,
    pid,
    slug: options.slug,
    acquiredAtMs: now(),
  };

  try {
    writeNewLockFile(lockPath, lockFile);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (isStaleLock(lockPath, options, now())) {
      fs.unlinkSync(lockPath);
      writeNewLockFile(lockPath, lockFile);
    } else {
      throw new RunLockHeldError(options.slug, lockPath);
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
      assertPathInsideAgentsDir(lockPath, options.agentsDir);
      const current = readLockFile(lockPath);
      if (current?.ownerId !== ownerId) return false;
      fs.unlinkSync(lockPath);
      return true;
    },
  };
}

export async function withRunLock<T>(
  options: RunLockOptions,
  fn: (lock: RunLock) => Promise<T>,
): Promise<T> {
  const lock = acquireRunLock(options);
  try {
    return await fn(lock);
  } finally {
    lock.release();
  }
}

export function runLockPath(slug: string, agentsDir: string): string {
  ensureValidSlug(slug);
  return path.join(path.resolve(agentsDir), slug, 'state', 'run.lock');
}

function ensureValidSlug(slug: string): void {
  const error = validateSlug(slug);
  if (error !== null) throw new InvalidRunLockSlugError(slug, error);
}

function writeNewLockFile(lockPath: string, lockFile: RunLockFile): void {
  const fd = fs.openSync(lockPath, 'wx');
  try {
    fs.writeFileSync(fd, `${JSON.stringify(lockFile, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'EEXIST'
  );
}

function isStaleLock(
  lockPath: string,
  options: RunLockOptions,
  nowMs: number,
): boolean {
  if (options.staleAfterMs === undefined) return false;
  assertPathInsideAgentsDir(lockPath, options.agentsDir);
  const current = readLockFile(lockPath);
  if (current === null) return false;
  return nowMs - current.acquiredAtMs > options.staleAfterMs;
}

function readLockFile(lockPath: string): RunLockFile | null {
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
    typeof record.slug !== 'string' ||
    typeof record.acquiredAtMs !== 'number'
  ) {
    return null;
  }

  return record as unknown as RunLockFile;
}
