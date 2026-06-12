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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runs-cli-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
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

function makeRun(slug: string, runId: string): string {
  makeAgent(slug);
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

describe('minih runs list', () => {
  it('lists active runs across slugs with label and paramsSummary', () => {
    const runA = makeRun('alpha', '2026-06-08T00-00-00-000Z-a');
    fs.writeFileSync(
      path.join(runA, 'run.json'),
      JSON.stringify(
        makeManifest({
          slug: 'alpha',
          runId: '2026-06-08T00-00-00-000Z-a',
          runDir: runA,
          pid: process.pid,
          status: 'active',
          updatedAt: new Date().toISOString(),
          label: 'id=1',
          paramsSummary: {
            schemaVersion: 1,
            display: { id: '1' },
            truncated: false,
            redactedKeys: [],
          },
        }),
      ),
    );
    const runB = makeRun('bravo', '2026-06-08T00-00-01-000Z-b');
    fs.writeFileSync(
      path.join(runB, 'run.json'),
      JSON.stringify(
        makeManifest({
          slug: 'bravo',
          runId: '2026-06-08T00-00-01-000Z-b',
          runDir: runB,
          pid: process.pid,
          status: 'active',
          updatedAt: new Date().toISOString(),
        }),
      ),
    );

    const result = run(['--agents-dir', agentsDir, 'runs', 'list', '--active']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe('runs.list');
    expect(envelope.data.count).toBe(2);
    expect(
      envelope.data.runs.find((r: { slug: string }) => r.slug === 'alpha'),
    ).toMatchObject({
      slug: 'alpha',
      label: 'id=1',
      paramsSummary: { display: { id: '1' } },
    });
    expect(envelope.data.runs[0]).not.toHaveProperty('runDir');
  });

  it('includes completed runs for --all --slug', () => {
    const runId = '2026-06-08T00-00-02-000Z-c';
    const runDir = makeRun('alpha', runId);
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'alpha', runId })),
    );

    const result = run([
      '--agents-dir',
      agentsDir,
      'runs',
      'list',
      '--all',
      '--slug',
      'alpha',
    ]);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.runs).toHaveLength(1);
    expect(envelope.data.runs[0]).toMatchObject({
      slug: 'alpha',
      runId,
      liveness: 'completed',
    });
  });

  // FT-005 (plan 026 review F005) — `runs` passes terminalReason through so
  // operators can see WHY a run failed without opening run.json (AC-7).
  it('passes terminalReason through for failed runs', () => {
    const runId = '2026-06-08T00-00-03-000Z-d';
    const runDir = makeRun('alpha', runId);
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify(
        makeManifest({
          slug: 'alpha',
          runId,
          runDir,
          status: 'failed',
          terminalReason: 'stalled-stream',
        }),
      ),
    );
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'alpha', runId, result: 'failed' })),
    );

    const result = run([
      '--agents-dir',
      agentsDir,
      'runs',
      'list',
      '--all',
      '--slug',
      'alpha',
    ]);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.runs[0]).toMatchObject({
      runId,
      liveness: 'failed',
      terminalReason: 'stalled-stream',
    });
  });

  // T005 (plan 025, AC-4) — end-to-end through the built CLI with the REAL
  // probe. The fixture pid exceeds PID_MAX on macOS (99998) and Linux
  // (4194304), so the kill-0 probe deterministically reports it gone.
  it("reports liveness 'dead' for an active manifest whose pid is gone", () => {
    const runId = '2026-06-08T00-00-08-000Z-h';
    const runDir = makeRun('alpha', runId);
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify(
        makeManifest({
          slug: 'alpha',
          runId,
          runDir,
          pid: 99_999_999,
          status: 'active',
          updatedAt: new Date().toISOString(),
        }),
      ),
    );
    const liveId = '2026-06-08T00-00-09-000Z-i';
    const liveDir = makeRun('alpha', liveId);
    fs.writeFileSync(
      path.join(liveDir, 'run.json'),
      JSON.stringify(
        makeManifest({
          slug: 'alpha',
          runId: liveId,
          runDir: liveDir,
          pid: process.pid,
          status: 'active',
          updatedAt: new Date().toISOString(),
        }),
      ),
    );

    const result = run(['--agents-dir', agentsDir, 'runs', 'list', '--active']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    const bySlug = Object.fromEntries(
      envelope.data.runs.map((r: { runId: string; liveness: string }) => [
        r.runId,
        r.liveness,
      ]),
    );
    expect(bySlug[runId]).toBe('dead');
    expect(bySlug[liveId]).toBe('active');
  });
});

describe('minih runs status', () => {
  it('returns degraded row-level missing errors', () => {
    const runId = '2026-06-08T00-00-03-000Z-d';
    const runDir = makeRun('alpha', runId);
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'alpha', runId })),
    );

    const result = run([
      '--agents-dir',
      agentsDir,
      'runs',
      'status',
      '--run',
      `alpha/${runId}`,
      '--run',
      'alpha/missing',
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('degraded');
    expect(envelope.data.summary).toMatchObject({
      total: 2,
      found: 1,
      missing: 1,
    });
    expect(envelope.data.runs[1]).toMatchObject({
      target: 'alpha/missing',
      found: false,
      error: { code: 'E171' },
    });
  });

  it('accepts targets from a file', () => {
    const runId = '2026-06-08T00-00-04-000Z-e';
    const runDir = makeRun('alpha', runId);
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'alpha', runId })),
    );
    const targets = path.join(tmpDir, 'targets.txt');
    fs.writeFileSync(targets, `# comment\nalpha/${runId}\n`);

    const result = run([
      '--agents-dir',
      agentsDir,
      'runs',
      'status',
      '--from',
      targets,
    ]);

    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('ok');
    expect(envelope.data.runs[0]).toMatchObject({ found: true, runId });
  });

  it('returns malformed --from lines as row-level degraded errors', () => {
    const runId = '2026-06-08T00-00-05-000Z-f';
    const runDir = makeRun('alpha', runId);
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'alpha', runId })),
    );
    const targets = path.join(tmpDir, 'targets.txt');
    fs.writeFileSync(targets, `alpha/${runId}\nnot-a-target\n`);

    const result = run([
      '--agents-dir',
      agentsDir,
      'runs',
      'status',
      '--from',
      targets,
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('degraded');
    expect(envelope.data.runs[1]).toMatchObject({
      target: 'not-a-target',
      found: false,
      error: { code: 'E108' },
    });
  });
});
