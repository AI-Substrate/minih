import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

describe('run help', () => {
  it('points coordinated outside callers to outside-context', () => {
    const help = execFileSync('node', [cliPath, 'run', '--help'], {
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(help).toContain('minih outside-context <slug>');
    expect(help).toContain('outside-side contract');
  });
});
