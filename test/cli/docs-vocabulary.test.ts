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

// Plan 026 (AC-10) — the three budget terminalReason values must stay
// documented on every surface operators and host agents read.
describe('run-budget vocabulary (plan 026)', () => {
  const REASONS = ['timeout', 'stalled-stream', 'max-turns'] as const;

  it('README documents the budget flags, every reason, 0-semantics, and the tool-silence limitation', () => {
    const doc = read('README.md');
    expect(doc).toContain('--stall-timeout');
    expect(doc).toContain('--max-turns');
    for (const reason of REASONS) {
      expect(doc).toContain(reason);
    }
    expect(doc).toContain('`0` disables');
    expect(doc).toContain('tool silence');
    expect(doc).toContain('Windows');
  });

  it('run-liveness.md carries all six terminalReason values', () => {
    const doc = read('docs/how/run-liveness.md');
    for (const reason of [
      'permission-denied',
      'provider-stream-aborted',
      'pid-vanished',
      ...REASONS,
    ]) {
      expect(doc).toContain(reason);
    }
  });

  it('CHANGELOG covers the watchdog, the budget reasons, and the stricter flag validation', () => {
    const doc = read('CHANGELOG.md');
    expect(doc).toContain('stalled-stream');
    expect(doc).toContain('max-turns');
    expect(doc).toContain('E108');
  });

  it('AGENTS_README explains terminalReason budget values for polling hosts', () => {
    const doc = read('AGENTS_README.md');
    expect(doc).toContain('stalled-stream');
    expect(doc).toContain('--stall-timeout');
    expect(doc).toContain('max-turns');
  });
});
