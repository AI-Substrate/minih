/**
 * Resume-intent lock — Plan 010 HF-003 / Workshop 001 § Lock file contract.
 *
 * `<runDir>/resume-intent.lock` is held during the takeover window. The
 * lock primitives are pure filesystem; signal handling (SIGTERM/SIGKILL),
 * TTY confirmation, and try/finally orchestration live in the resume
 * command (`src/cli/commands/resume.ts`).
 *
 * Stale-lock policy: a lock that is ≥staleThresholdMs old AND whose owner
 * pid is dead is force-cleared. Both conditions must hold — a recent
 * lock is always honored, and an old lock owned by an alive process is
 * always honored. This guards against partial-crash scenarios where the
 * resuming process hung but is still running.
 *
 * Concurrency: not atomic in the strict POSIX `O_EXCL` sense — we use
 * read-then-write. Two simultaneous resume invocations can race; the
 * second writer wins. Workshop 001 explicitly accepted this trade-off
 * because resume is operator-initiated (rare) and the worst case is the
 * loser's lock content gets overwritten before any takeover side effects
 * happen.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isProcessAliveDefault } from './run-eligibility.js';

const LOCK_FILENAME = 'resume-intent.lock';
const DEFAULT_STALE_THRESHOLD_MS = 30_000;

export type ResumeLockKind = 'takeover' | 'stale-revive' | 'completed-followup';

export interface ResumeLockContent {
  pid: number;
  startedAt: string;
  originalSessionId: string;
  kind: ResumeLockKind;
}

export interface AcquireLockOptions {
  /** Inject pid-liveness check (default: process.kill(pid, 0)). */
  isProcessAlive?: (pid: number) => boolean;
  /** Inject "now" for deterministic tests. */
  now?: () => number;
  /** Stale threshold in milliseconds. Default: 30_000. */
  staleThresholdMs?: number;
}

export type AcquireLockResult =
  | { acquired: true }
  | { acquired: false; holder: ResumeLockContent };

export interface WaitForLockOptions extends AcquireLockOptions {
  /** Total wait budget in milliseconds. Workshop 001 says ≤35_000 for resume. */
  maxWaitMs: number;
  /** Poll interval in milliseconds. Default: 250. */
  pollIntervalMs?: number;
}

export type WaitForLockResult =
  | { acquired: true }
  | { acquired: false; holder: ResumeLockContent; timedOut: boolean };

function lockPath(runDir: string): string {
  return path.join(runDir, LOCK_FILENAME);
}

export async function readResumeLock(
  runDir: string,
): Promise<ResumeLockContent | null> {
  let raw: string;
  try {
    raw = await fs.readFile(lockPath(runDir), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<ResumeLockContent>;
  if (typeof obj.pid !== 'number') return null;
  if (typeof obj.startedAt !== 'string') return null;
  if (typeof obj.originalSessionId !== 'string') return null;
  if (typeof obj.kind !== 'string') return null;
  return obj as ResumeLockContent;
}

export async function clearResumeLock(runDir: string): Promise<void> {
  try {
    await fs.unlink(lockPath(runDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

async function writeLock(
  runDir: string,
  content: ResumeLockContent,
): Promise<void> {
  await fs.writeFile(lockPath(runDir), `${JSON.stringify(content, null, 2)}\n`);
}

/**
 * Try to acquire the resume lock.
 *
 * Returns `{acquired: true}` if no lock existed, the existing lock was
 * torn, or the existing lock is stale (old AND owner pid dead).
 * Returns `{acquired: false, holder}` if a live lock prevents takeover.
 */
export async function acquireResumeLock(
  runDir: string,
  content: ResumeLockContent,
  options: AcquireLockOptions = {},
): Promise<AcquireLockResult> {
  const isAlive = options.isProcessAlive ?? isProcessAliveDefault;
  const now = options.now ?? Date.now;
  const staleThresholdMs =
    options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

  const existing = await readResumeLock(runDir);
  if (!existing) {
    await writeLock(runDir, content);
    return { acquired: true };
  }

  const startedAtMs = Date.parse(existing.startedAt);
  const ageMs = Number.isFinite(startedAtMs) ? now() - startedAtMs : 0;
  const ownerAlive = isAlive(existing.pid);

  if (ageMs >= staleThresholdMs && !ownerAlive) {
    await writeLock(runDir, content);
    return { acquired: true };
  }

  return { acquired: false, holder: existing };
}

/**
 * Wait up to `maxWaitMs` for the lock to be acquireable, polling at
 * `pollIntervalMs`. Workshop 001 § F2 specifies 35s budget.
 */
export async function waitForResumeLock(
  runDir: string,
  content: ResumeLockContent,
  options: WaitForLockOptions,
): Promise<WaitForLockResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + options.maxWaitMs;

  let lastHolder: ResumeLockContent | null = null;
  for (;;) {
    const result = await acquireResumeLock(runDir, content, options);
    if (result.acquired) return { acquired: true };
    lastHolder = result.holder;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { acquired: false, holder: lastHolder, timedOut: true };
    }
    const sleep = Math.min(pollIntervalMs, remaining);
    await new Promise((resolve) => setTimeout(resolve, sleep));
  }
}
