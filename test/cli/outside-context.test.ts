import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-outside-context-'));
  agentsDir = path.join(tmpDir, 'agents');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error) {
    const err = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
      exitCode: err.status ?? 1,
    };
  }
}

function runWithStderr(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error) {
    const err = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
      exitCode: err.status ?? 1,
    };
  }
}

function writeAgent(slug: string, outsideMd?: string): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---
description: "${slug} agent"
tags: []
---

# ${slug}
`,
  );
  if (outsideMd !== undefined) {
    fs.writeFileSync(path.join(dir, 'outside.md'), outsideMd);
  }
}

describe('outside-context', () => {
  it('returns system-only markdown in data.context', () => {
    const { stdout, exitCode } = run([
      'outside-context',
      '--agents-dir',
      agentsDir,
    ]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.data.slug).toBeNull();
    expect(envelope.data.context).toContain(
      '# Outside Context - minih coordination surface',
    );
    expect(envelope.data.contractStatus).toBe('system-only');
  });

  it('includes present, absent, and empty per-agent outside contracts', () => {
    writeAgent('present', '## Driver contract\nSend status updates.');
    writeAgent('absent');
    writeAgent('empty', '');

    const present = JSON.parse(
      run(['outside-context', 'present', '--agents-dir', agentsDir]).stdout,
    );
    expect(present.data.context).toContain('## Driver contract');
    expect(present.data.hasOutsideContract).toBe(true);

    const absent = JSON.parse(
      run(['outside-context', 'absent', '--agents-dir', agentsDir]).stdout,
    );
    expect(absent.data.context).toContain('has no outside.md');
    expect(absent.data.hasOutsideContract).toBe(false);

    const empty = JSON.parse(
      run(['outside-context', 'empty', '--agents-dir', agentsDir]).stdout,
    );
    expect(empty.data.context).toContain('empty outside.md');
    expect(empty.data.contractStatus).toBe('empty');
  });

  it('rejects outside.md symlink escapes through runner path guards', () => {
    writeAgent('demo');
    const target = path.join(tmpDir, 'outside-the-agents-dir.md');
    fs.writeFileSync(target, 'escape');
    fs.symlinkSync(target, path.join(agentsDir, 'demo', 'outside.md'));

    const result = runWithStderr([
      'outside-context',
      'demo',
      '--agents-dir',
      agentsDir,
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('E124');
  });

  it('surfaces oversized outside.md via truncation', () => {
    writeAgent('big', `${'a'.repeat(17 * 1024)}END`);

    const { stdout, exitCode } = run([
      'outside-context',
      'big',
      '--agents-dir',
      agentsDir,
    ]);

    expect(exitCode).toBe(0);
    const context = JSON.parse(stdout).data.context as string;
    expect(context).toContain('a'.repeat(1024));
    expect(context).not.toContain('END');
  });
});
