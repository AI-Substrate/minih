import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listRegistryAgents,
  readRegistryCatalog,
  resolveRegistrySlug,
} from '../../../src/runner/agent-pack/registry.js';
import type {
  RegistryCatalog,
  RegistryEntry,
} from '../../../src/runner/agent-pack/types.js';

let tmpDir: string;
let catalogPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-registry-test-'));
  catalogPath = path.join(tmpDir, 'agents-registry.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const oneEntry: RegistryEntry = {
  slug: 'code-review-companion',
  url: 'github:AI-Substrate/minih',
  ref: 'main',
  subpath: 'agents/code-review-companion',
  description: 'Power-On-Mode companion that reviews each commit live',
  tags: ['companion', 'review', 'coordination'],
};

function writeCatalog(catalog: unknown): void {
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
}

describe('readRegistryCatalog', () => {
  it('reads a valid catalog', () => {
    const catalog: RegistryCatalog = { version: '1', agents: [oneEntry] };
    writeCatalog(catalog);
    const result = readRegistryCatalog(catalogPath);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.slug).toBe('code-review-companion');
  });

  it('returns empty catalog when file is missing', () => {
    const result = readRegistryCatalog(
      path.join(tmpDir, 'does-not-exist.json'),
    );
    expect(result.version).toBe('1');
    expect(result.agents).toEqual([]);
  });

  it('throws on unknown catalog version', () => {
    writeCatalog({ version: '99', agents: [] });
    expect(() => readRegistryCatalog(catalogPath)).toThrow(/version/i);
  });

  it('throws on malformed catalog JSON', () => {
    fs.writeFileSync(catalogPath, 'not json');
    expect(() => readRegistryCatalog(catalogPath)).toThrow();
  });

  it('throws when entry is missing required fields', () => {
    writeCatalog({
      version: '1',
      agents: [{ slug: 'x' /* missing url/ref/description */ }],
    });
    expect(() => readRegistryCatalog(catalogPath)).toThrow();
  });

  it('tolerates unknown fields on entries (forward-compat)', () => {
    writeCatalog({
      version: '1',
      agents: [
        {
          ...oneEntry,
          futureField: 'whatever',
        },
      ],
    });
    expect(() => readRegistryCatalog(catalogPath)).not.toThrow();
  });
});

describe('resolveRegistrySlug', () => {
  const catalog: RegistryCatalog = {
    version: '1',
    agents: [
      oneEntry,
      {
        slug: 'feedback-digest',
        url: 'github:AI-Substrate/minih',
        ref: 'main',
        subpath: 'agents/feedback-digest',
        description: 'Aggregates retros across runs',
      },
    ],
  };

  it('returns the entry on slug hit', () => {
    const result = resolveRegistrySlug('code-review-companion', catalog);
    expect(result.entry?.slug).toBe('code-review-companion');
    expect(result.suggestions).toEqual([]);
  });

  it('returns null entry + suggestions on miss with near match (Levenshtein ≤ 2)', () => {
    const result = resolveRegistrySlug('code-review-companon', catalog);
    expect(result.entry).toBeNull();
    expect(result.suggestions).toContain('code-review-companion');
  });

  it('returns null entry + empty suggestions on miss with no near match', () => {
    const result = resolveRegistrySlug('xyz-totally-unrelated-slug', catalog);
    expect(result.entry).toBeNull();
    expect(result.suggestions).toEqual([]);
  });

  it('caps suggestions at 3', () => {
    const bigCatalog: RegistryCatalog = {
      version: '1',
      agents: Array.from({ length: 10 }, (_, i) => ({
        slug: `near-match-${i}`,
        url: 'github:foo/bar',
        ref: 'main',
        description: `near match ${i}`,
      })),
    };
    const result = resolveRegistrySlug('near-match-99', bigCatalog);
    expect(result.entry).toBeNull();
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe('listRegistryAgents', () => {
  it('returns all catalog entries sorted by slug', () => {
    const catalog: RegistryCatalog = {
      version: '1',
      agents: [
        { ...oneEntry, slug: 'zebra' },
        { ...oneEntry, slug: 'alpha' },
        { ...oneEntry, slug: 'middle' },
      ],
    };
    const result = listRegistryAgents(catalog);
    expect(result.map((e) => e.slug)).toEqual(['alpha', 'middle', 'zebra']);
  });
});
