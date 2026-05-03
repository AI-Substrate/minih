import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MinihSourceSidecar } from './types.js';

/** Canonical filename of the install-time provenance sidecar. */
export const SOURCE_SIDECAR_FILENAME = '.minih-source.json';

const SUPPORTED_SCHEMA_VERSION = '1';

/**
 * Read the `.minih-source.json` sidecar from an installed agent's folder.
 * Returns null if the sidecar is absent (this is the "agent was hand-rolled,
 * not minih-installed" case).
 *
 * Tolerates unknown fields (forward-compat) but rejects unknown
 * `schemaVersion` values with a loud error.
 *
 * @throws on malformed JSON, unknown schemaVersion, or missing required
 *   fields.
 */
export function readSourceSidecar(agentDir: string): MinihSourceSidecar | null {
  const sidecarPath = path.join(agentDir, SOURCE_SIDECAR_FILENAME);
  if (!fs.existsSync(sidecarPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
  } catch (err) {
    throw new Error(
      `${SOURCE_SIDECAR_FILENAME} malformed at ${sidecarPath}: ${(err as Error).message}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `${SOURCE_SIDECAR_FILENAME} at ${sidecarPath} must be a JSON object`,
    );
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `${SOURCE_SIDECAR_FILENAME} at ${sidecarPath} has schemaVersion=${String(obj.schemaVersion)}, this minih supports ${SUPPORTED_SCHEMA_VERSION}`,
    );
  }
  for (const required of [
    'slug',
    'source',
    'installedAt',
    'manifestVersion',
    'fileChecksums',
  ] as const) {
    if (obj[required] === undefined) {
      throw new Error(
        `${SOURCE_SIDECAR_FILENAME} at ${sidecarPath}: missing required field \`${required}\``,
      );
    }
  }

  // Sidecar is structurally valid for the current schema. Cast to the
  // typed contract; unknown fields remain on the underlying object but
  // aren't visible through the type — that's fine for forward-compat.
  return obj as unknown as MinihSourceSidecar;
}

/**
 * Write the `.minih-source.json` sidecar atomically to an agent folder.
 *
 * @throws if the agent folder doesn't exist.
 */
export function writeSourceSidecar(
  agentDir: string,
  sidecar: MinihSourceSidecar,
): void {
  if (!fs.existsSync(agentDir)) {
    throw new Error(
      `cannot write ${SOURCE_SIDECAR_FILENAME}: agent directory ${agentDir} does not exist`,
    );
  }
  const sidecarPath = path.join(agentDir, SOURCE_SIDECAR_FILENAME);
  const tmpPath = `${sidecarPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  fs.renameSync(tmpPath, sidecarPath);
}

/**
 * Compute a sha256 hex checksum for each manifest-listed file inside the
 * agent folder. Output is a `{ "relative/path": "sha256:<hex>" }` map.
 *
 * @throws if any of the listed files is missing on disk.
 */
export function computeFileChecksums(
  agentDir: string,
  files: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of files) {
    const abs = path.join(agentDir, rel);
    const data = fs.readFileSync(abs);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    out[rel] = `sha256:${sha}`;
  }
  return out;
}

/**
 * Compare the on-disk checksums against an `expected` map (typically from
 * `.minih-source.json#fileChecksums`). Returns `'unchanged'`, `'modified'`,
 * or `'missing'` per file.
 *
 * Used by `agent info` for drift detection and by install-as-upgrade to
 * compute the file-level diff (which files actually changed since install).
 */
export function verifyChecksums(
  agentDir: string,
  expected: Record<string, string>,
): Record<string, 'unchanged' | 'modified' | 'missing'> {
  const out: Record<string, 'unchanged' | 'modified' | 'missing'> = {};
  for (const [rel, expectedHash] of Object.entries(expected)) {
    const abs = path.join(agentDir, rel);
    if (!fs.existsSync(abs)) {
      out[rel] = 'missing';
      continue;
    }
    const data = fs.readFileSync(abs);
    const actual = `sha256:${crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')}`;
    out[rel] = actual === expectedHash ? 'unchanged' : 'modified';
  }
  return out;
}
