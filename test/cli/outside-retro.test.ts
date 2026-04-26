import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inboxLanePath } from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-outside-retro-'));
  agentsDir = path.join(tmpDir, 'agents');
  writeAgent('demo');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

function writeAgent(slug: string): void {
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
}

function readOutsideLane(): InboxMessage[] {
  return fs
    .readFileSync(inboxLanePath('demo', agentsDir, 'outside'), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as InboxMessage);
}

describe('outside-retro', () => {
  it('writes a coordination-target retro message by default', () => {
    const { stdout, exitCode } = run([
      'outside-retro',
      'demo',
      '--body',
      'Worked well. Magic wand: clearer peer status.',
      '--agents-dir',
      agentsDir,
    ]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope).toMatchObject({
      command: 'outside-retro',
      status: 'ok',
      data: { slug: 'demo', target: 'inside' },
    });
    expect(readOutsideLane()).toEqual([
      expect.objectContaining({
        type: 'retro',
        subject: 'outside session retro',
        body: 'Worked well. Magic wand: clearer peer status.',
        meta: { magicWandTarget: 'coordination' },
      }),
    ]);
  });

  it('supports explicit targets and rejects unknown targets', () => {
    const explicit = run([
      'outside-retro',
      'demo',
      '--body',
      'Project feedback',
      '--target',
      'project',
      '--agents-dir',
      agentsDir,
    ]);
    expect(explicit.exitCode).toBe(0);
    expect(readOutsideLane()[0]?.meta).toEqual({ magicWandTarget: 'project' });

    const invalid = run([
      'outside-retro',
      'demo',
      '--body',
      'Nope',
      '--target',
      'other',
      '--agents-dir',
      agentsDir,
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).error.code).toBe('E108');
  });
});
