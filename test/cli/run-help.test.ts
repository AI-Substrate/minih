import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

describe('run help', () => {
  it('points coordinated outside callers to outside context', () => {
    const help = execFileSync('node', [cliPath, 'run', '--help'], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(help).toContain('minih outside context');
    expect(help).toContain('outside-side contract');
  });

  it('mentions skills config flags and discovery', () => {
    const help = execFileSync('node', [cliPath, 'run', '--help'], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(help).toContain('--skill-source');
    expect(help).toContain('--skill <name>');
    expect(help).toContain('--disable-skill');
    expect(help).toContain('--no-skills');
    expect(help).toContain('minih skills discover');
  });
});
