/**
 * Run eligibility — Plan 010 HF-003 / Workshop 001.
 *
 * `detectRunState(runDir)` classifies a single run dir into one of five
 * resume-eligibility states. This is filesystem + pid-liveness only;
 * time-based stale detection (the resolver's job) lives in
 * `run-resolver.ts`'s `computeLiveness`.
 *
 * The two detection paths intentionally disagree on edge cases. The
 * resolver flags time-stalled runs because it has to give the human view
 * a "freshness" signal. Resume needs **process liveness** because the
 * takeover decision must be safe — a pid that is alive should never be
 * classified as stale, regardless of how long it has been since its last
 * heartbeat.
 *
 * Schema: see `LiveRunManifest` (run.json) and `CompletedMetadata`
 * (completed.json). When run.json is torn we return "stale" — operator
 * can resume safely; the alternative (silent throw) hides corruption.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type RunEligibilityState =
  | 'active'
  | 'stale'
  | 'completed'
  | 'failed'
  | 'nonexistent';

export interface DetectRunStateOptions {
  /** Inject process-liveness check. Defaults to `process.kill(pid, 0)`. */
  isProcessAlive?: (pid: number) => boolean;
}

/** Injection seam for the probe's signal sender (plan 025 T001). */
export interface ProcessProbeDeps {
  /** Inject the signal-0 sender. Defaults to `process.kill`. */
  kill?: (pid: number, signal: 0) => unknown;
}

/**
 * Default pid-liveness check using POSIX signal 0 ("test if process exists").
 *
 * Error spec (FX009-3): ESRCH proves the process is gone → dead. EPERM means
 * the process EXISTS but belongs to another user — signal-0 probes existence,
 * so EPERM reads as alive (conservative-alive: a falsely-dead verdict invites
 * takeover of a live run). EINVAL and anything uncoded → dead.
 */
export function isProcessAliveDefault(
  pid: number,
  deps: ProcessProbeDeps = {},
): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const kill = deps.kill ?? ((p: number, s: 0) => process.kill(p, s));
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

interface ManifestShape {
  status?: unknown;
  pid?: unknown;
}

interface CompletedShape {
  result?: unknown;
}

/**
 * Classify a run dir's resume-eligibility state.
 *
 * Decision order:
 *   1. Run dir absent → nonexistent
 *   2. completed.json present → completed | failed (driven by `result`)
 *   3. run.json torn/missing → stale (safe-to-takeover default)
 *   4. status='active' → check pid liveness → active | stale
 *   5. status='completed' → completed
 *   6. status='failed' → failed
 *   7. Unknown status → stale (resume is safe; corruption is recoverable)
 */
export async function detectRunState(
  runDir: string,
  options: DetectRunStateOptions = {},
): Promise<RunEligibilityState> {
  const isAlive = options.isProcessAlive ?? isProcessAliveDefault;

  if (!(await exists(runDir))) return 'nonexistent';

  const completed = await readJson<CompletedShape>(
    path.join(runDir, 'completed.json'),
  );
  if (completed) {
    return completed.result === 'failed' ? 'failed' : 'completed';
  }

  const manifest = await readJson<ManifestShape>(path.join(runDir, 'run.json'));
  if (!manifest) {
    // Run dir exists but no manifest readable AND no completed.json.
    // Treat as stale so resume can take over without confusion.
    return 'stale';
  }

  const status = typeof manifest.status === 'string' ? manifest.status : '';
  if (status === 'active' || status === 'starting' || status === 'completing') {
    const pid = typeof manifest.pid === 'number' ? manifest.pid : null;
    if (pid == null) return 'stale';
    return isAlive(pid) ? 'active' : 'stale';
  }
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'stale') return 'stale';

  // Unknown / corrupt status — resume is safe.
  return 'stale';
}
