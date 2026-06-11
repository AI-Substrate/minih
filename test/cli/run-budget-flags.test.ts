/**
 * Plan 026 T007 — run budgets at the CLI boundary: `--stall-timeout` /
 * `--max-turns` on run AND resume, E108 validation, threading proven via
 * the dry-run budgets echo, shared frontmatter-aware default timeout.
 * Built-CLI subprocess tests (real flags, tiny budgets — never defaults).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-budget-flags-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  writeAgent('demo', ['---', 'description: demo', '---', '', 'hello']);
  writeAgent('slowpoke', [
    '---',
    'description: frontmatter timeout agent',
    'timeout: 42',
    '---',
    '',
    'hello',
  ]);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAgent(slug: string, promptLines: string[]): void {
  const agentDir = path.join(agentsDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'prompt.md'), promptLines.join('\n'));
}

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

function dryRun(extraFlags: string[], slug = 'demo') {
  return run([
    '--agents-dir',
    agentsDir,
    'run',
    slug,
    ...extraFlags,
    '--dry-run',
  ]);
}

describe('budget flags — help surfaces', () => {
  it('run --help advertises --stall-timeout and --max-turns', () => {
    const result = run(['run', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--stall-timeout');
    expect(result.stdout).toContain('--max-turns');
  });

  it('resume --help advertises --stall-timeout and --max-turns and no hardcoded 300 default', () => {
    const result = run(['resume', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--stall-timeout');
    expect(result.stdout).toContain('--max-turns');
    // The legacy hardcoded commander default ('300') on -t/--timeout is gone;
    // the shared frontmatter-aware default is documented instead.
    expect(result.stdout).not.toContain('(default: "300")');
    expect(result.stdout).toContain(
      'Timeout in seconds (default: agent frontmatter',
    );
  });
});

describe('budget flags — E108 validation', () => {
  const invalidCases: Array<[string, string[]]> = [
    ['--stall-timeout NaN', ['--stall-timeout', 'abc']],
    ['--stall-timeout negative', ['--stall-timeout', '-5']],
    ['--max-turns NaN', ['--max-turns', 'lots']],
    ['--max-turns negative', ['--max-turns', '-1']],
    ['--max-turns fractional', ['--max-turns', '1.5']],
    ['--timeout NaN', ['--timeout', 'abc']],
    ['--timeout zero (wall-clock budget must be positive)', ['--timeout', '0']],
  ];

  for (const [label, flags] of invalidCases) {
    it(`rejects ${label} with E108 on run`, () => {
      const result = dryRun(flags);
      expect(result.exitCode).toBe(1);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.error.code).toBe('E108');
    });
  }

  it('rejects an invalid --stall-timeout with E108 on resume (before run resolution)', () => {
    const result = run([
      '--agents-dir',
      agentsDir,
      'resume',
      'demo',
      '--stall-timeout',
      'abc',
    ]);
    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E108');
  });
});

describe('budget flags — threading (dry-run budgets echo)', () => {
  it('echoes explicit budgets', () => {
    const result = dryRun([
      '--timeout',
      '30',
      '--stall-timeout',
      '10',
      '--max-turns',
      '5',
    ]);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.budgets).toEqual({
      timeoutSec: 30,
      stallTimeoutSec: 10,
      maxTurns: 5,
    });
  });

  it('echoes the shared defaults when no flags are given (900 / 300 / 0)', () => {
    const result = dryRun([]);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.budgets).toEqual({
      timeoutSec: 900,
      stallTimeoutSec: 300,
      maxTurns: 0,
    });
  });

  it('frontmatter timeout wins over the shared default', () => {
    const result = dryRun([], 'slowpoke');
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.budgets).toMatchObject({ timeoutSec: 42 });
  });

  it('accepts --stall-timeout 0 (disable) and --max-turns 0 (unlimited)', () => {
    const result = dryRun(['--stall-timeout', '0', '--max-turns', '0']);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.budgets).toMatchObject({
      stallTimeoutSec: 0,
      maxTurns: 0,
    });
  });
});
