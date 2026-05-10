import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

function run(
  args: string[],
  opts: { cwd?: string; expectFail?: boolean } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const { FORCE_COLOR: _fc, ...cleanEnv } = process.env;
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: opts.cwd ?? repoRoot,
      env: { ...cleanEnv, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.toString('utf-8'), stderr: '', exitCode: 0 };
  } catch (error) {
    const err = error as {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number;
    };
    return {
      stdout: err.stdout?.toString('utf-8') ?? '',
      stderr: err.stderr?.toString('utf-8') ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

let projectRoot: string;
let sourceDir: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-fx002-cli-'));
  fs.mkdirSync(path.join(projectRoot, 'agents'));
  sourceDir = path.join(projectRoot, 'src-agent');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(
    path.join(sourceDir, 'prompt.md'),
    `---
description: "test agent for FX002 demo"
tags: [demo, test]
---

# my-test-agent
Hello world demo.
`,
  );
  fs.writeFileSync(
    path.join(sourceDir, 'agent.json'),
    JSON.stringify({
      name: 'src-agent',
      version: '0.1.0',
      description: 'fixture agent',
      tags: ['demo'],
      files: [
        { path: 'prompt.md', description: 'agent prompt' },
        { path: 'instructions.md', description: 'system instructions' },
      ],
    }),
  );
  fs.writeFileSync(path.join(sourceDir, 'instructions.md'), '# instr');
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function installLocal(): void {
  run(
    [
      '--agents-dir',
      path.join(projectRoot, 'agents'),
      'agent',
      'install',
      sourceDir,
    ],
    { cwd: projectRoot },
  );
}

describe('minih agent info (FX002)', () => {
  it('AC: shows full provenance + drift "unchanged" after fresh install', () => {
    installLocal();

    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'info',
        'src-agent',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe('agent info');
    expect(envelope.status).toBe('ok');
    expect(envelope.data.slug).toBe('src-agent');
    expect(envelope.data.description).toBe('test agent for FX002 demo');
    expect(envelope.data.handRolled).toBe(false);
    expect(envelope.data.source.type).toBe('local');
    expect(envelope.data.manifestVersion).toBe('0.1.0');
    expect(envelope.data.files.length).toBeGreaterThan(0);
    for (const f of envelope.data.files) {
      expect(f.status).toBe('unchanged');
    }
  });

  it('AC: detects "modified" drift after editing an installed file', () => {
    installLocal();

    // Edit the installed copy (simulating user edits to instructions, not prompt
    // — prompt.md needs valid frontmatter for listAgents to surface the agent).
    fs.writeFileSync(
      path.join(projectRoot, 'agents', 'src-agent', 'instructions.md'),
      '# edited instructions',
    );

    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'info',
        'src-agent',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    const instrEntry = envelope.data.files.find(
      (f: { path: string }) => f.path === 'instructions.md',
    );
    expect(instrEntry.status).toBe('modified');
  });

  it('AC: detects "missing" drift after deleting an installed file', () => {
    installLocal();
    fs.rmSync(path.join(projectRoot, 'agents', 'src-agent', 'instructions.md'));

    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'info',
        'src-agent',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    const instrEntry = envelope.data.files.find(
      (f: { path: string }) => f.path === 'instructions.md',
    );
    expect(instrEntry.status).toBe('missing');
  });

  it('AC: hand-rolled agent (no .minih-source.json) returns handRolled: true', () => {
    // Create an agent the old-fashioned way (no install)
    const handRolledDir = path.join(projectRoot, 'agents', 'hand-rolled');
    fs.mkdirSync(handRolledDir);
    fs.writeFileSync(
      path.join(handRolledDir, 'prompt.md'),
      `---
description: "hand-rolled agent"
tags: []
---
# hand-rolled
`,
    );

    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'info',
        'hand-rolled',
      ],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.handRolled).toBe(true);
    expect(envelope.data.source).toBeNull();
    expect(envelope.data.description).toBe('hand-rolled agent');
  });

  it('AC: non-existent slug returns E121 with helpful hint', () => {
    installLocal();

    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'info',
        'does-not-exist',
      ],
      { cwd: projectRoot, expectFail: true },
    );
    expect(result.exitCode).not.toBe(0);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E121');
    expect(envelope.error.message).toMatch(/does-not-exist/);
    expect(envelope.error.message).toMatch(/Available.*src-agent/);
  });

  it('AC: invalid slug returns E108', () => {
    const result = run(
      [
        '--agents-dir',
        path.join(projectRoot, 'agents'),
        'agent',
        'info',
        '../escape',
      ],
      { cwd: projectRoot, expectFail: true },
    );
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E108');
  });
});

describe('minih agent list (FX002)', () => {
  it('AC: empty agentsDir returns empty agents array', () => {
    const result = run(
      ['--agents-dir', path.join(projectRoot, 'agents'), 'agent', 'list'],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe('agent list');
    expect(envelope.status).toBe('ok');
    expect(envelope.data.agents).toEqual([]);
    expect(envelope.data.count).toBe(0);
  });

  it('AC: after FX001 install, list shows source.type "local"', () => {
    installLocal();

    const result = run(
      ['--agents-dir', path.join(projectRoot, 'agents'), 'agent', 'list'],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.count).toBe(1);
    const entry = envelope.data.agents[0];
    expect(entry.slug).toBe('src-agent');
    expect(entry.source.type).toBe('local');
    expect(entry.handRolled).toBe(false);
    expect(entry.description).toBe('test agent for FX002 demo');
  });

  it('AC: hand-rolled agent appears with source: null and handRolled: true', () => {
    // Create both kinds
    installLocal();
    const handRolledDir = path.join(projectRoot, 'agents', 'hand-rolled');
    fs.mkdirSync(handRolledDir);
    fs.writeFileSync(
      path.join(handRolledDir, 'prompt.md'),
      `---
description: "hand-rolled"
tags: []
---
# hand-rolled
`,
    );

    const result = run(
      ['--agents-dir', path.join(projectRoot, 'agents'), 'agent', 'list'],
      { cwd: projectRoot },
    );
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.count).toBe(2);
    const handRolledEntry = envelope.data.agents.find(
      (a: { slug: string }) => a.slug === 'hand-rolled',
    );
    expect(handRolledEntry.source).toBeNull();
    expect(handRolledEntry.handRolled).toBe(true);
  });
});
