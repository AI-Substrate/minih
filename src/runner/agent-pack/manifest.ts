import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentPackManifest, AgentPackManifestFile } from './types.js';

/** Canonical filename of the per-agent manifest. */
export const AGENT_MANIFEST_FILENAME = 'agent.json';

/**
 * Runtime directories an installed agent owns. These NEVER appear in a
 * pack manifest — `validateManifest` rejects any file path inside them.
 *
 * Shared with the Phase 3 tarball extractor (single source of truth for
 * the denylist).
 */
export const RUNTIME_DIR_NAMES: readonly string[] = [
  'runs',
  'inbox',
  'state',
  '.git',
] as const;

/**
 * Canonical files an agent pack may carry without an explicit `agent.json`.
 * If a source folder lacks `agent.json`, install synthesizes a manifest
 * containing only the files in this set that exist on disk.
 *
 * `prompt.md` is REQUIRED in every implicit manifest — synthesis throws
 * otherwise.
 */
export const CANONICAL_AGENT_FILES: readonly string[] = [
  'prompt.md',
  'instructions.md',
  'output-schema.json',
  'input-schema.json',
  'outside.md',
  'inside-state.schema.json',
  'outside-state.schema.json',
] as const;

const CANONICAL_FILE_DESCRIPTIONS: Record<string, string> = {
  'prompt.md': 'Agent prompt with frontmatter — REQUIRED',
  'instructions.md': 'System instructions appended after prompt',
  'output-schema.json': 'AJV schema validating the agent report envelope',
  'input-schema.json': 'AJV schema for `--param` inputs',
  'outside.md': 'Outside-side coordination contract',
  'inside-state.schema.json': 'Schema for inside coordination state',
  'outside-state.schema.json': 'Schema for outside coordination state',
};

export type ValidationResult =
  | { ok: true; manifest: AgentPackManifest }
  | { ok: false; errors: string[] };

/**
 * Validate an unknown value as a well-formed `AgentPackManifest`. All
 * path-safety checks happen here; if `ok: true` the caller may trust
 * `manifest.files[].path` is safe to extract or copy.
 *
 * Path rules (each rejection is independent — first match wins, but all
 * paths are checked so the error list surfaces every violation):
 *   - non-empty string
 *   - no `..` segment
 *   - no leading `/`
 *   - no backslash (Windows-style separators)
 *   - no null byte
 *   - no path starting with a runtime dir name (`runs/`, `inbox/`,
 *     `state/`, `.git/`) — case-insensitive prefix match
 *   - no duplicates within `files[]`
 *   - `prompt.md` MUST appear exactly once
 *
 * Returns `{ ok: true, manifest }` or `{ ok: false, errors }`.
 */
export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push('`name` must be a non-empty string');
  }
  if (typeof obj.version !== 'string' || obj.version.trim() === '') {
    errors.push('`version` must be a non-empty string');
  }
  if (typeof obj.description !== 'string' || obj.description.trim() === '') {
    errors.push('`description` must be a non-empty string');
  }

  if (obj.author !== undefined && typeof obj.author !== 'string') {
    errors.push('`author` must be a string when present');
  }
  if (obj.minihVersion !== undefined && typeof obj.minihVersion !== 'string') {
    errors.push('`minihVersion` must be a string when present');
  }
  if (
    obj.tags !== undefined &&
    (!Array.isArray(obj.tags) || obj.tags.some((t) => typeof t !== 'string'))
  ) {
    errors.push('`tags` must be an array of strings when present');
  }
  if (obj.type !== undefined && obj.type !== 'minih-agent') {
    errors.push('`type`, when present, must be exactly "minih-agent"');
  }

  if (!Array.isArray(obj.files)) {
    errors.push('`files` must be an array');
    return { ok: false, errors };
  }

  const seenPaths = new Set<string>();
  let hasPromptMd = false;
  for (let i = 0; i < obj.files.length; i++) {
    const entry = obj.files[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`files[${i}] must be an object`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string' || e.path === '') {
      errors.push(`files[${i}].path must be a non-empty string`);
      continue;
    }
    if (typeof e.description !== 'string') {
      errors.push(`files[${i}].description must be a string`);
    }
    const pathErr = checkManifestPath(e.path);
    if (pathErr) {
      errors.push(`files[${i}].path "${e.path}": ${pathErr}`);
      continue;
    }
    if (seenPaths.has(e.path)) {
      errors.push(`files[${i}].path "${e.path}" is duplicate`);
      continue;
    }
    seenPaths.add(e.path);
    if (e.path === 'prompt.md') hasPromptMd = true;
  }

  if (!hasPromptMd) {
    errors.push('`files[]` must include `prompt.md` (required)');
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, manifest: obj as unknown as AgentPackManifest };
}

/**
 * Path safety check used both for manifest validation and (transitively)
 * by the Phase 3 tarball extractor. Returns null if safe, error string if
 * not.
 */
export function checkManifestPath(p: string): string | null {
  if (p === '') return 'must be non-empty';
  if (p.includes('\u0000')) return 'must not contain null byte';
  if (p.includes('\\')) return 'must not contain backslash';
  if (p.startsWith('/')) return 'must not be absolute (no leading "/")';

  const segments = p.split('/');
  if (segments.includes('..') || segments.includes('.')) {
    return 'must not contain "." or ".." segments';
  }

  const firstSegment = segments[0]?.toLowerCase() ?? '';
  for (const rt of RUNTIME_DIR_NAMES) {
    if (firstSegment === rt.toLowerCase()) {
      return `must not be inside the "${rt}/" runtime directory`;
    }
  }

  return null;
}

/**
 * Read and validate an `agent.json` from `agentDir`. Returns null if no
 * `agent.json` is present (caller may then call `synthesizeImplicitManifest`).
 *
 * Throws on malformed JSON or invalid manifest shape.
 */
export function readAgentManifest(agentDir: string): AgentPackManifest | null {
  const manifestPath = path.join(agentDir, AGENT_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `agent.json malformed at ${manifestPath}: ${(err as Error).message}`,
    );
  }

  const result = validateManifest(parsed);
  if (!result.ok) {
    throw new Error(
      `agent.json invalid at ${manifestPath}:\n  - ${result.errors.join('\n  - ')}`,
    );
  }
  return result.manifest;
}

/**
 * Synthesize an implicit manifest for an agent without an `agent.json`.
 * Includes only canonical files that exist on disk; `prompt.md` is
 * required (throws if missing).
 *
 * Used at install time as the fallback path when the source repo's
 * `<agent>/` folder lacks an explicit manifest. Phase 6 acceptance: the
 * implicit-manifest case still installs a working agent with sensible
 * defaults.
 */
export function synthesizeImplicitManifest(
  agentDir: string,
): AgentPackManifest {
  const promptPath = path.join(agentDir, 'prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new Error(
      `cannot synthesize implicit manifest at ${agentDir}: prompt.md is required`,
    );
  }

  const files: AgentPackManifestFile[] = [];
  for (const candidate of CANONICAL_AGENT_FILES) {
    if (fs.existsSync(path.join(agentDir, candidate))) {
      files.push({
        path: candidate,
        description: CANONICAL_FILE_DESCRIPTIONS[candidate] ?? candidate,
      });
    }
  }

  return {
    name: path.basename(agentDir),
    version: '0.0.0',
    description: 'Implicit manifest (no agent.json shipped with source)',
    type: 'minih-agent',
    files,
  };
}
