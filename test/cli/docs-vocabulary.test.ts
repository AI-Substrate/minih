/**
 * T014 (plan 025, AC-12) — dead-is-terminal vocabulary guard over the doc
 * surfaces that host agents copy their polling loops from. If any surface
 * loses the vocabulary (a rewrite drops the `dead` arm, the CHANGELOG
 * migration snippet vanishes, the bundled readme goes stale), this fails.
 *
 * Precedent: test/cli/doctor-state-vocabulary.test.ts (vocabulary drift
 * guards are cheap and catch exactly the regressions reviews miss).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');

function read(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
}

describe('dead-is-terminal vocabulary (plan 025 breaking change)', () => {
  it('AGENTS_README.md documents the dead verdict and treats it as terminal in polling loops', () => {
    const doc = read('AGENTS_README.md');
    expect(doc).toContain('**dead**');
    // The canonical polling loop must break on dead alongside completed/failed.
    expect(doc).toMatch(/completed\|failed\|dead\) break/);
    // The breaking change is called out with the migration pointer.
    expect(doc).toContain('Breaking change (plan 025)');
    expect(doc).toContain('docs/how/run-liveness.md');
  });

  it('AGENTS.md load-bearing filter note covers dead + reconcile', () => {
    const doc = read('AGENTS.md');
    expect(doc).toContain('verdict: "dead"');
    expect(doc).toContain('minih reconcile');
  });

  it('companion outside.md boot section covers the dead verdict', () => {
    const doc = read('agents/code-review-companion/outside.md');
    expect(doc).toContain("verdict: 'dead'");
    expect(doc).toContain('minih reconcile');
    // Doctor hard-caps outside.md at 8192 bytes; this file runs ~99% full.
    expect(
      fs.statSync(
        path.join(repoRoot, 'agents/code-review-companion/outside.md'),
      ).size,
    ).toBeLessThanOrEqual(8192);
  });

  it('CHANGELOG carries the breaking-change entry with the jq migration snippet', () => {
    const doc = read('CHANGELOG.md');
    expect(doc).toContain('BREAKING CHANGES');
    expect(doc).toMatch(/completed\|failed\|dead\) break/);
    expect(doc).toContain('E190 RECONCILE_IN_PROGRESS');
  });

  it('run-liveness.md exists with the peer-activity disambiguation and resolver asymmetry', () => {
    const doc = read('docs/how/run-liveness.md');
    expect(doc).toContain('peer-activity');
    expect(doc).toContain("peer.verdict: 'dead'");
    expect(doc).toContain('resolver stays mtime-only');
    expect(doc).toContain('pid-vanished');
  });

  it('README documents reconcile and the dead liveness row', () => {
    const doc = read('README.md');
    expect(doc).toContain('### `minih reconcile [slug]`');
    expect(doc).toContain('active/stale/dead');
  });

  it('the bundled dist/AGENTS_README.md is not stale (copy-schemas re-bundle)', () => {
    // `minih agent-readme` serves the dist copy; an edit without a rebuild
    // would ship stale polling guidance to every consuming project.
    expect(read('dist/AGENTS_README.md')).toBe(read('AGENTS_README.md'));
  });
});
