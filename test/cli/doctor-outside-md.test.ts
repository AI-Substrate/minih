import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-doctor-outside-'));
  agentsDir = path.join(tmpDir, 'agents');
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

function writeAgent(
  slug: string,
  options: {
    coordinated?: boolean;
    outside?: string;
    staleOutside?: boolean;
  } = {},
): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const promptPath = path.join(dir, 'prompt.md');
  fs.writeFileSync(
    promptPath,
    `---\ndescription: "${slug} agent"\n${options.coordinated ? 'coordination: enabled\n' : ''}---\n\n# ${slug}\n`,
  );
  if (options.outside !== undefined) {
    const outsidePath = path.join(dir, 'outside.md');
    fs.writeFileSync(outsidePath, options.outside);
    if (options.staleOutside) {
      const old = new Date('2026-04-25T00:00:00Z');
      const newer = new Date('2026-04-26T00:00:00Z');
      fs.utimesSync(outsidePath, old, old);
      fs.utimesSync(promptPath, newer, newer);
    }
  }
}

function checksFor(
  stdout: string,
  slug: string,
): Array<Record<string, string>> {
  const envelope = JSON.parse(stdout);
  const agents = envelope.data?.agents ?? envelope.error?.details?.agents;
  return agents.find((agent: { slug: string }) => agent.slug === slug).checks;
}

describe('doctor outside.md checks', () => {
  it('warns when a coordinated outside.md is older than prompt.md', () => {
    writeAgent('stale', {
      coordinated: true,
      outside: 'Peer contract',
      staleOutside: true,
    });

    const { stdout, exitCode } = run(['doctor', '--agents-dir', agentsDir]);

    expect(exitCode).toBe(0);
    expect(checksFor(stdout, 'stale')).toContainEqual(
      expect.objectContaining({
        check: 'outside.md-drift',
        status: 'warning',
      }),
    );
  });

  it('warns above 4KB and fails above 8KB for coordinated outside.md', () => {
    writeAgent('warning-size', {
      coordinated: true,
      outside: 'a'.repeat(5 * 1024),
    });
    writeAgent('fail-size', {
      coordinated: true,
      outside: 'b'.repeat(9 * 1024),
    });

    const { stdout, exitCode } = run(['doctor', '--agents-dir', agentsDir]);

    expect(exitCode).toBe(1);
    expect(checksFor(stdout, 'warning-size')).toContainEqual(
      expect.objectContaining({
        check: 'outside.md-size',
        status: 'warning',
      }),
    );
    expect(checksFor(stdout, 'fail-size')).toContainEqual(
      expect.objectContaining({
        check: 'outside.md-size',
        status: 'fail',
      }),
    );
  });

  it('leaves non-coordinated and absent outside contracts alone', () => {
    writeAgent('non-coordinated', {
      outside: 'x'.repeat(9 * 1024),
      staleOutside: true,
    });
    writeAgent('absent-coordinated', { coordinated: true });

    const { stdout, exitCode } = run(['doctor', '--agents-dir', agentsDir]);

    expect(exitCode).toBe(0);
    expect(
      checksFor(stdout, 'non-coordinated').some((check) =>
        check.check.startsWith('outside.md'),
      ),
    ).toBe(false);
    expect(
      checksFor(stdout, 'absent-coordinated').some((check) =>
        check.check.startsWith('outside.md'),
      ),
    ).toBe(false);
  });

  it('fails symlink escapes before reading outside.md metadata', () => {
    writeAgent('escape', { coordinated: true });
    const target = path.join(tmpDir, 'outside-agents.md');
    fs.writeFileSync(target, 'escape');
    fs.symlinkSync(target, path.join(agentsDir, 'escape', 'outside.md'));

    const { stdout, exitCode } = run(['doctor', '--agents-dir', agentsDir]);

    expect(exitCode).toBe(1);
    expect(checksFor(stdout, 'escape')).toContainEqual(
      expect.objectContaining({
        check: 'outside.md',
        status: 'fail',
      }),
    );
  });
});
