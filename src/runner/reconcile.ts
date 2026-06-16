/**
 * Reconcile — plan 025 FX011.
 *
 * Walks run dirs (reusing the run-inventory walkers), probes each
 * non-terminal manifest's recorded pid, and heals dead runs in place:
 * `status: 'crashed'` + `terminalReason: 'pid-vanished'` — the latter ONLY
 * when no terminalReason exists yet (preservation invariant AC-FX11.9:
 * FX012's `provider-stream-aborted` diagnosis must survive a heal).
 *
 * Idempotent by construction: healed manifests leave the probe-eligible
 * status set, so a second pass skips them. Writes go through
 * `updateManifest` (atomic temp-file + rename). Locking is the caller's
 * job (`reconcile-lock.ts` + the CLI shell) — the core stays pure for
 * testability.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isProcessAliveDefault } from './run-eligibility.js';
import { listAgentSlugs, listRunDirs } from './run-inventory.js';
import { updateManifest } from './run-manifest.js';

/** Manifest statuses that claim a live process — the heal candidates. */
const PROBE_STATUSES = new Set(['starting', 'active', 'idle', 'completing']);

/**
 * Plan 028 Phase 4 (G) — terminalReasons that denote a *clean* stop, not a
 * crash. A dead-pid manifest carrying one of these (or `cleanStop: true`)
 * reconciles to `completed`, never `crashed`. Kept as a string set so a
 * tolerant-parsed reason matches regardless of the union's compile-time shape.
 */
const CLEAN_REASONS = new Set([
  'operator-stop',
  'idle-budget',
  'no-engagement',
]);

export interface ReconcileOptions {
  agentsDir?: string;
  /** Limit the walk to one agent slug. */
  slug?: string;
  /** Limit the walk to one run (requires `slug`). */
  runId?: string;
  /** Inject the pid-liveness probe. Defaults to the shared runner probe. */
  isProcessAlive?: (pid: number) => boolean;
}

export interface ReconcileHealedRun {
  slug: string;
  runId: string;
  pid: number | null;
  previousStatus: string;
}

export interface ReconcileReport {
  /** Run dirs inspected (after slug/runId scoping). */
  scanned: number;
  healed: ReconcileHealedRun[];
  /**
   * Plan 028 Phase 4 (G) — dead-pid runs that carried a clean-stop marker
   * (`cleanStop: true` or a clean `terminalReason`) and were reconciled to
   * `completed` rather than `crashed`. A clean shutdown is not a heal.
   */
  reconciledClean: ReconcileHealedRun[];
  skipped: {
    /** completed.json present or manifest already terminal. */
    terminal: number;
    /** Probe says the pid is alive. */
    alive: number;
    /** Non-terminal manifest without a usable pid — no proof of death. */
    noPid: number;
    /** run.json missing or unparseable. */
    torn: number;
  };
}

export async function reconcileRuns(
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const agentsDir = path.resolve(options.agentsDir ?? 'agents');
  const isAlive = options.isProcessAlive ?? isProcessAliveDefault;
  const slugs = options.slug ? [options.slug] : await listAgentSlugs(agentsDir);

  const report: ReconcileReport = {
    scanned: 0,
    healed: [],
    reconciledClean: [],
    skipped: { terminal: 0, alive: 0, noPid: 0, torn: 0 },
  };

  for (const slug of slugs) {
    let runDirs = await listRunDirs(path.join(agentsDir, slug));
    if (options.runId) {
      runDirs = runDirs.filter((run) => run.runId === options.runId);
    }
    for (const { runId, runDir } of runDirs) {
      report.scanned++;

      // completed.json wins — terminal, never healed, never probed.
      if (await exists(path.join(runDir, 'completed.json'))) {
        report.skipped.terminal++;
        continue;
      }

      const manifest = await readJsonTolerant(path.join(runDir, 'run.json'));
      if (!manifest || typeof manifest.status !== 'string') {
        report.skipped.torn++;
        continue;
      }
      if (!PROBE_STATUSES.has(manifest.status)) {
        report.skipped.terminal++;
        continue;
      }
      const pid = typeof manifest.pid === 'number' ? manifest.pid : null;
      if (pid === null) {
        report.skipped.noPid++;
        continue;
      }
      // Probe immediately before the write to keep the TOCTOU window minimal.
      if (isAlive(pid)) {
        report.skipped.alive++;
        continue;
      }

      // Plan 028 Phase 4 (G) — a clean-stop marker (`cleanStop: true` or a
      // clean `terminalReason`) means this dead pid is the tail of a clean
      // shutdown (farewell / operator-stop / idle), NOT a crash. Reconcile to
      // `completed` and preserve any clean reason — never overwrite to
      // crashed + pid-vanished.
      const isCleanStop =
        manifest.cleanStop === true ||
        (manifest.terminalReason !== undefined &&
          CLEAN_REASONS.has(manifest.terminalReason));
      if (isCleanStop) {
        await updateManifest(runDir, { status: 'completed' });
        report.reconciledClean.push({
          slug,
          runId,
          pid,
          previousStatus: manifest.status,
        });
        continue;
      }

      await updateManifest(runDir, {
        status: 'crashed',
        // Preservation invariant — never overwrite an existing diagnosis.
        ...(manifest.terminalReason === undefined && {
          terminalReason: 'pid-vanished',
        }),
      });
      report.healed.push({
        slug,
        runId,
        pid,
        previousStatus: manifest.status,
      });
    }
  }

  return report;
}

interface TolerantManifest {
  status?: unknown;
  pid?: unknown;
  terminalReason?: unknown;
  cleanStop?: unknown;
  [key: string]: unknown;
}

async function readJsonTolerant(filePath: string): Promise<
  | (Omit<TolerantManifest, 'status' | 'terminalReason' | 'cleanStop'> & {
      status?: string;
      terminalReason?: string;
      cleanStop?: boolean;
    })
  | null
> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as TolerantManifest;
    return {
      ...parsed,
      status: typeof parsed.status === 'string' ? parsed.status : undefined,
      terminalReason:
        typeof parsed.terminalReason === 'string'
          ? parsed.terminalReason
          : undefined,
      // Plan 028 Phase 4 (G) — only the literal `true` counts as a clean stop.
      cleanStop: parsed.cleanStop === true,
    };
  } catch {
    return null;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}
