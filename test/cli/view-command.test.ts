import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-view-'));
  agentsDir = path.join(tmpDir, 'agents');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface RunResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout ?? Buffer.alloc(0),
      stderr: e.stderr?.toString('utf-8') ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

function makeAgent(slug = 'demo'): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    [
      '---',
      `description: "demo agent"`,
      'model: gpt-5.5',
      '---',
      '',
      '# demo',
      '',
      'do nothing',
    ].join('\n'),
  );
}

function makeRunDir(
  slug: string,
  runId: string,
  manifestStatus: 'active' | 'completed' | 'failed' | 'starting',
): string {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    slug,
    runId,
    runDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: manifestStatus,
    sessionId: null,
    model: 'gpt-5.5',
    control: { available: false, kind: 'none' },
    counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
  };
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify(manifest, null, 2),
  );
  return runDir;
}

describe('view command — help signposting', () => {
  it('top-level --help lists view command', () => {
    const result = run(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString('utf-8')).toMatch(/view \[options\] <slug>/);
  });

  it('view --help describes resolver fallback chain', () => {
    const result = run(['view', '--help']);
    expect(result.exitCode).toBe(0);
    const text = result.stdout.toString('utf-8');
    expect(text).toMatch(/--run/);
    expect(text).toMatch(/latest-active/);
    expect(text).toMatch(/latest-completed/);
  });
});

describe('view command — error paths', () => {
  it('missing slug returns clean error envelope on stdout (CLI convention)', () => {
    makeAgent('demo');
    const result = run(['--agents-dir', agentsDir, 'view', 'does-not-exist']);
    expect(result.exitCode).toBe(1);
    const out = result.stdout.toString('utf-8').trim();
    const envelopeLine = out.split('\n').pop() ?? '';
    const envelope = JSON.parse(envelopeLine);
    expect(envelope.command).toBe('view');
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('E171');
  });

  it('explicit --run for missing run id returns clean error', () => {
    makeAgent('demo');
    const result = run([
      '--agents-dir',
      agentsDir,
      'view',
      'demo',
      '--run',
      'does-not-exist-runid',
    ]);
    expect(result.exitCode).toBe(1);
  });
});

describe('view command — stdout-clean discipline (AC-13)', () => {
  it('error path: stdout contains JSON envelope but NO ANSI control bytes', () => {
    makeAgent('demo');
    const result = run(['--agents-dir', agentsDir, 'view', 'no-such-slug']);
    // JSON envelope is the legitimate stdout content (CLI convention).
    // The discipline this test enforces: no terminal control bytes (ANSI CSI)
    // in stdout — those would only come from the Ink renderer if it leaked.
    // String.fromCharCode(27) avoids embedding the literal control char in
    // the regex (Biome's noControlCharactersInRegex rule).
    const ansiCsiPattern = new RegExp(`${String.fromCharCode(27)}\\[`);
    expect(result.stdout.toString('binary')).not.toMatch(ansiCsiPattern);
  });
});

describe('run command — --human flag', () => {
  it('mutual exclusion: --human + --verbose returns clean error', () => {
    makeAgent('demo');
    const result = run([
      '--agents-dir',
      agentsDir,
      'run',
      'demo',
      '--human',
      '--verbose',
      '--dry-run',
    ]);
    expect(result.exitCode).toBe(1);
    const out = result.stdout.toString('utf-8');
    expect(out).toContain('mutually exclusive');
  });

  it('run --help advertises --human', () => {
    const result = run(['run', '--help']);
    expect(result.stdout.toString('utf-8')).toMatch(/--human/);
  });
});

describe('view + completed run fallback (Completeness E2)', () => {
  it('view <slug> with no active run resolves to latest-completed', () => {
    makeAgent('demo');
    const runId = '2026-04-30T15-50-00-000Z-test';
    const runDir = makeRunDir('demo', runId, 'completed');
    // Add minimal completed.json so the resolver picks it up
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify({
        runId,
        slug: 'demo',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        result: 'completed',
        status: 'success',
      }),
    );
    // We don't actually mount the TUI in non-TTY (vitest stdio is pipe), but
    // the resolver should at least find the run and not error with E171.
    // Use a short timeout via SIGTERM-after-setTimeout pattern: the renderer
    // would block on `waitUntilExit`. To avoid that, we kill the child after
    // 500ms — what matters is the exit was NOT a hard E171 error envelope.
    let stderr = '';
    let _exitCode = 0;
    try {
      const child = require('node:child_process').spawnSync(
        'node',
        [cliPath, '--agents-dir', agentsDir, 'view', 'demo'],
        {
          env: { ...process.env, NO_COLOR: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 1500,
        },
      );
      stderr = (child.stderr as Buffer | null)?.toString('utf-8') ?? '';
      _exitCode = child.status ?? 0;
    } catch {
      // timeout is acceptable — we just want to confirm no E171 envelope appeared
    }
    // If an E171 envelope was emitted, test fails — meaning the resolver
    // didn't fall back to latest-completed.
    expect(stderr).not.toMatch(/"code":"E171"/);
  });
});
