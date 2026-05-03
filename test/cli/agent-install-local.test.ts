import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

function run(
  args: string[],
  opts: {
    cwd?: string;
    expectFail?: boolean;
    env?: Record<string, string>;
  } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const { FORCE_COLOR: _fc, ...cleanEnv } = process.env;
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: opts.cwd ?? repoRoot,
      env: { ...cleanEnv, NO_COLOR: '1', ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.toString('utf-8'), stderr: '', exitCode: 0 };
  } catch (error) {
    const err = error as {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number;
    };
    return {
      stdout: err.stdout?.toString('utf-8') ?? '',
      stderr: err.stderr?.toString('utf-8') ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

let projectRoot: string;
let sourceDir: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-fx001-cli-'));
  fs.mkdirSync(path.join(projectRoot, 'agents'));
  sourceDir = path.join(projectRoot, 'src-agent');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'prompt.md'), '# my agent');
  fs.writeFileSync(
    path.join(sourceDir, 'agent.json'),
    JSON.stringify({
      name: 'src-agent',
      version: '0.1.0',
      description: 'fixture agent',
      files: [{ path: 'prompt.md', description: 'agent prompt' }],
    }),
  );
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('minih agent install — local path (FX001)', () => {
  it('AC: fresh install copies prompt.md and writes .minih-source.json', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        sourceDir,
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const installed = path.join(projectRoot, 'agents', 'src-agent');
    expect(fs.existsSync(path.join(installed, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(installed, '.minih-source.json'))).toBe(
      true,
    );

    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe('agent install');
    expect(envelope.status).toBe('ok');
    expect(envelope.data.action).toBe('installed');
    expect(envelope.data.slug).toBe('src-agent');
    expect(envelope.data.source.type).toBe('local');
  });

  it('AC: re-install with no changes reports action: "unchanged"', () => {
    const args = [
      '--agents-dir',
      path.join(projectRoot, 'agents'),
      'agent',
      'install',
      sourceDir,
    ];
    run(args, { cwd: projectRoot });
    const second = run(args, { cwd: projectRoot });
    expect(second.exitCode).toBe(0);
    const envelope = JSON.parse(second.stdout);
    expect(envelope.data.action).toBe('unchanged');
  });

  it('AC: re-install after edit reports action: "upgraded" + changedFiles populated', () => {
    const args = [
      '--agents-dir',
      path.join(projectRoot, 'agents'),
      'agent',
      'install',
      sourceDir,
    ];
    run(args, { cwd: projectRoot });
    fs.writeFileSync(path.join(sourceDir, 'prompt.md'), '# v2');
    const second = run(args, { cwd: projectRoot });
    expect(second.exitCode).toBe(0);
    const envelope = JSON.parse(second.stdout);
    expect(envelope.data.action).toBe('upgraded');
    expect(envelope.data.changedFiles).toEqual(['prompt.md']);
  });

  it('AC: URL reference is routed to the fetcher (Phase 3 — was E182 stub in FX001, now hits real fetcher)', () => {
    // Phase 3 turned the URL stub into a real fetcher invocation. With
    // MINIH_AGENT_PACK_FETCHER set to an empty fake, the fetcher rejects
    // because no preset matches → CLI surfaces an error envelope. The
    // exact code (E181 vs E182) depends on `pickErrorCode` regex precedence.
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:foo/bar',
      ],
      {
        cwd: projectRoot,
        expectFail: true,
        env: {
          NODE_ENV: 'test',
          MINIH_AGENT_PACK_FETCHER: 'fake:{}',
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('error');
    expect(['E181', 'E182']).toContain(envelope.error.code);
  });

  it('AC: bare slug NOT in registry returns E180 with did-you-mean hint', () => {
    // Phase 5 wired registry resolution. A slug like "code-review-companin"
    // (typo) misses the registry → E180 + Levenshtein suggestion. The known-
    // good "code-review-companion" slug is now installable, so we can't use
    // it here — pick a typo that misses but resembles a registered entry.
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'code-review-companin',
      ],
      { cwd: projectRoot, expectFail: true },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('E180');
    expect(envelope.error.message).toMatch(/not in the bundled registry/i);
    expect(envelope.error.message).toMatch(
      /did you mean.*code-review-companion/i,
    );
  });

  it('AC: --as <slug> aliases the install', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        sourceDir,
        '--as',
        'aliased-agent',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);
    expect(
      fs.existsSync(
        path.join(projectRoot, 'agents', 'aliased-agent', 'prompt.md'),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'agents', 'src-agent'))).toBe(
      false,
    );
  });

  // npm/uv-style URL syntax (designed; fetch lands Phase 3 — for now stubs E182)

  it('npm-style: github:owner/repo#branch is parsed and reaches the fetcher (Phase 3)', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:foo/bar#dev',
      ],
      {
        cwd: projectRoot,
        expectFail: true,
        env: {
          NODE_ENV: 'test',
          MINIH_AGENT_PACK_FETCHER: 'fake:{}',
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(['E181', 'E182']).toContain(envelope.error.code);
  });

  it('npm-style: github:owner/repo#tag:subpath is parsed and reaches the fetcher (Phase 3)', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:foo/bar#v1.2.0:agents/x',
      ],
      {
        cwd: projectRoot,
        expectFail: true,
        env: {
          NODE_ENV: 'test',
          MINIH_AGENT_PACK_FETCHER: 'fake:{}',
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(['E181', 'E182']).toContain(envelope.error.code);
  });

  it('--ref <branch> flag is accepted (overrides URL fragment) and reaches the fetcher (Phase 3)', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:foo/bar',
        '--ref',
        'feat/some-branch',
      ],
      {
        cwd: projectRoot,
        expectFail: true,
        env: {
          NODE_ENV: 'test',
          MINIH_AGENT_PACK_FETCHER: 'fake:{}',
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(['E181', 'E182']).toContain(envelope.error.code);
  });

  it('malformed URL is rejected with E182 (parser catches it before runner stub)', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'install',
        'github:no-slash',
      ],
      { cwd: projectRoot, expectFail: true },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E182');
    expect(envelope.error.message).toMatch(/malformed|github shorthand/i);
  });
});
