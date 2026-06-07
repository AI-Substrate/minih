import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');
let tmp: string;

function run(args: string[], cwd = tmp): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '' };
  } catch (error) {
    const err = error as { stdout?: Buffer; stderr?: Buffer };
    return {
      stdout: err.stdout?.toString('utf-8') ?? '',
      stderr: err.stderr?.toString('utf-8') ?? '',
    };
  }
}

function skill(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Test Skill\n');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-skills-cli-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('minih skills command', () => {
  it('discovers repo-local skills with JSON envelope', () => {
    skill(path.join(tmp, '.agents', 'skills', 'minih-test-skill'));
    const { stdout } = run(['skills', 'discover', '--skill-source', '.agents']);
    const envelope = JSON.parse(stdout);
    expect(envelope.command).toBe('skills.discover');
    expect(envelope.status).toBe('ok');
    expect(envelope.data.discovered[0].name).toBe('minih-test-skill');
    expect(envelope.data.skillDirectories).toEqual([
      path.join(fs.realpathSync(tmp), '.agents', 'skills'),
    ]);
  });

  it('reports missing explicit includes as degraded actionable diagnostics', () => {
    const { stdout } = run([
      'skills',
      'doctor',
      '--skill-source',
      '.agents',
      '--skill',
      'missing',
    ]);
    const envelope = JSON.parse(stdout);
    expect(envelope.command).toBe('skills.doctor');
    expect(envelope.status).toBe('degraded');
    expect(
      envelope.data.diagnostics.map((d: { code: string }) => d.code),
    ).toContain('E211');
    expect(JSON.stringify(envelope.data.diagnostics)).toContain(
      'minih skills discover',
    );
  });

  it('has skills help that points to discover and doctor', () => {
    const help = execFileSync('node', [cliPath, 'skills', '--help'], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(help).toContain('discover');
    expect(help).toContain('doctor');
  });
});
