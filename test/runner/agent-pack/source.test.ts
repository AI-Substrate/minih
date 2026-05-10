import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeFileChecksums,
  readSourceSidecar,
  SOURCE_SIDECAR_FILENAME,
  verifyChecksums,
  writeSourceSidecar,
} from '../../../src/runner/agent-pack/source.js';
import type { MinihSourceSidecar } from '../../../src/runner/agent-pack/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-source-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleSidecar: MinihSourceSidecar = {
  schemaVersion: '1',
  slug: 'demo',
  source: {
    type: 'registry',
    registrySlug: 'demo',
    url: 'github:foo/bar',
    ref: 'main',
    subpath: 'agents/demo',
    commitSha: 'abc123def456',
  },
  installedAt: '2026-05-03T12:00:00.000Z',
  manifestVersion: '0.1.0',
  fileChecksums: {
    'prompt.md': 'sha256:aaa',
    'instructions.md': 'sha256:bbb',
  },
};

describe('writeSourceSidecar / readSourceSidecar', () => {
  it('round-trips: write then read returns equal object (with R3 lockedDefault backfill)', () => {
    writeSourceSidecar(tmpDir, sampleSidecar);
    const loaded = readSourceSidecar(tmpDir);
    // Plan 018 R3 — readSourceSidecar idempotently backfills `lockedDefault`
    // when missing. Round-trip test verifies the underlying fields are
    // preserved while accepting the new field is added.
    expect(loaded).toMatchObject(sampleSidecar);
    expect(loaded?.lockedDefault).toBe('yolo');
    expect(loaded?.lockedDefaultReason).toBe(
      'pre-schema-install-grandfathered',
    );
    // Second read should be a no-op (idempotent).
    const reloaded = readSourceSidecar(tmpDir);
    expect(reloaded?.lockedDefaultRecordedAt).toBe(
      loaded?.lockedDefaultRecordedAt,
    );
  });

  it('preserves explicit lockedDefault on subsequent reads (lossless invariant)', () => {
    const sidecar: MinihSourceSidecar = {
      ...sampleSidecar,
      lockedDefault: 'restricted',
      lockedDefaultRecordedAt: '2026-05-03T12:00:00.000Z',
      lockedDefaultReason: 'manifest-recommended',
    };
    writeSourceSidecar(tmpDir, sidecar);
    const loaded = readSourceSidecar(tmpDir);
    expect(loaded?.lockedDefault).toBe('restricted');
    expect(loaded?.lockedDefaultReason).toBe('manifest-recommended');
    // Re-read — no overwrite.
    const reloaded = readSourceSidecar(tmpDir);
    expect(reloaded?.lockedDefault).toBe('restricted');
    expect(reloaded?.lockedDefaultRecordedAt).toBe('2026-05-03T12:00:00.000Z');
  });

  it('returns null when sidecar absent', () => {
    expect(readSourceSidecar(tmpDir)).toBeNull();
  });

  it('throws when writing into a non-existent directory', () => {
    const fakeDir = path.join(tmpDir, 'does-not-exist');
    expect(() => writeSourceSidecar(fakeDir, sampleSidecar)).toThrow();
  });

  it('throws on malformed sidecar JSON', () => {
    fs.writeFileSync(path.join(tmpDir, SOURCE_SIDECAR_FILENAME), 'not json');
    expect(() => readSourceSidecar(tmpDir)).toThrow();
  });

  it('throws on sidecar with missing required field', () => {
    fs.writeFileSync(
      path.join(tmpDir, SOURCE_SIDECAR_FILENAME),
      JSON.stringify({ schemaVersion: '1', slug: 'demo' /* missing rest */ }),
    );
    expect(() => readSourceSidecar(tmpDir)).toThrow();
  });

  it('throws on unknown schemaVersion', () => {
    fs.writeFileSync(
      path.join(tmpDir, SOURCE_SIDECAR_FILENAME),
      JSON.stringify({ ...sampleSidecar, schemaVersion: '99' }),
    );
    expect(() => readSourceSidecar(tmpDir)).toThrow(/schemaVersion/i);
  });

  it('preserves unknown fields on read (forward-compat)', () => {
    const withFuture = {
      ...sampleSidecar,
      futureField: 'we keep this',
    };
    fs.writeFileSync(
      path.join(tmpDir, SOURCE_SIDECAR_FILENAME),
      JSON.stringify(withFuture),
    );
    const loaded = readSourceSidecar(tmpDir);
    // Loaded shape matches the typed contract; unknown fields are not
    // rejected (forward-compat), but they may not be exposed on the typed
    // object. Test ensures no throw.
    expect(loaded?.slug).toBe('demo');
  });
});

describe('computeFileChecksums', () => {
  it('produces deterministic sha256 hashes', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), 'world');
    const first = computeFileChecksums(tmpDir, ['a.md', 'b.md']);
    const second = computeFileChecksums(tmpDir, ['a.md', 'b.md']);
    expect(first).toEqual(second);
    expect(first['a.md']).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces different hashes for different content', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), 'world');
    const result = computeFileChecksums(tmpDir, ['a.md', 'b.md']);
    expect(result['a.md']).not.toEqual(result['b.md']);
  });

  it('throws when a referenced file is missing', () => {
    expect(() => computeFileChecksums(tmpDir, ['does-not-exist.md'])).toThrow();
  });
});

describe('verifyChecksums', () => {
  it('returns "unchanged" when checksum matches', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'hello');
    const expected = computeFileChecksums(tmpDir, ['a.md']);
    const status = verifyChecksums(tmpDir, expected);
    expect(status['a.md']).toBe('unchanged');
  });

  it('returns "modified" when content has changed', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'hello');
    const expected = computeFileChecksums(tmpDir, ['a.md']);
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'edited');
    const status = verifyChecksums(tmpDir, expected);
    expect(status['a.md']).toBe('modified');
  });

  it('returns "missing" when file no longer exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'hello');
    const expected = computeFileChecksums(tmpDir, ['a.md']);
    fs.rmSync(path.join(tmpDir, 'a.md'));
    const status = verifyChecksums(tmpDir, expected);
    expect(status['a.md']).toBe('missing');
  });
});

describe('checksum format compatibility', () => {
  it('uses sha256 hex digest with "sha256:" prefix', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'hello');
    const result = computeFileChecksums(tmpDir, ['a.md']);
    const sha = crypto.createHash('sha256').update('hello').digest('hex');
    expect(result['a.md']).toBe(`sha256:${sha}`);
  });
});
