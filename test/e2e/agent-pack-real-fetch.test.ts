/**
 * E2E real-fetch test for `minih agent install` (Phase 3 / T009).
 *
 * Gated by `MINIH_E2E=1`. Without the env flag the suite is skipped, so
 * the default `npm test` makes ZERO real GitHub calls.
 *
 * When enabled, this test installs `agents/code-review-companion` from
 * the live `AI-Substrate/minih@main` repo into a fresh tmp project and
 * verifies the result on disk.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const runE2e = process.env.MINIH_E2E === '1';
const describeE2e = runE2e ? describe : describe.skip;
const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

function run(
  args: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
  } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const { FORCE_COLOR: _fc, ...cleanEnv } = process.env;
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: opts.cwd ?? repoRoot,
    env: { ...cleanEnv, NO_COLOR: '1', ...(opts.env ?? {}) },
    encoding: 'utf-8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

let projectRoot: string;

beforeEach(() => {
  if (!runE2e) return;
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `dist/cli/index.js not found — run \`npm run build\` before MINIH_E2E=1 tests`,
    );
  }
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-e2e-fetch-'));
  fs.mkdirSync(path.join(projectRoot, 'agents'));
});

afterEach(() => {
  if (!runE2e) return;
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describeE2e('agent install — real GitHub fetch (T009)', () => {
  it('installs agents/code-review from AI-Substrate/minih@main', () => {
    // NOTE: switched from `code-review-companion` to `code-review` because
    // the companion variant only exists on the `007-backgrounding` branch
    // (Phase 5 of plan-017 will land it on main alongside its agent.json).
    // `code-review` is a stable, well-known agent on main and exercises
    // the same fetch+extract+install pipeline.
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:AI-Substrate/minih#main:agents/code-review',
        '--yes',
      ],
      { cwd: projectRoot },
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('ok');
    expect(envelope.data.action).toMatch(/installed|unchanged|upgraded/);
    expect(envelope.data.slug).toBe('code-review');
    expect(envelope.data.source.type).toBe('url');
    expect(envelope.data.source.url).toBe('github:AI-Substrate/minih');
    expect(envelope.data.source.ref).toBe('main');
    expect(envelope.data.source.subpath).toBe('agents/code-review');
    expect(envelope.data.source.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const installRoot = path.join(projectRoot, 'agents', 'code-review');
    expect(fs.existsSync(path.join(installRoot, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(installRoot, '.minih-source.json'))).toBe(
      true,
    );
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(installRoot, '.minih-source.json'), 'utf-8'),
    );
    expect(sidecar.schemaVersion).toBe('1');
    expect(sidecar.source.type).toBe('url');
    expect(sidecar.source.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns E181 when the URL refers to a non-existent repo', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:AI-Substrate/this-repo-definitely-does-not-exist-99999#main',
        '--yes',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('E181');
  });

  // ==========================================================================
  // T008: Phase 5 headline scenario — registry slug install end-to-end.
  //
  // Pre-merge state: `agents/code-review-companion/agent.json` does NOT
  // yet exist on `main` (this Phase 5 PR is what lands it). Two modes:
  //
  //   (A) MINIH_E2E_PREMERGE=1 → run a URL-form e2e against the dev branch
  //       (`007-backgrounding`) where the manifest is staged. This proves
  //       the manifest works against real GitHub even before merge.
  //
  //   (B) Default (post-merge) → use the registry slug directly. The
  //       bundled `dist/templates/agents-registry.json` resolves
  //       `code-review-companion` → `github:AI-Substrate/minih#main:
  //       agents/code-review-companion` and the install fetches against
  //       `main`.
  //
  // Both modes assert: AC1 (install <5s soft, <10s hard), envelope shape,
  // sidecar contents, all 4 manifest-listed files copied. T011 registers
  // the post-merge follow-up to drop MINIH_E2E_PREMERGE once main has
  // the manifest.
  // ==========================================================================
  it('Phase 5 headline (T008): installs code-review-companion via registry slug', () => {
    const preMerge = process.env.MINIH_E2E_PREMERGE === '1';
    const t0 = Date.now();

    const result = preMerge
      ? run(
          [
            '--agents-dir',
            path.join(projectRoot, 'agents'),
            'agent',
            'install',
            'github:AI-Substrate/minih#007-backgrounding:agents/code-review-companion',
            '--yes',
          ],
          { cwd: projectRoot },
        )
      : run(
          [
            '--agents-dir',
            path.join(projectRoot, 'agents'),
            'agent',
            'install',
            'code-review-companion',
            '--yes',
          ],
          { cwd: projectRoot },
        );

    const elapsed = Date.now() - t0;

    if (preMerge) {
      // eslint-disable-next-line no-console
      console.warn(
        '[T008 pre-merge] using MINIH_E2E_PREMERGE=1 → URL-form against 007-backgrounding. After merge, drop env to validate slug-form against main (T011 follow-up).',
      );
    }

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('ok');
    expect(envelope.data.action).toMatch(/installed|unchanged|upgraded/);

    if (preMerge) {
      expect(envelope.data.source.type).toBe('url');
      expect(envelope.data.source.subpath).toBe('agents/code-review-companion');
    } else {
      expect(envelope.data.source.type).toBe('registry');
      expect(envelope.data.source.registrySlug).toBe('code-review-companion');
    }

    // The slug derives from the registry/subpath either way.
    expect(envelope.data.slug).toBe('code-review-companion');
    expect(envelope.data.source.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // All 4 manifest-listed files (plus agent.json itself) must be on disk.
    const installRoot = path.join(
      projectRoot,
      'agents',
      'code-review-companion',
    );
    for (const f of [
      'prompt.md',
      'instructions.md',
      'input-schema.json',
      'output-schema.json',
      'agent.json',
      '.minih-source.json',
    ]) {
      expect(
        fs.existsSync(path.join(installRoot, f)),
        `expected ${f} in install root`,
      ).toBe(true);
    }

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(installRoot, '.minih-source.json'), 'utf-8'),
    );
    expect(sidecar.schemaVersion).toBe('1');
    expect(sidecar.manifestVersion).toBe('0.1.0');

    // Spec AC1 timing budget: <5s ideal, <10s hard cap. We only HARD FAIL
    // above 10s (network jitter is real); 5-10s logs a soft warning.
    if (elapsed > 5000 && elapsed <= 10000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[T008] install elapsed ${elapsed}ms — exceeds spec AC1 5s soft budget but within 10s hard cap`,
      );
    }
    expect(elapsed).toBeLessThanOrEqual(10000);
  });

  it('Phase 5 (T008 pre-merge guard): slug-based install against bare main returns E182 IFF manifest absent', () => {
    // Sanity check: distinguishes "main doesn't yet have agent.json" from
    // "broken install logic". We only run this when MINIH_E2E_PREMERGE=1
    // (the same env that triggers the URL-form fallback above) — its job
    // is to PROVE the slug-route still resolves to the right URL/ref but
    // the upstream tarball lacks the subpath.
    if (process.env.MINIH_E2E_PREMERGE !== '1') {
      // Post-merge: this guard is no longer relevant — main HAS the
      // manifest. Skip rather than fail.
      return;
    }
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'code-review-companion',
        '--yes',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('error');
    // Pre-merge expected failure: E182 (subpath not found in tarball) OR
    // E181 (fetch failed if main itself is unreachable) — both are
    // acceptable signals that the failure is in the data layer, not in
    // our install logic.
    expect(['E181', 'E182']).toContain(envelope.error.code);
    if (envelope.error.code === 'E182') {
      expect(envelope.error.message).toMatch(
        /subpath.*not found|registry slug/i,
      );
    }
  });
});
