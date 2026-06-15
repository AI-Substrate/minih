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
import { DEFAULT_IDLE_BUDGET_MS, type LiveRunManifest } from './types.js';

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
