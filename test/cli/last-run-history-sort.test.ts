import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Plan 028 Phase 2 — T003/T004 (defect D). The run-folder name encodes the
 * start time, but after the UTC fix old folders carry a LOCAL time mislabeled
 * `Z` while new ones carry true UTC — so a lexical folder-name sort can pick a
 * stale run as "newest". Every "newest run" selector must sort PRIMARILY by the
 * `startedAt` (true UTC) recorded in run.json/completed.json.
 *
 * Fixture: OLD run started 03:50 UTC but named `…13-50…Z` (local +10); NEW run
 * started 05:58 UTC named `…05-58…Z`. By folder name, OLD (`13-50`) sorts first
 * — wrong; by startedAt, NEW (`05:58`) is newest — right. Integration against
 * the built dist/ (PIC-F), mirroring companion-status.test.ts.
 */

const cliPath = path.resolve('dist/cli/index.js');

// Started EARLIER (03:50 UTC) but folder name says 13-50 (old local-as-Z bug).
const OLD = {
  runId: '2026-06-16T13-50-25-287Z-8a55',
  startedAt: '2026-06-16T03:50:25.286Z',
};
// Started LATER (05:58 UTC), folder name in true UTC (post-fix).
const NEW = {
  runId: '2026-06-16T05-58-44-285Z-573c',
  startedAt: '2026-06-16T05:58:44.284Z',
};

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runsort-cli-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout.toString('utf8') };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString('utf8') ?? '',
    };
  }
}

function append(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

function seedRun(
  slug: string,
  r: { runId: string; startedAt: string },
  result: string | null,
): void {
  const runDir = path.join(agentsDir, slug, 'runs', r.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'prompt.md'),
    '---\ndescription: "companion"\ncoordination: enabled\n---\nbody\n',
  );
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      runId: r.runId,
      startedAt: r.startedAt,
      status: result ? 'completed' : 'active',
    }),
  );
  if (result) {
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify({ runId: r.runId, startedAt: r.startedAt, result }),
    );
  }
  // Minimal coordination inbox so `companion status` can derive a ledger.
  const outside = path.join(runDir, 'inbox', 'outside', 'messages.ndjson');
  append(outside, {
    id: 'm1',
    sender: 'outside',
    type: 'task',
    subject: 's',
    body: 'b',
    ts: r.startedAt,
  });
}

function seedMixed(slug: string): void {
  // Agent-root prompt.md so resolveAgent (used by last-run/history) finds it.
  const agentDir = path.join(agentsDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    '---\ndescription: "companion"\ncoordination: enabled\n---\nbody\n',
  );
  seedRun(slug, OLD, 'completed');
  seedRun(slug, NEW, 'completed');
}

describe('newest-run selectors sort by startedAt, not folder name (defect D)', () => {
  it('last-run picks the chronologically newest run, not the lexically last name', () => {
    const slug = 'code-review-companion';
    seedMixed(slug);
    const res = run(['last-run', slug, '--agents-dir', agentsDir]);
    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout.trim());
    expect(env.data.runId).toBe(NEW.runId);
  });

  it('history lists the chronologically newest run first', () => {
    const slug = 'code-review-companion';
    seedMixed(slug);
    const res = run(['history', slug, '--agents-dir', agentsDir]);
    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout.trim());
    expect(env.data.runs[0].runId).toBe(NEW.runId);
  });

  it('companion status (no --run) defaults to the chronologically newest run', () => {
    const slug = 'code-review-companion';
    seedMixed(slug);
    const res = run([
      'companion',
      'status',
      slug,
      '--agents-dir',
      agentsDir,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout.trim());
    expect(env.data.runId).toBe(NEW.runId);
  });
});
