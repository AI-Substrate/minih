/**
 * T009b: Self-install regression for the registry-resolution path.
 *
 * Spec AC11: "Running `minih agent install code-review-companion` from
 * inside the minih source repo (where `agents/code-review-companion/`
 * already exists as the canonical source) refuses with an instructive
 * error suggesting `--as <new-slug>`."
 *
 * Phase 5 wired registry resolution. This test guards that the protection
 * still fires when the registry → URL fetch → install path runs in a
 * project where `agents/<slug>/` already exists hand-rolled (no sidecar).
 *
 * Mechanism: existing collision detection (E183: AGENT_PACK_ALREADY_INSTALLED)
 * fires when target dir exists without `.minih-source.json`. The CLI's
 * error message hints at `--as <new-slug>` (per FX001).
 *
 * Uses MINIH_AGENT_PACK_FETCHER fake injection so no real GitHub call
 * happens. Fixture tarball mirrors the real `code-review-companion/`
 * structure but with a different commit sha so we don't depend on real
 * upstream content.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { Pack } from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

function run(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
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

async function makeGithubTarball(opts: {
  repoPrefix: string;
  files: Array<{ path: string; body: string }>;
}): Promise<Buffer> {
  const stagingRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'minih-cli-fixture-'),
  );
  try {
    const stageDir = path.join(stagingRoot, opts.repoPrefix);
    fs.mkdirSync(stageDir, { recursive: true });
    const filesArg: string[] = [];
    for (const f of opts.files) {
      const abs = path.join(stageDir, f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.body);
      filesArg.push(`${opts.repoPrefix}/${f.path}`);
    }
    const pack = new Pack({ cwd: stagingRoot, portable: true });
    for (const f of filesArg) pack.write(f);
    pack.end();
    const chunks: Buffer[] = [];
    for await (const chunk of pack) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return zlib.gzipSync(Buffer.concat(chunks));
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function fakeEnv(
  presets: Array<{
    url: string;
    ref: string;
    commitSha: string;
    tarball: Buffer;
  }>,
): string {
  const obj: Record<string, { commitSha: string; tarballBase64: string }> = {};
  for (const p of presets) {
    obj[`${p.url}\u0001${p.ref}`] = {
      commitSha: p.commitSha,
      tarballBase64: p.tarball.toString('base64'),
    };
  }
  return `fake:${JSON.stringify(obj)}`;
}

let projectRoot: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'minih-self-protect-'),
  );
  fs.mkdirSync(path.join(projectRoot, 'agents'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('agent install code-review-companion — self-install protection (T009b, Spec AC11)', () => {
  it('refuses with E183 when target slug already exists hand-rolled', async () => {
    // Simulate the in-repo state: `agents/code-review-companion/` already
    // exists with prompt.md + agent.json BUT no `.minih-source.json` —
    // exactly the canonical-source state inside the minih repo.
    const targetDir = path.join(projectRoot, 'agents', 'code-review-companion');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'prompt.md'),
      '---\ndescription: existing\nmodel: gpt-5.5\n---\nlocal canonical content',
    );
    fs.writeFileSync(
      path.join(targetDir, 'agent.json'),
      JSON.stringify({
        name: 'code-review-companion',
        version: '0.1.0',
        description: 'existing',
        files: [{ path: 'prompt.md', description: 'p' }],
      }),
    );

    // Build a tarball that COULD install — but we expect collision detection
    // to fire BEFORE any fetch-based copy happens.
    const tarball = await makeGithubTarball({
      repoPrefix: 'AI-Substrate-minih-deadbee',
      files: [
        {
          path: 'agents/code-review-companion/agent.json',
          body: JSON.stringify({
            name: 'code-review-companion',
            version: '0.1.0',
            description: 'remote',
            files: [{ path: 'prompt.md', description: 'p' }],
          }),
        },
        {
          path: 'agents/code-review-companion/prompt.md',
          body: '---\ndescription: remote\nmodel: gpt-5.5\n---\nremote canonical content',
        },
      ],
    });

    const result = run(
      ['agent', 'install', 'code-review-companion'],
      {
        cwd: projectRoot,
        env: {
          NODE_ENV: 'test',
          MINIH_AGENT_PACK_FETCHER: fakeEnv([
            {
              url: 'github:AI-Substrate/minih',
              ref: 'main',
              commitSha: 'deadbee',
              tarball,
            },
          ]),
        },
      },
    );

    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('error');
    // E183 collision detection — protects the canonical source from being
    // overwritten when re-installing onto the in-repo location.
    expect(envelope.error.code).toBe('E183');
    // Self-install guard hint: --as <new-slug> is the safe escape hatch.
    expect(envelope.error.message).toMatch(/--as|--force/i);
  });

  it('succeeds with --as <new-slug> escape hatch', async () => {
    // Same setup as above — canonical exists hand-rolled at
    // agents/code-review-companion/ — but install with --as crc-test
    // installs at agents/crc-test/ instead, which is empty → E183 doesn't
    // fire and the install proceeds.
    const targetDir = path.join(projectRoot, 'agents', 'code-review-companion');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'prompt.md'),
      '---\ndescription: existing\nmodel: gpt-5.5\n---\nlocal canonical content',
    );

    const tarball = await makeGithubTarball({
      repoPrefix: 'AI-Substrate-minih-deadbee',
      files: [
        {
          path: 'agents/code-review-companion/agent.json',
          body: JSON.stringify({
            name: 'code-review-companion',
            version: '0.1.0',
            description: 'remote',
            files: [{ path: 'prompt.md', description: 'p' }],
          }),
        },
        {
          path: 'agents/code-review-companion/prompt.md',
          body: '---\ndescription: remote\nmodel: gpt-5.5\n---\nremote canonical content',
        },
      ],
    });

    const result = run(
      ['agent', 'install', 'code-review-companion', '--as', 'crc-test'],
      {
        cwd: projectRoot,
        env: {
          NODE_ENV: 'test',
          MINIH_AGENT_PACK_FETCHER: fakeEnv([
            {
              url: 'github:AI-Substrate/minih',
              ref: 'main',
              commitSha: 'deadbee',
              tarball,
            },
          ]),
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('ok');
    expect(envelope.data.action).toBe('installed');
    expect(envelope.data.slug).toBe('crc-test');
    expect(envelope.data.source.type).toBe('registry');
    expect(envelope.data.source.registrySlug).toBe('code-review-companion');
    // Original canonical source still exists, untouched.
    expect(
      fs.readFileSync(
        path.join(projectRoot, 'agents/code-review-companion/prompt.md'),
        'utf-8',
      ),
    ).toContain('local canonical content');
    // New install is at the aliased slug.
    expect(
      fs.existsSync(path.join(projectRoot, 'agents/crc-test/prompt.md')),
    ).toBe(true);
  });
});
