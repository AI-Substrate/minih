import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-init-coord-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

describe('init --coordinated', () => {
  it('scaffolds the outside contract and per-agent state schemas', () => {
    const { stdout, exitCode } = run([
      'init',
      'paired-agent',
      '--coordinated',
      '--agents-dir',
      tmpDir,
    ]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.data.files).toEqual([
      'prompt.md',
      'outside.md',
      'inside-state.schema.json',
      'outside-state.schema.json',
      'output-schema.json',
      'instructions.md',
    ]);

    const prompt = fs.readFileSync(
      path.join(tmpDir, 'paired-agent', 'prompt.md'),
      'utf8',
    );
    expect(prompt).toContain('coordination: enabled');

    const outside = fs.readFileSync(
      path.join(tmpDir, 'paired-agent', 'outside.md'),
      'utf8',
    );
    expect(outside).toContain('outside inbox send paired-agent');

    const insideSchema = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, 'paired-agent', 'inside-state.schema.json'),
        'utf8',
      ),
    );
    const outsideSchema = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, 'paired-agent', 'outside-state.schema.json'),
        'utf8',
      ),
    );
    expect(insideSchema.properties.status.enum).toContain('reviewing');
    expect(insideSchema.properties.updatedBy.const).toBe('inside');
    expect(outsideSchema.properties.status.enum).toContain('review-requested');
    expect(outsideSchema.properties.updatedBy.const).toBe('outside');
  });

  it('preserves existing init option semantics', () => {
    const { stdout, exitCode } = run([
      'init',
      'minimal-coord',
      '--coordinated',
      '--with-input',
      '--no-output',
      '--no-instructions',
      '--agents-dir',
      tmpDir,
    ]);

    expect(exitCode).toBe(0);
    const files = JSON.parse(stdout).data.files;
    expect(files).toContain('prompt.md');
    expect(files).toContain('outside.md');
    expect(files).toContain('inside-state.schema.json');
    expect(files).toContain('outside-state.schema.json');
    expect(files).toContain('input-schema.json');
    expect(files).not.toContain('output-schema.json');
    expect(files).not.toContain('instructions.md');
  });

  it('previews the real coordinated prompt in dry-run', () => {
    run(['init', 'preview-agent', '--coordinated', '--agents-dir', tmpDir]);

    const stdout = execFileSync(
      'node',
      [cliPath, 'run', 'preview-agent', '--dry-run', '--agents-dir', tmpDir],
      {
        cwd: tmpDir,
        env: { ...process.env, GH_TOKEN: undefined, NO_COLOR: '1' },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const envelope = JSON.parse(stdout);
    expect(envelope.data.prompt).toContain('## Your Context (coordination)');
    expect(envelope.data.prompt).toContain('inbox_list');
    expect(envelope.data.prompt).toContain(
      "## Peer's Contract (from outside.md)",
    );
    expect(envelope.data.prompt).toContain(
      '## Coordination pre-completion checklist',
    );
    expect(envelope.data.parts).toContain('COORDINATION');
  });
});
