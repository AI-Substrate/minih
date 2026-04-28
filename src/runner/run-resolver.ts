/**
 * Shared run resolver — workshop 002 §2.
 *
 * Single source of truth for "what run does the user mean?" Three CLI
 * commands (tail/status/connect) currently disagree; the human view
 * (Phase 2) and any new attach paths consume this resolver instead.
 *
 * Failure modes:
 * - Missing slug → returns null.
 * - by-id with missing runId → returns null.
 * - latest-active with >1 active candidates → throws MultipleActiveRunsError
 *   listing each candidate so the CLI can render disambiguation.
 * - per-candidate fault tolerance: torn manifest for one candidate is
 *   recorded as a diagnostic on the returned ResolvedRun (or, if it was
 *   the only candidate, surfaced in the diagnostics of the next chosen
 *   run — never silently swallowed).
 * - stale: manifest with updatedAt older than the configurable threshold
 *   is reported as `liveness: 'stale'` rather than 'active'.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findRunSession } from './folder.js';
import { MultipleActiveRunsError } from './human-view-errors.js';
import { ManifestSchemaVersionError, readManifest } from './run-manifest.js';
import type {
  ActiveRunCandidate,
  CompletedMetadata,
  LiveRunManifest,
  ResolvedRun,
  ResolverDiagnostic,
  RunLiveness,
  RunResolveMode,
} from './types.js';

const DEFAULT_STALE_THRESHOLD_MS = 60_000;
const ACTIVE_STATUSES = new Set<LiveRunManifest['status']>([
  'starting',
  'active',
  'completing',
]);

export interface ResolveRunInput {
  slug: string;
  mode: RunResolveMode;
  /** Override stale threshold (ms). Default: 60_000. */
  staleThresholdMs?: number;
  /** Override agents directory. Default: `<cwd>/agents`. */
  agentsDir?: string;
  /** Inject "now" for deterministic tests. */
  now?: () => number;
}

export async function resolveRun(
  input: ResolveRunInput,
): Promise<ResolvedRun | null> {
  const agentsDir = input.agentsDir ?? path.join(process.cwd(), 'agents');
  const slugDir = path.join(agentsDir, input.slug);

  // Slug existence check — return null cleanly, do not throw.
  try {
    const stat = await fs.stat(slugDir);
    if (!stat.isDirectory()) return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  switch (input.mode.kind) {
    case 'by-id':
      return resolveById(input.slug, slugDir, input.mode.runId, input);
    case 'latest-active':
      return resolveLatestActive(input.slug, slugDir, input);
    case 'latest-completed':
      return resolveLatestCompleted(input.slug, slugDir, input);
    case 'latest-any': {
      const active = await resolveLatestActive(input.slug, slugDir, input);
      if (active) return active;
      return resolveLatestCompleted(input.slug, slugDir, input);
    }
  }
}

async function resolveById(
  slug: string,
  slugDir: string,
  runId: string,
  input: ResolveRunInput,
): Promise<ResolvedRun | null> {
  const runDir = path.join(slugDir, 'runs', runId);
  try {
    const stat = await fs.stat(runDir);
    if (!stat.isDirectory()) return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return loadRun(slug, runId, runDir, input, []);
}

async function resolveLatestActive(
  slug: string,
  slugDir: string,
  input: ResolveRunInput,
): Promise<ResolvedRun | null> {
  const candidates = await listRunDirs(slugDir);
  const active: Array<{
    runId: string;
    runDir: string;
    manifest: LiveRunManifest;
  }> = [];
  const diagnostics: ResolverDiagnostic[] = [];

  for (const c of candidates) {
    let manifest: LiveRunManifest | null;
    try {
      manifest = await readManifest(c.runDir);
    } catch (err) {
      if (err instanceof ManifestSchemaVersionError) {
        diagnostics.push({ runId: c.runId, message: err.message });
        continue;
      }
      throw err;
    }
    if (!manifest) {
      // Missing or torn — does it have a completed.json? Then it's a
      // legitimate completed run; ignore for active search. Else,
      // record a diagnostic so the user knows we skipped it.
      const hasCompleted = await fileExists(
        path.join(c.runDir, 'completed.json'),
      );
      if (!hasCompleted) {
        diagnostics.push({
          runId: c.runId,
          message: 'run.json missing or unreadable',
        });
      }
      continue;
    }
    if (ACTIVE_STATUSES.has(manifest.status)) {
      active.push({ runId: c.runId, runDir: c.runDir, manifest });
    }
  }

  if (active.length === 0) return null;

  if (active.length > 1) {
    const list: ActiveRunCandidate[] = active.map((a) => ({
      runId: a.runId,
      startedAt: a.manifest.startedAt,
      sessionId: a.manifest.sessionId,
    }));
    throw new MultipleActiveRunsError(slug, list);
  }

  const sole = active[0];
  if (!sole) return null; // satisfy noUncheckedIndexedAccess
  return projectActive(
    slug,
    sole.runId,
    sole.runDir,
    sole.manifest,
    diagnostics,
    input,
  );
}

async function resolveLatestCompleted(
  slug: string,
  _slugDir: string,
  input: ResolveRunInput,
): Promise<ResolvedRun | null> {
  // Reuse findRunSession() for completed-only fallback.
  const agentsDir = input.agentsDir ?? path.join(process.cwd(), 'agents');
  const session = findRunSession(slug, agentsDir);
  if (!session) return null;
  return loadRun(slug, session.runId, session.runDir, input, []);
}

async function loadRun(
  slug: string,
  runId: string,
  runDir: string,
  input: ResolveRunInput,
  carriedDiagnostics: ResolverDiagnostic[],
): Promise<ResolvedRun> {
  const diagnostics: ResolverDiagnostic[] = [...carriedDiagnostics];
  let manifest: LiveRunManifest | null = null;
  try {
    manifest = await readManifest(runDir);
  } catch (err) {
    if (err instanceof ManifestSchemaVersionError) {
      diagnostics.push({ runId, message: err.message });
    } else {
      throw err;
    }
  }
  const completed = await readCompletedMetadata(runDir);
  const liveness = computeLiveness(manifest, completed, input);
  if (
    manifest &&
    liveness === 'active' &&
    ACTIVE_STATUSES.has(manifest.status)
  ) {
    return projectActive(slug, runId, runDir, manifest, diagnostics, input);
  }
  return {
    slug,
    runId,
    runDir,
    manifest,
    completed,
    liveness,
    diagnostics,
  };
}

function projectActive(
  slug: string,
  runId: string,
  runDir: string,
  manifest: LiveRunManifest,
  diagnostics: ResolverDiagnostic[],
  input: ResolveRunInput,
): ResolvedRun {
  const liveness = computeLiveness(manifest, null, input);
  return {
    slug,
    runId,
    runDir,
    manifest,
    completed: null,
    liveness,
    diagnostics,
  };
}

function computeLiveness(
  manifest: LiveRunManifest | null,
  completed: CompletedMetadata | null,
  input: ResolveRunInput,
): RunLiveness {
  if (completed) {
    return completed.result === 'failed' ? 'failed' : 'completed';
  }
  if (!manifest) return 'unknown';
  if (manifest.status === 'completed') return 'completed';
  if (manifest.status === 'failed') return 'failed';
  if (manifest.status === 'stale') return 'stale';
  if (ACTIVE_STATUSES.has(manifest.status)) {
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
  const target = path.join(runDir, 'completed.json');
  try {
    const raw = await fs.readFile(target, 'utf8');
    return JSON.parse(raw) as CompletedMetadata;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null; // torn JSON — surface as null, not a throw
  }
}

interface RunDirEntry {
  runId: string;
  runDir: string;
}

async function listRunDirs(slugDir: string): Promise<RunDirEntry[]> {
  const runsRoot = path.join(slugDir, 'runs');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      runId: e.name,
      runDir: path.join(runsRoot, e.name),
    }));
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
