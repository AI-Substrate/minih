import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RegistryCatalog, RegistryEntry } from './types.js';

/**
 * Default catalog path — bundled in `dist/templates/agents-registry.json`.
 * Resolved lazily so tests can override.
 */
const DEFAULT_CATALOG_PATH = fileURLToPath(
  new URL('../../templates/agents-registry.json', import.meta.url),
);

const SUPPORTED_CATALOG_VERSION = '1';
const MAX_SUGGESTIONS = 3;
const MAX_LEVENSHTEIN_DISTANCE = 2;

/**
 * Parse and validate a registry catalog file. If the file does not exist,
 * returns an empty catalog (valid v1 shape, zero entries) — this makes
 * `agent list --available` graceful in test environments.
 *
 * @throws if the catalog file is malformed JSON, has an unsupported
 *   `version`, or contains entries missing required fields.
 */
export function readRegistryCatalog(
  catalogPath: string = DEFAULT_CATALOG_PATH,
): RegistryCatalog {
  if (!fs.existsSync(catalogPath)) {
    return { version: SUPPORTED_CATALOG_VERSION, agents: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  } catch (err) {
    throw new Error(
      `registry catalog malformed at ${catalogPath}: ${(err as Error).message}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`registry catalog at ${catalogPath} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.version !== SUPPORTED_CATALOG_VERSION) {
    throw new Error(
      `registry catalog version ${String(obj.version)} unsupported — this minih supports version ${SUPPORTED_CATALOG_VERSION}`,
    );
  }

  if (!Array.isArray(obj.agents)) {
    throw new Error('registry catalog `agents` must be an array');
  }

  const validated: RegistryEntry[] = obj.agents.map((entry, idx) => {
    return validateEntry(entry, idx, catalogPath);
  });

  return { version: SUPPORTED_CATALOG_VERSION, agents: validated };
}

function validateEntry(
  raw: unknown,
  idx: number,
  catalogPath: string,
): RegistryEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `registry entry ${idx} in ${catalogPath} must be an object`,
    );
  }
  const e = raw as Record<string, unknown>;
  for (const required of ['slug', 'url', 'ref', 'description'] as const) {
    if (typeof e[required] !== 'string' || e[required] === '') {
      throw new Error(
        `registry entry ${idx} in ${catalogPath}: \`${required}\` must be a non-empty string`,
      );
    }
  }
  if (e.subpath !== undefined && typeof e.subpath !== 'string') {
    throw new Error(
      `registry entry ${idx} \`subpath\` must be a string when present`,
    );
  }
  if (
    e.tags !== undefined &&
    (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== 'string'))
  ) {
    throw new Error(
      `registry entry ${idx} \`tags\` must be an array of strings when present`,
    );
  }
  if (e.since !== undefined && typeof e.since !== 'string') {
    throw new Error(
      `registry entry ${idx} \`since\` must be a string when present`,
    );
  }
  if (e.minihVersion !== undefined && typeof e.minihVersion !== 'string') {
    throw new Error(
      `registry entry ${idx} \`minihVersion\` must be a string when present`,
    );
  }

  // Forward-compat: copy known fields, drop unknown ones silently.
  const out: RegistryEntry = {
    slug: e.slug as string,
    url: e.url as string,
    ref: e.ref as string,
    description: e.description as string,
  };
  if (typeof e.subpath === 'string') out.subpath = e.subpath;
  if (Array.isArray(e.tags)) out.tags = e.tags as string[];
  if (typeof e.since === 'string') out.since = e.since;
  if (typeof e.minihVersion === 'string') out.minihVersion = e.minihVersion;
  return out;
}

/**
 * Resolve a slug against the catalog. Returns `{ entry, suggestions: [] }`
 * on hit, or `{ entry: null, suggestions: [...] }` on miss (with up to 3
 * Levenshtein-near matches, distance ≤ 2).
 */
export function resolveRegistrySlug(
  slug: string,
  catalog: RegistryCatalog,
): { entry: RegistryEntry | null; suggestions: string[] } {
  const hit = catalog.agents.find((e) => e.slug === slug);
  if (hit) return { entry: hit, suggestions: [] };

  const ranked = catalog.agents
    .map((e) => ({ slug: e.slug, dist: levenshtein(slug, e.slug) }))
    .filter((r) => r.dist <= MAX_LEVENSHTEIN_DISTANCE)
    .sort((a, b) => a.dist - b.dist || a.slug.localeCompare(b.slug))
    .slice(0, MAX_SUGGESTIONS)
    .map((r) => r.slug);

  return { entry: null, suggestions: ranked };
}

/**
 * Return all catalog entries sorted alphabetically by slug. Stable order
 * for `agent list --available` output.
 */
export function listRegistryAgents(catalog: RegistryCatalog): RegistryEntry[] {
  return [...catalog.agents].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Levenshtein distance — adapted from `src/runner/validator.ts` (kept
 * inline to avoid cross-module import for what is ~20 lines of code).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min((dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n] ?? 0;
}
