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
});
