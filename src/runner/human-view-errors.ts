/**
 * Human View — Phase 1 runtime errors.
 *
 * Typed error classes for live-run manifest and resolver paths. Kept
 * separate from `types.ts` because TypeScript-only types cannot include
 * class declarations cleanly when types.ts is consumed as type-only.
 */

import type { ActiveRunCandidate } from './types.js';

/**
 * Thrown by `resolveRun({ mode: 'latest-active' })` when more than one
 * run is active for the same agent slug. Lists candidates so callers
 * can surface them to the user (acceptance criterion 11).
 */
export class MultipleActiveRunsError extends Error {
  readonly candidates: ActiveRunCandidate[];

  constructor(slug: string, candidates: ActiveRunCandidate[]) {
    super(
      `multiple active runs found for agent '${slug}': ${candidates
        .map((c) => c.runId)
        .join(', ')}. Pass --run <runId> to disambiguate.`,
    );
    this.name = 'MultipleActiveRunsError';
    this.candidates = candidates;
  }
}

/**
 * Thrown by `readManifest()` when the on-disk `run.json` declares a
 * `schemaVersion` that this build does not understand. v1 has no
 * migration path — callers should treat it as "unrecognised manifest".
 */
export class ManifestSchemaVersionError extends Error {
  readonly actual: number | string | undefined;

  constructor(path: string, actual: number | string | undefined) {
    super(
      `run manifest at ${path} has unsupported schemaVersion=${String(
        actual,
      )}; expected 1`,
    );
    this.name = 'ManifestSchemaVersionError';
    this.actual = actual;
  }
}
