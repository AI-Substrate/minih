import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  makeCompleted,
  makeManifest,
} from '../../src/runner/human-view-fixtures.js';

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-run-target-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  makeAgent('demo');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString('utf8') ?? '',
      stderr: e.stderr?.toString('utf8') ?? '',
    };
  }
}

function makeAgent(slug: string): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    ['---', 'description: demo', '---', '', 'hello'].join('\n'),
  );
}

function makeActiveRun(runId: string, label?: string): string {
  const runDir = path.join(agentsDir, 'demo', 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), '');
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify(
      makeManifest({
        slug: 'demo',
        runId,
        runDir,
        pid: process.pid,
        status: 'active',
        updatedAt: new Date().toISOString(),
        sessionId: `sess-${runId}`,
        ...(label && { label }),
      }),
    ),
  );
  return runDir;
}

function makeCompletedRun(runId: string): string {
  const runDir = path.join(agentsDir, 'demo', 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), '');
  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify(
      makeCompleted({ slug: 'demo', runId, sessionId: 'sess-done' }),
    ),
  );
  return runDir;
}

describe('ambiguous latest-run guard', () => {
  it('status returns E170 with candidates when multiple active runs exist', () => {
    makeActiveRun('2026-06-08T00-00-00-000Z-a', 'id=1');
    makeActiveRun('2026-06-08T00-00-01-000Z-b', 'id=2');

    const result = run(['--agents-dir', agentsDir, 'status', 'demo']);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E170');
    expect(envelope.error.details.candidates).toHaveLength(2);
    expect(envelope.error.details.candidates[0]).toHaveProperty('label');
  });

  it('status --latest explicitly selects the newest active run', () => {
    makeActiveRun('2026-06-08T00-00-00-000Z-a');
    makeActiveRun('2026-06-08T00-00-01-000Z-b');

    const result = run([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--latest',
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.runId).toBe('2026-06-08T00-00-01-000Z-b');
    expect(envelope.data.verdict).toBe('active');
    expect(envelope.data.selection).toEqual({
      mode: 'latest',
      ambiguousCandidates: 2,
    });
  });

  it('status skips stale active manifests instead of treating them as ambiguous', () => {
    const staleDir = makeActiveRun('2026-06-08T00-00-00-000Z-a');
    const staleManifest = JSON.parse(
      fs.readFileSync(path.join(staleDir, 'run.json'), 'utf8'),
    );
    fs.writeFileSync(
      path.join(staleDir, 'run.json'),
      JSON.stringify({
        ...staleManifest,
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    makeActiveRun('2026-06-08T00-00-01-000Z-b');

    const result = run(['--agents-dir', agentsDir, 'status', 'demo']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.runId).toBe('2026-06-08T00-00-01-000Z-b');
    expect(envelope.data.verdict).toBe('active');
  });

  it('status preserves latest completed fallback when no active run exists', () => {
    makeCompletedRun('2026-06-08T00-00-02-000Z-c');

    const result = run(['--agents-dir', agentsDir, 'status', 'demo']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.runId).toBe('2026-06-08T00-00-02-000Z-c');
    expect(envelope.data.verdict).toBe('completed');
  });

  it('tail --snapshot exits clearly on multiple active runs', () => {
    makeActiveRun('2026-06-08T00-00-00-000Z-a');
    makeActiveRun('2026-06-08T00-00-01-000Z-b');

    const result = run([
      '--agents-dir',
      agentsDir,
      'tail',
      'demo',
      '--snapshot',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Multiple active runs found');
  });

  it('connect detects N-active/0-completed ambiguity before completed fallback', () => {
    makeActiveRun('2026-06-08T00-00-00-000Z-a');
    makeActiveRun('2026-06-08T00-00-01-000Z-b');

    const result = run(['--agents-dir', agentsDir, 'connect', 'demo']);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E170');
  });

  it('resume detects N-active/0-completed ambiguity before completed fallback', () => {
    makeActiveRun('2026-06-08T00-00-00-000Z-a');
    makeActiveRun('2026-06-08T00-00-01-000Z-b');

    const result = run(['--agents-dir', agentsDir, 'resume', 'demo']);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E170');
  });

  it('outside inbox send uses E170 for multiple active coordination targets', () => {
    makeActiveRun('2026-06-08T00-00-00-000Z-a');
    makeActiveRun('2026-06-08T00-00-01-000Z-b');

    const result = run([
      '--agents-dir',
      agentsDir,
      'outside',
      'inbox',
      'send',
      'demo',
      '--type',
      'note',
      '--subject',
      'hello',
      '--body',
      'world',
    ]);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E170');
  });

  it('connect preserves latest completed behavior when no active ambiguity exists', () => {
    makeCompletedRun('2026-06-08T00-00-02-000Z-c');

    const result = run(['--agents-dir', agentsDir, 'connect', 'demo']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.runId).toBe('2026-06-08T00-00-02-000Z-c');
  });
});
