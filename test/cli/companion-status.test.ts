import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Plan 027 Phase 4 — T006. `minih companion status` runs over the same
 * `deriveCompanionLedger` deriver and emits a conforming `MinihEnvelope` on
 * stdout. Integration test runs against the built `dist/` (PIC-F).
 */

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-companion-cli-'));
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

function append(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

function seedRun(slug: string, runId: string): void {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'prompt.md'),
    '---\ndescription: "companion"\ncoordination: enabled\n---\nbody\n',
  );
  const outside = path.join(runDir, 'inbox', 'outside', 'messages.ndjson');
  const inside = path.join(runDir, 'inbox', 'inside', 'messages.ndjson');
  append(outside, {
    id: 'm1',
    sender: 'outside',
    type: 'task',
    subject: 's',
    body: 'b',
    ts: '2026-06-15T10:00:00.000Z',
  });
  append(inside, {
    id: 'a1',
    sender: 'inside',
    type: 'ack',
    subject: 's',
    body: 'b',
    ts: '2026-06-15T10:01:00.000Z',
    ackOf: 'm1',
  });
  append(inside, {
    id: 'f1',
    sender: 'inside',
    type: 'finding',
    subject: 's',
    body: 'b',
    ts: '2026-06-15T10:02:00.000Z',
  });
}

describe('minih companion status', () => {
  it('emits a conforming envelope with the derived ledger on stdout', () => {
    const slug = 'code-review-companion';
    const runId = '2026-06-15T10-00-00-000Z-aa';
    seedRun(slug, runId);

    const res = run([
      'companion',
      'status',
      slug,
      '--run',
      runId,
      '--agents-dir',
      agentsDir,
      '--json',
    ]);

    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout.trim());
    expect(env.command).toBe('companion.status');
    expect(env.status).toBe('ok');
    expect(typeof env.timestamp).toBe('string');
    expect(env.data.slug).toBe(slug);
    expect(env.data.runId).toBe(runId);
    expect(env.data.ledger.coordinationMode).toBe('enabled');
    expect(env.data.ledger.reviewedIds).toEqual(['m1']);
    expect(env.data.ledger.findingsCount).toBe(1);
    expect(env.data.draftFarewell).not.toBeNull();
  });

  it('defaults to the most recent run when --run is omitted', () => {
    const slug = 'code-review-companion';
    seedRun(slug, '2026-06-15T09-00-00-000Z-aa');
    seedRun(slug, '2026-06-15T11-00-00-000Z-bb'); // newer

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
    expect(env.data.runId).toBe('2026-06-15T11-00-00-000Z-bb');
  });

  it('errors RUN_NOT_FOUND (E171) for an unknown run', () => {
    const res = run([
      'companion',
      'status',
      'nope',
      '--run',
      'missing',
      '--agents-dir',
      agentsDir,
      '--json',
    ]);

    expect(res.exitCode).toBe(1);
    const env = JSON.parse(res.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E171');
  });
});
