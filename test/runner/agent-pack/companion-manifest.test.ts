/**
 * Validation tests for the canonical `code-review-companion` agent.json manifest.
 *
 * Phase 5 ships the dogfood `agents/code-review-companion/agent.json` as the
 * canonical reference example for future agent authors. This test guards:
 *   - The file parses as JSON.
 *   - `validateManifest()` accepts it (load-bearing security guard from
 *     `manifest.ts` — path-traversal, runtime-dir, missing prompt.md).
 *   - Every listed file path actually exists relative to the agent dir
 *     (otherwise install would fail mid-copy).
 *   - The companion has the expected discovery tags.
 *   - Negative regressions: traversal/runtime-dir/missing-prompt manifests
 *     are still rejected.
 *
 * This test MUST run before the local-install round-trip (T003) — it's the
 * security gate that proves the manifest is safe to copy.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../../src/runner/agent-pack/manifest.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const COMPANION_DIR = path.join(REPO_ROOT, 'agents/code-review-companion');
const MANIFEST_PATH = path.join(COMPANION_DIR, 'agent.json');

describe('canonical code-review-companion manifest', () => {
  it('parses as JSON', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('validateManifest() accepts it', () => {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    if (!result.ok) {
      throw new Error(
        `canonical manifest failed validation:\n  ${result.errors.join('\n  ')}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it('lists prompt.md in files[] (load-bearing requirement)', () => {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    if (!result.ok) throw new Error('manifest invalid');
    const paths = result.manifest.files.map((f) => f.path);
    expect(paths).toContain('prompt.md');
  });

  it('every listed file actually exists on disk', () => {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    if (!result.ok) throw new Error('manifest invalid');
    for (const entry of result.manifest.files) {
      const absolute = path.join(COMPANION_DIR, entry.path);
      expect(
        fs.existsSync(absolute),
        `manifest lists ${entry.path} but file is missing on disk`,
      ).toBe(true);
    }
  });

  it('declares the "companion" discovery tag', () => {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    if (!result.ok) throw new Error('manifest invalid');
    expect(result.manifest.tags ?? []).toContain('companion');
  });

  it('declares manifestVersion 0.1.0 for the initial seed', () => {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    if (!result.ok) throw new Error('manifest invalid');
    expect(result.manifest.version).toBe('0.1.0');
  });
});

describe('validateManifest negative regressions (security guard sanity check)', () => {
  it('rejects path traversal', () => {
    const result = validateManifest({
      name: 'attacker',
      version: '0.0.1',
      description: 'a',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: '../../etc/passwd', description: 'evil' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects runtime-dir entries', () => {
    const result = validateManifest({
      name: 'attacker',
      version: '0.0.1',
      description: 'a',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: 'runs/something', description: 'evil' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects manifest with no prompt.md', () => {
    const result = validateManifest({
      name: 'attacker',
      version: '0.0.1',
      description: 'a',
      files: [{ path: 'instructions.md', description: 'p' }],
    });
    expect(result.ok).toBe(false);
  });
});
