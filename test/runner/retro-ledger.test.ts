/**
 * T005 (Plan 011 HF-B) — TDD RED bar for retro-ledger.ts.
 *
 * Workshop 002 / Plan 011 § Implementation:
 *   - `appendRetroEntry({slug, runId, runDir, retrospective, planId?, ledgerDir})`
 *   - `appendRetroStub({slug, runId, runDir, result, stderrTail, planId?, ledgerDir})`
 *   - Per-agent ledger always; per-plan ledger when planId is provided
 *   - Idempotent (no duplicate runId entries)
 *   - Atomic-append via writeFileAtomicAsync
 *   - Retry-on-conflict loop (best-effort under concurrent same-slug writers)
 *   - Stub entries use `> ⚠️` blockquote prefix
 *   - Throws RetroLedgerError on unwritable target (runner does the silencing)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendRetroEntry,
  appendRetroStub,
  type RetroLedgerError,
} from '../../src/runner/retro-ledger.js';

let ledgerDir: string;

function read(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

const fakeRetro = {
  summary: 'Did the thing.',
  magicWand: 'A faster type checker',
  magicWandTarget: 'project' as const,
  difficulties: [
    {
      category: 'tooling',
      description: 'tsc was slow on this repo',
      workaround: 'used --incremental',
      severity: 'minor',
    },
  ],
};

beforeEach(() => {
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-ledger-'));
});

afterEach(() => {
  if (ledgerDir && fs.existsSync(ledgerDir)) {
    fs.rmSync(ledgerDir, { recursive: true, force: true });
  }
});

describe('appendRetroEntry — per-agent ledger', () => {
  it('creates docs/retros/<slug>.md with a canonical entry', async () => {
    await appendRetroEntry({
      slug: 'demo',
      runId: '2026-04-29T01-02-03-456Z-abcd',
      runDir: '/tmp/fake/run',
      retrospective: fakeRetro,
      ledgerDir,
    });

    const file = path.join(ledgerDir, 'demo.md');
    expect(fs.existsSync(file)).toBe(true);
    const content = read(file);
    expect(content).toContain('runId: 2026-04-29T01-02-03-456Z-abcd');
    expect(content).toContain('A faster type checker');
    expect(content).toContain('demo');
  });

  it('is idempotent — re-appending the same runId is a no-op', async () => {
    const args = {
      slug: 'demo',
      runId: '2026-04-29T01-02-03-456Z-abcd',
      runDir: '/tmp/fake/run',
      retrospective: fakeRetro,
      ledgerDir,
    };
    await appendRetroEntry(args);
    const after1 = read(path.join(ledgerDir, 'demo.md'));
    await appendRetroEntry(args);
    const after2 = read(path.join(ledgerDir, 'demo.md'));
    expect(after2).toBe(after1);
  });

  it('appends multiple distinct runIds chronologically', async () => {
    await appendRetroEntry({
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      retrospective: { ...fakeRetro, magicWand: 'first wand' },
      ledgerDir,
    });
    await appendRetroEntry({
      slug: 'demo',
      runId: 'run-2',
      runDir: '/tmp/r2',
      retrospective: { ...fakeRetro, magicWand: 'second wand' },
      ledgerDir,
    });
    const content = read(path.join(ledgerDir, 'demo.md'));
    expect(content.indexOf('first wand')).toBeLessThan(
      content.indexOf('second wand'),
    );
    expect(content).toContain('run-1');
    expect(content).toContain('run-2');
  });

  it('creates the ledger directory if it does not exist', async () => {
    const nested = path.join(ledgerDir, 'nested', 'retros');
    expect(fs.existsSync(nested)).toBe(false);
    await appendRetroEntry({
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      retrospective: fakeRetro,
      ledgerDir: nested,
    });
    expect(fs.existsSync(path.join(nested, 'demo.md'))).toBe(true);
  });
});

describe('appendRetroEntry — per-plan dual-write', () => {
  it('writes to both <slug>.md and <plan-id>.md when planId provided', async () => {
    await appendRetroEntry({
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      retrospective: fakeRetro,
      planId: '011-retro-harvest-loop',
      ledgerDir,
    });
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(ledgerDir, '011-retro-harvest-loop.md')),
    ).toBe(true);
    const slugContent = read(path.join(ledgerDir, 'demo.md'));
    const planContent = read(path.join(ledgerDir, '011-retro-harvest-loop.md'));
    expect(slugContent).toContain('run-1');
    expect(planContent).toContain('run-1');
  });

  it('does not write per-plan file when planId is omitted', async () => {
    await appendRetroEntry({
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      retrospective: fakeRetro,
      ledgerDir,
    });
    const entries = fs.readdirSync(ledgerDir);
    expect(entries).toContain('demo.md');
    expect(entries.filter((f) => f.endsWith('.md'))).toHaveLength(1);
  });

  it('idempotent across both files when planId set', async () => {
    const args = {
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      retrospective: fakeRetro,
      planId: '011-retro-harvest-loop',
      ledgerDir,
    };
    await appendRetroEntry(args);
    await appendRetroEntry(args);
    const slug = read(path.join(ledgerDir, 'demo.md'));
    const plan = read(path.join(ledgerDir, '011-retro-harvest-loop.md'));
    const slugMatches = slug.match(/runId: run-1/g) ?? [];
    const planMatches = plan.match(/runId: run-1/g) ?? [];
    expect(slugMatches).toHaveLength(1);
    expect(planMatches).toHaveLength(1);
  });
});

describe('appendRetroStub — terminal-failure stubs', () => {
  it('writes a `> ⚠️` blockquote-prefixed stub for failed runs', async () => {
    await appendRetroStub({
      slug: 'demo',
      runId: 'run-fail-1',
      runDir: '/tmp/runs/run-fail-1',
      result: 'failed',
      stderrTail: 'Error: schema validation failed at field foo',
      ledgerDir,
    });
    const content = read(path.join(ledgerDir, 'demo.md'));
    expect(content).toContain('> ⚠️');
    expect(content).toContain('run-fail-1');
    expect(content).toContain('failed');
    expect(content).toContain('/tmp/runs/run-fail-1');
    expect(content).toContain('schema validation failed');
  });

  it('handles all three result types (timeout / failed / crashed)', async () => {
    for (const result of ['timeout', 'failed', 'crashed'] as const) {
      await appendRetroStub({
        slug: result,
        runId: `run-${result}`,
        runDir: `/tmp/${result}`,
        result,
        stderrTail: `${result} happened`,
        ledgerDir,
      });
      const content = read(path.join(ledgerDir, `${result}.md`));
      expect(content).toContain('> ⚠️');
      expect(content).toContain(result);
    }
  });

  it('is idempotent — re-stubbing same runId is a no-op', async () => {
    const args = {
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      result: 'timeout' as const,
      stderrTail: 'time up',
      ledgerDir,
    };
    await appendRetroStub(args);
    await appendRetroStub(args);
    const content = read(path.join(ledgerDir, 'demo.md'));
    const matches = content.match(/runId: run-1/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('dual-writes per-plan when planId provided', async () => {
    await appendRetroStub({
      slug: 'demo',
      runId: 'run-fail-1',
      runDir: '/tmp/r1',
      result: 'failed',
      stderrTail: 'oops',
      planId: 'plan-011',
      ledgerDir,
    });
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(true);
    expect(fs.existsSync(path.join(ledgerDir, 'plan-011.md'))).toBe(true);
  });

  it('handles missing/empty stderr tail gracefully', async () => {
    await appendRetroStub({
      slug: 'demo',
      runId: 'run-1',
      runDir: '/tmp/r1',
      result: 'crashed',
      stderrTail: '',
      ledgerDir,
    });
    const content = read(path.join(ledgerDir, 'demo.md'));
    expect(content).toContain('run-1');
    expect(content).toContain('crashed');
  });
});

describe('error handling', () => {
  it('throws RetroLedgerError when ledgerDir is unwritable', async () => {
    // Make a file that blocks the ledgerDir path
    const blocked = path.join(ledgerDir, 'blocked');
    fs.writeFileSync(blocked, '');
    let caught: unknown = null;
    try {
      await appendRetroEntry({
        slug: 'demo',
        runId: 'r',
        runDir: '/tmp/r',
        retrospective: fakeRetro,
        // ledgerDir is a regular file path, not a directory — mkdir will fail
        ledgerDir: path.join(blocked, 'subdir'),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const err = caught as RetroLedgerError;
    expect(err.name).toBe('RetroLedgerError');
  });
});

describe('retry-on-conflict (best-effort concurrent writers)', () => {
  it('handles two parallel append calls for the same slug without torn output', async () => {
    const args1 = {
      slug: 'demo',
      runId: 'run-A',
      runDir: '/tmp/A',
      retrospective: { ...fakeRetro, magicWand: 'wand A' },
      ledgerDir,
    };
    const args2 = {
      slug: 'demo',
      runId: 'run-B',
      runDir: '/tmp/B',
      retrospective: { ...fakeRetro, magicWand: 'wand B' },
      ledgerDir,
    };
    await Promise.all([appendRetroEntry(args1), appendRetroEntry(args2)]);
    const content = read(path.join(ledgerDir, 'demo.md'));
    // Both entries must be present — the retry-on-conflict loop guarantees at
    // least one re-read happens before the loser commits.
    expect(content).toContain('run-A');
    expect(content).toContain('run-B');
    // Idempotency check guards against duplicate writes.
    expect((content.match(/runId: run-A/g) ?? []).length).toBe(1);
    expect((content.match(/runId: run-B/g) ?? []).length).toBe(1);
  });
});
