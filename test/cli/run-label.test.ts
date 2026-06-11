import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-run-label-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const agentDir = path.join(agentsDir, 'demo');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    ['---', 'description: demo', '---', '', 'hello'].join('\n'),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout.toString('utf8') };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString('utf8') ?? '',
    };
  }
}

describe('run --label', () => {
  it('is advertised in run help', () => {
    const result = run(['run', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--label');
  });

  it('rejects invalid labels before dry-run prompt assembly', () => {
    const result = run([
      '--agents-dir',
      agentsDir,
      'run',
      'demo',
      '--label',
      'bad\nlabel',
      '--dry-run',
    ]);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E108');
    expect(envelope.error.message).toMatch(/label/i);
  });

  it('accepts valid labels in dry-run mode', () => {
    const result = run([
      '--agents-dir',
      agentsDir,
      'run',
      'demo',
      '--label',
      'id=1',
      '--dry-run',
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.slug).toBe('demo');
    expect(envelope.data.dryRun).toBe(true);
  });
});
