/**
 * Validation tests for the bundled agent registry seed shipped in
 * `src/templates/agents-registry.json` (and copied to `dist/templates/`
 * by `scripts/copy-schemas.js`).
 *
 * These tests load the SOURCE file directly (not the dist artifact) to
 * catch schema drift in the source independent of the build. They guard:
 *   - The catalog parses + has the expected v1 shape.
 *   - The canonical companion slug resolves correctly.
 *   - Slugs are unique (defensive — catches duplicate-merge regressions).
 *   - The curation principle: zero internal-only agents in the catalog
 *     (smoke-test, convention-check, etc. MUST stay out per user directive).
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  listRegistryAgents,
  readRegistryCatalog,
  resolveRegistrySlug,
} from '../../../src/runner/agent-pack/registry.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_REGISTRY_PATH = path.join(
  REPO_ROOT,
  'src/templates/agents-registry.json',
);

describe('bundled agent registry seed (source file)', () => {
  it('parses as a valid v1 catalog', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    expect(catalog.version).toBe('1');
    expect(Array.isArray(catalog.agents)).toBe(true);
    expect(catalog.agents.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves the canonical code-review-companion slug', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    const result = resolveRegistrySlug('code-review-companion', catalog);
    expect(result.entry).not.toBeNull();
    if (result.entry === null) return; // narrow for TS

    expect(result.entry.slug).toBe('code-review-companion');
    expect(result.entry.url).toBe('github:AI-Substrate/minih');
    expect(result.entry.subpath).toBe('agents/code-review-companion');
    expect(result.entry.tags ?? []).toContain('companion');
    expect(result.entry.minihVersion).toBe('>=0.3.0');
  });

  it('returns sorted-by-slug list for listRegistryAgents', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    const list = listRegistryAgents(catalog);
    const slugs = list.map((a) => a.slug);
    const sorted = [...slugs].sort();
    expect(slugs).toEqual(sorted);
  });

  it('has unique slugs (no merge-conflict duplicates)', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    const slugs = catalog.agents.map((a) => a.slug);
    const uniq = new Set(slugs);
    expect(uniq.size).toBe(slugs.length);
  });

  it('contains zero internal-only agents (curation gate enforced)', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    const slugs = new Set(catalog.agents.map((a) => a.slug));

    // These agents exist in agents/ but are dogfood/internal — they MUST NOT
    // be auto-baked into the user-facing registry. Per user directive:
    // "we don't want to auto bake all agents — some are meant for developing
    // this particular project."
    const INTERNAL_ONLY = [
      'smoke-test',
      'convention-check',
      'coordination-smoke-test',
      'mcp-smoke-test',
      'feedback-digest',
      'prompt-review',
      'self-review',
      'first-time-experience',
      'coordination-loop-validator',
      'demo-companion',
      'hello-world',
    ];
    for (const internal of INTERNAL_ONLY) {
      expect(
        slugs.has(internal),
        `internal-only agent '${internal}' must not appear in the bundled registry`,
      ).toBe(false);
    }
  });

  it('every entry has the required RegistryEntry fields', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    for (const entry of catalog.agents) {
      expect(typeof entry.slug).toBe('string');
      expect(entry.slug.length).toBeGreaterThan(0);
      expect(typeof entry.url).toBe('string');
      expect(entry.url.length).toBeGreaterThan(0);
      expect(typeof entry.ref).toBe('string');
      expect(entry.ref.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe('bundled registry — slug-miss behavior with seed catalog', () => {
  it('returns near-match suggestion for a typo of an existing slug', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    const result = resolveRegistrySlug(
      'code-review-companin', // missing 'o' — Levenshtein distance 1
      catalog,
    );
    expect(result.entry).toBeNull();
    expect(result.suggestions).toContain('code-review-companion');
  });

  it('returns no suggestions for completely unrelated slug', () => {
    const catalog = readRegistryCatalog(SOURCE_REGISTRY_PATH);
    const result = resolveRegistrySlug('zzzzzzzzzzzzzz', catalog);
    expect(result.entry).toBeNull();
    expect(result.suggestions.length).toBe(0);
  });
});
