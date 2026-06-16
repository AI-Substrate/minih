import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isProcessAliveDefault } from './run-eligibility.js';
import { ManifestSchemaVersionError, readManifest } from './run-manifest.js';
import type {
  CompletedMetadata,
  LiveRunManifest,
  ResolverDiagnostic,
  RunInventoryRow,
  RunLiveness,
  RunStatusRow,
} from './types.js';

const DEFAULT_LIMIT = 50;
const DEFAULT_STALE_THRESHOLD_MS = 60_000;
const ACTIVE_STATUSES = new Set<LiveRunManifest['status']>([
  'starting',
  'active',
  'completing',
]);

export interface ListRunInventoryInput {
  agentsDir?: string;
  slug?: string;
  active?: boolean;
  all?: boolean;
  limit?: number;
  staleThresholdMs?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

export interface GetRunStatusesInput {
  agentsDir?: string;
  targets: Array<{ slug: string; runId: string; target?: string }>;
  staleThresholdMs?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

export async function listRunInventory(
  input: ListRunInventoryInput = {},
): Promise<RunInventoryRow[]> {
  const agentsDir = path.resolve(input.agentsDir ?? 'agents');
  const limit = normalizeLimit(input.limit);
  const slugs = input.slug ? [input.slug] : await listAgentSlugs(agentsDir);
  const rows: RunInventoryRow[] = [];

  for (const slug of slugs) {
    const runDirs = await listRunDirs(path.join(agentsDir, slug));
    const slugRows: RunInventoryRow[] = [];
    for (const run of runDirs) {
      const row = await projectRunRow({
        agentsDir,
        slug,
        runId: run.runId,
        input,
      });
      if (!row) continue;
      // 'dead' stays in the --active view: those rows surfaced as 'stale'
      // before plan 025 and are exactly the runs needing attention. Healed
      // runs (manifest 'crashed') have left the attention queue — that is
      // what `minih reconcile` is for — so they drop out of --active.
      if (input.active) {
        const unhealedDead =
          row.liveness === 'dead' && row.manifestStatus !== 'crashed';
        if (!['active', 'stale'].includes(row.liveness) && !unhealedDead) {
          continue;
        }
      }
      slugRows.push(row);
    }
    // Plan 028 (defect B) — the default view is "active or recent": every live
    // row for this agent plus its single newest terminal row, so the table
    // shows what is running and what last finished. Full terminal history is
    // `--all` (previously a silent no-op). `--active` keeps its own filter.
    if (!input.active && !input.all) {
      rows.push(...selectActiveOrRecent(slugRows));
    } else {
      rows.push(...slugRows);
    }
  }

  return rows.sort(compareRows).slice(0, limit);
}

export async function getRunStatuses(
  input: GetRunStatusesInput,
): Promise<RunStatusRow[]> {
  const agentsDir = path.resolve(input.agentsDir ?? 'agents');
  const rows: RunStatusRow[] = [];
  for (const target of input.targets) {
    const label = target.target ?? `${target.slug}/${target.runId}`;
    const row = await projectRunRow({
      agentsDir,
      slug: target.slug,
      runId: target.runId,
      input,
    });
    if (!row) {
      rows.push({
        target: label,
        found: false,
        slug: target.slug,
        runId: target.runId,
        liveness: 'unknown',
        manifestStatus: null,
        result: null,
        startedAt: null,
        updatedAt: null,
        completedAt: null,
        pid: null,
        model: null,
        sessionId: null,
        eventCount: 0,
        toolCallCount: 0,
        diagnostics: [],
        error: { code: 'E171', message: 'Run not found.' },
      });
      continue;
    }
    rows.push({ ...row, target: label, found: true });
  }
  return rows;
}

export function summarizeStatusRows(rows: RunStatusRow[]): {
  total: number;
  found: number;
  missing: number;
  active: number;
  completed: number;
  failed: number;
} {
  return {
    total: rows.length,
    found: rows.filter((r) => r.found).length,
    missing: rows.filter((r) => !r.found).length,
    active: rows.filter((r) => r.liveness === 'active').length,
    completed: rows.filter((r) => r.liveness === 'completed').length,
    failed: rows.filter((r) => r.liveness === 'failed').length,
  };
}

async function projectRunRow(opts: {
  agentsDir: string;
  slug: string;
  runId: string;
  input: Pick<
    ListRunInventoryInput,
    'staleThresholdMs' | 'now' | 'isProcessAlive'
  >;
}): Promise<RunInventoryRow | null> {
  const runDir = path.join(opts.agentsDir, opts.slug, 'runs', opts.runId);
  const diagnostics: ResolverDiagnostic[] = [];
  let manifest: LiveRunManifest | null = null;
  try {
    manifest = await readManifest(runDir);
  } catch (err) {
    if (err instanceof ManifestSchemaVersionError) {
      diagnostics.push({ runId: opts.runId, message: err.message });
    } else {
      throw err;
    }
  }
  const completed = await readCompletedMetadata(runDir);
  if (!manifest && !completed) return null;
  const liveness = computeLiveness(manifest, completed, opts.input);
  const label = completed?.label ?? manifest?.label;
  const paramsSummary = completed?.paramsSummary ?? manifest?.paramsSummary;
  const eventCount = completed?.eventCount ?? manifest?.counters.events ?? 0;
  const toolCallCount =
    completed?.toolCallCount ?? manifest?.counters.toolCalls ?? 0;

  return {
    slug: opts.slug,
    runId: opts.runId,
    liveness,
    manifestStatus: manifest?.status ?? null,
    result: completed?.result ?? null,
    ...(manifest?.terminalReason && {
      terminalReason: manifest.terminalReason,
    }),
    ...(label && { label }),
    ...(paramsSummary && { paramsSummary }),
    startedAt: completed?.startedAt ?? manifest?.startedAt ?? null,
    updatedAt: manifest?.updatedAt ?? completed?.completedAt ?? null,
    completedAt: completed?.completedAt ?? null,
    pid: manifest?.pid ?? null,
    model: manifest?.model ?? null,
    sessionId: completed?.sessionId ?? manifest?.sessionId ?? null,
    eventCount,
    toolCallCount,
    diagnostics,
  };
}

function computeLiveness(
  manifest: LiveRunManifest | null,
  completed: CompletedMetadata | null,
  input: Pick<
    ListRunInventoryInput,
    'staleThresholdMs' | 'now' | 'isProcessAlive'
  >,
): RunLiveness {
  if (completed) return completed.result === 'failed' ? 'failed' : 'completed';
  if (!manifest) return 'unknown';
  if (manifest.status === 'completed') return 'completed';
  if (manifest.status === 'failed') return 'failed';
  // Plan 025 FX011 — healed by reconcile: terminal, but the truthful
  // liveness is still 'dead' (vocabulary unified with `minih status`).
  if (manifest.status === 'crashed') return 'dead';
  if (manifest.status === 'stale') return 'stale';
  if (ACTIVE_STATUSES.has(manifest.status)) {
    const isAlive = input.isProcessAlive ?? isProcessAliveDefault;
    // Plan 025 CF-01 — a dead pid is 'dead', not 'stale' (stale = live but quiet).
    if (manifest.pid != null && !isAlive(manifest.pid)) return 'dead';
    const threshold = input.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    const now = (input.now ?? Date.now)();
    const updated = Date.parse(manifest.updatedAt);
    if (Number.isFinite(updated) && now - updated > threshold) return 'stale';
    return 'active';
  }
  return 'unknown';
}

async function readCompletedMetadata(
  runDir: string,
): Promise<CompletedMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(runDir, 'completed.json'), 'utf8');
    return JSON.parse(raw) as CompletedMetadata;
  } catch {
    return null;
  }
}

/** Walk agent slugs under an agents dir (exported for reconcile, plan 025). */
export async function listAgentSlugs(agentsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Walk run dirs under one agent dir (exported for reconcile, plan 025). */
export async function listRunDirs(
  slugDir: string,
): Promise<Array<{ runId: string; runDir: string }>> {
  try {
    const entries = await fs.readdir(path.join(slugDir, 'runs'), {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        runId: e.name,
        runDir: path.join(slugDir, 'runs', e.name),
      }))
      .sort((a, b) => b.runId.localeCompare(a.runId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), 500);
}

function compareRows(a: RunInventoryRow, b: RunInventoryRow): number {
  const at = a.startedAt ?? a.updatedAt ?? '';
  const bt = b.startedAt ?? b.updatedAt ?? '';
  const byTime = bt.localeCompare(at);
  return byTime !== 0 ? byTime : b.runId.localeCompare(a.runId);
}

/**
 * A row that belongs to the live "attention" set: actively running, live-but-
 * quiet (stale), or an unhealed dead-pid run. Healed `crashed` runs have left
 * the attention queue and read as terminal here.
 */
function isLiveRow(row: RunInventoryRow): boolean {
  return (
    row.liveness === 'active' ||
    row.liveness === 'stale' ||
    (row.liveness === 'dead' && row.manifestStatus !== 'crashed')
  );
}

/**
 * Plan 028 (defect B) — the default "active or recent" projection for a single
 * agent's rows: keep every live row, plus the single newest terminal row so the
 * table shows what is running and what last finished. Full terminal history is
 * surfaced by `--all`.
 */
function selectActiveOrRecent(
  slugRows: RunInventoryRow[],
): RunInventoryRow[] {
  const live = slugRows.filter(isLiveRow);
  const terminal = slugRows.filter((row) => !isLiveRow(row)).sort(compareRows);
  return terminal.length > 0 ? [...live, terminal[0]] : live;
}
