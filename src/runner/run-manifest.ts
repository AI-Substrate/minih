/**
 * Live run manifest — `runs/<runId>/run.json`.
 *
 * Workshop 002 §1: capture live identity (sessionId, status, counters)
 * from run-folder creation onward, not just at completion. Phase 2's
 * `view` command reads this; Phase 1 wires writes from runner.ts.
 *
 * Threading model: callers may schedule manifest updates from async event
 * handlers, so writes are serialized per runDir. Throttle exists to avoid
 * disk thrash on per-event counter updates; status and sessionId patches
 * bypass throttle (correctness > throughput).
 *
 * POSIX-only — `writeFileAtomicAsync` is POSIX-only by repo policy
 * (`atomic-write.ts` header). Windows is out of scope.
 */

import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomicAsync } from './atomic-write.js';
import { ManifestSchemaVersionError } from './human-view-errors.js';
import {
  DEFAULT_IDLE_BUDGET_MS,
  type LiveRunManifest,
  SURVIVE_GAPS_HEARTBEAT_INTERVAL_MS,
} from './types.js';

const MANIFEST_FILENAME = 'run.json';
const SUPPORTED_SCHEMA_VERSION = 1 as const;

/**
 * Per-runDir throttle state. Keyed by absolute runDir to support
 * concurrent runs in different directories cleanly.
 */
interface ThrottleState {
  pendingPatch: Partial<LiveRunManifest> | null;
  timer: NodeJS.Timeout | null;
}
const throttleStates = new Map<string, ThrottleState>();
const writeQueues = new Map<string, Promise<void>>();

function manifestPath(runDir: string): string {
  return path.join(runDir, MANIFEST_FILENAME);
}

export async function writeManifest(
  runDir: string,
  manifest: LiveRunManifest,
): Promise<void> {
  const target = manifestPath(runDir);
  const next: LiveRunManifest = {
    ...manifest,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    updatedAt: manifest.updatedAt ?? new Date().toISOString(),
  };
  await enqueueManifestWrite(runDir, () =>
    writeFileAtomicAsync(target, `${JSON.stringify(next, null, 2)}\n`),
  );
}

/**
 * Plan 027 Phase 5 (#35) — synchronous read of the effective idle budget that
 * was recorded into run.json `budgets.idleBudgetMs` at run start. Returns the
 * schema default ({@link DEFAULT_IDLE_BUDGET_MS}) when run.json is absent,
 * unparseable, or predates the field. Sync (not the async `readManifest`) so the
 * synchronous `coordination_status` MCP tool can surface `idleBudgetSec` without
 * going async.
 */
export function readIdleBudgetMs(runDir: string): number {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(runDir), 'utf8')) as {
      budgets?: { idleBudgetMs?: unknown };
    };
    const v = parsed.budgets?.idleBudgetMs;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  } catch {
    // absent / torn / pre-#35 run.json → fall back to the schema default
  }
  return DEFAULT_IDLE_BUDGET_MS;
}

/**
 * Plan 028 Phase 5b (workshop 003) — synchronous read of the survive-gaps
 * posture recorded into run.json `budgets.surviveGaps` at run start. Returns
 * false when run.json is absent, unparseable, or predates the field. Sync (like
 * {@link readIdleBudgetMs}) so #49's future runner-side idle trigger reads the
 * posture the same way it reads the idle budget. A survive-gaps run is never
 * stood down on idle alone — only the wall-clock backstop (see
 * `evaluateIdlePolicy`).
 */
export function readSurviveGaps(runDir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(runDir), 'utf8')) as {
      budgets?: { surviveGaps?: unknown };
    };
    return parsed.budgets?.surviveGaps === true;
  } catch {
    // absent / torn / pre-5b run.json → default posture (not survive-gaps)
  }
  return false;
}

export async function readManifest(
  runDir: string,
): Promise<LiveRunManifest | null> {
  const target = manifestPath(runDir);
  let raw: string;
  try {
    raw = await fs.readFile(target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // torn / malformed — caller decides whether to surface
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const sv = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (sv !== SUPPORTED_SCHEMA_VERSION) {
    throw new ManifestSchemaVersionError(target, sv as number | string);
  }
  return parsed as LiveRunManifest;
}

/**
 * Patch-style update. Status and sessionId patches bypass the throttle
 * (write immediately + flush any pending throttled patch). Counter-only
 * patches enter the throttle window.
 */
export async function updateManifest(
  runDir: string,
  patch: Partial<LiveRunManifest>,
  options: { throttleMs?: number } = {},
): Promise<void> {
  const isImmediate =
    Object.hasOwn(patch, 'status') ||
    Object.hasOwn(patch, 'sessionId') ||
    Object.hasOwn(patch, 'control') ||
    Object.hasOwn(patch, 'model');

  if (isImmediate || options.throttleMs == null) {
    // Flush any pending throttled patch first to preserve counter ordering.
    await flushThrottled(runDir);
    await enqueueManifestWrite(runDir, () => applyPatch(runDir, patch));
    return;
  }

  // Throttled path — coalesce the patch but do not write yet.
  const state = throttleStates.get(runDir) ?? {
    pendingPatch: null,
    timer: null,
  };
  state.pendingPatch = mergePatch(state.pendingPatch, patch);
  throttleStates.set(runDir, state);
  if (state.timer == null) {
    state.timer = setTimeout(() => {
      void flushThrottled(runDir).catch((err: unknown) => {
        queueMicrotask(() => {
          throw err;
        });
      });
    }, options.throttleMs);
    // setTimeout returns a Timeout that prevents process exit; let it stay.
  }
}

/**
 * Flush any pending throttled patch to disk. Idempotent.
 * Public so runner.ts can flush on terminal condition / completion.
 */
export async function flushThrottled(runDir: string): Promise<void> {
  const state = throttleStates.get(runDir);
  if (!state?.pendingPatch) return;
  const patch = state.pendingPatch;
  state.pendingPatch = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  await enqueueManifestWrite(runDir, () => applyPatch(runDir, patch));
}

/**
 * Plan 028 Phase 5 (#50 follow-up) — opt-in survive-gaps heartbeat.
 *
 * Starts a timer that bumps `run.json.updatedAt` (via {@link updateManifest},
 * which always re-stamps `updatedAt` on apply) on a cadence that beats the 60s
 * run-active staleness window — so a survive-gaps companion waiting quietly
 * through a long human gap keeps satisfying the Phase-1 active predicate
 * (pid-alive ∧ recent `updatedAt`) instead of being read as `stale`.
 *
 * Decoupled from the stall watchdog BY CONSTRUCTION: this module has no access
 * to `resetStallDeadline` (runner.ts) — it only writes the manifest. The
 * provider-event-driven watchdog stays the progress guard and the wall-clock
 * timeout stays the backstop (Finding 11: a heartbeat proves the process is
 * alive, not that the agent is progressing). Opt-in — the runner starts one
 * only when `config.surviveGaps` is set, so default runs keep the strict
 * freshness signal plan 026 relies on.
 *
 * @returns a stop function — call it on terminal/cleanup to clear the timer.
 */
export function startManifestHeartbeat(
  runDir: string,
  intervalMs: number = SURVIVE_GAPS_HEARTBEAT_INTERVAL_MS,
): () => void {
  // F002 (companion review of P5 wrap) — a fully-silent catch would hide a
  // PERSISTENTLY broken heartbeat: a real fault (permissions, disk) would let a
  // survive-gaps run go stale with no operator clue. So surface the first
  // non-teardown failure ONCE on stderr (then stay quiet — no 20s spam), while
  // still ignoring the expected teardown race (`ENOENT` = run dir gone / torn
  // manifest after cleanup). Never throws either way — the heartbeat is
  // advisory; the stall watchdog + wall-clock timeout are the real guards.
  let warnedOnce = false;
  const timer = setInterval(() => {
    void updateManifest(runDir, { updatedAt: new Date().toISOString() }).catch(
      (err: unknown) => {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (!warnedOnce && code !== 'ENOENT') {
          warnedOnce = true;
          console.error(
            `[survive-gaps heartbeat] manifest bump failed for ${runDir} (${code ?? 'unknown'}); heartbeat continues but the run may read stale`,
          );
        }
      },
    );
  }, intervalMs);
  // Never hold the process open on the heartbeat alone — the run lifecycle owns
  // liveness (mirrors the watchdog/timeout handles cleared in runner.ts).
  timer.unref?.();
  return () => {
    clearInterval(timer);
  };
}

async function enqueueManifestWrite(
  runDir: string,
  write: () => Promise<void>,
): Promise<void> {
  const previous = writeQueues.get(runDir) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(write);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(runDir, settled);
  try {
    await run;
  } finally {
    if (writeQueues.get(runDir) === settled) {
      writeQueues.delete(runDir);
    }
  }
}

function mergePatch(
  existing: Partial<LiveRunManifest> | null,
  next: Partial<LiveRunManifest>,
): Partial<LiveRunManifest> {
  if (!existing) return { ...next };
  const merged: Partial<LiveRunManifest> = { ...existing, ...next };
  if (existing.counters || next.counters) {
    merged.counters = {
      ...existing.counters,
      ...next.counters,
    } as LiveRunManifest['counters'];
  }
  if (existing.control || next.control) {
    merged.control = {
      ...existing.control,
      ...next.control,
    } as LiveRunManifest['control'];
  }
  return merged;
}

async function applyPatch(
  runDir: string,
  patch: Partial<LiveRunManifest>,
): Promise<void> {
  const current = await readManifest(runDir);
  if (!current) {
    // Nothing to patch onto. Caller is expected to writeManifest() first;
    // ignore patch silently to avoid masking the real bug.
    return;
  }
  const merged: LiveRunManifest = {
    ...current,
    ...patch,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    counters: { ...current.counters, ...patch.counters },
    control: { ...current.control, ...patch.control },
    updatedAt: new Date().toISOString(),
  };
  await writeFileAtomicAsync(
    manifestPath(runDir),
    `${JSON.stringify(merged, null, 2)}\n`,
  );
}

/** Test helper — clear throttle state. Not exported via index.ts. */
export function __resetThrottleStateForTest(): void {
  for (const state of throttleStates.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  throttleStates.clear();
  writeQueues.clear();
}

export { ManifestSchemaVersionError };
