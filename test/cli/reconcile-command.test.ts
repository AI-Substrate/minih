/**
 * T012 (plan 025, FX011/AC-7/AC-8) — `minih reconcile` end-to-end through
 * the built CLI. The dead fixture pid exceeds PID_MAX on macOS/Linux so the
 * REAL probe deterministically reports it gone.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeManifest } from '../../src/runner/human-view-fixtures.js';

const cliPath = path.resolve('dist/cli/index.js');
const DEAD_PID = 99_999_999;

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-reconcile-cli-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function cli(args: string[]): { exitCode: number; stdout: string } {
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

function seedRun(
  slug: string,
  runId: string,
  patch: Record<string, unknown> = {},
): string {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify(
      makeManifest({
        slug,
        runId,
        runDir,
        status: 'active',
        pid: DEAD_PID,
        ...(patch as object),
      }),
    ),
  );
  return runDir;
}

describe('minih reconcile', () => {
  it('heals dead-pid runs, then reports nothing to heal on re-run', () => {
    const runId = '2026-06-11T00-00-00-000Z-dead';
    const runDir = seedRun('alpha', runId);

    const first = cli(['--agents-dir', agentsDir, 'reconcile', 'alpha']);
    expect(first.exitCode).toBe(0);
    const envelope = JSON.parse(first.stdout);
    expect(envelope.command).toBe('reconcile');
    expect(envelope.status).toBe('ok');
    expect(envelope.data.healedCount).toBe(1);
    expect(envelope.data.healed[0]).toMatchObject({
      slug: 'alpha',
      runId,
      pid: DEAD_PID,
      previousStatus: 'active',
    });
    expect(envelope.data.filters).toEqual({
      slug: 'alpha',
      runId: null,
      all: false,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'),
    );
    expect(manifest.status).toBe('crashed');
    expect(manifest.terminalReason).toBe('pid-vanished');

    const second = cli(['--agents-dir', agentsDir, 'reconcile', 'alpha']);
    expect(second.exitCode).toBe(0);
    const secondEnvelope = JSON.parse(second.stdout);
    expect(secondEnvelope.data.healedCount).toBe(0);
    expect(secondEnvelope.data.skipped.terminal).toBeGreaterThanOrEqual(1);
  });

  it('reconciles across all agents with --all', () => {
    seedRun('alpha', '2026-06-11T00-00-01-000Z-a');
    seedRun('bravo', '2026-06-11T00-00-02-000Z-b');

    const result = cli(['--agents-dir', agentsDir, 'reconcile', '--all']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.healedCount).toBe(2);
    expect(
      envelope.data.healed.map((h: { slug: string }) => h.slug).sort(),
    ).toEqual(['alpha', 'bravo']);
  });

  it('returns E190 RECONCILE_IN_PROGRESS when the lock is held by a live owner', () => {
    seedRun('alpha', '2026-06-11T00-00-03-000Z-c');
    fs.writeFileSync(
      path.join(agentsDir, '.reconcile.lock'),
      JSON.stringify({
        version: 1,
        ownerId: 'someone-else',
        pid: process.pid,
        acquiredAtMs: Date.now(),
      }),
    );

    const result = cli(['--agents-dir', agentsDir, 'reconcile', 'alpha']);

    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('E190');
  });

  it('requires a slug or --all', () => {
    const result = cli(['--agents-dir', agentsDir, 'reconcile']);

    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E108');
  });

  // F001 (plan 025 review) — `--all` and a slug are contradictory scopes;
  // accepting both ran a slug-scoped pass while reporting `all: true`.
  it('rejects --all combined with a slug or --run', () => {
    const runDir = seedRun('alpha', '2026-06-11T00-00-04-000Z-d');

    const withSlug = cli([
      '--agents-dir',
      agentsDir,
      'reconcile',
      'alpha',
      '--all',
    ]);
    expect(withSlug.exitCode).not.toBe(0);
    const slugEnvelope = JSON.parse(withSlug.stdout);
    expect(slugEnvelope.error.code).toBe('E108');
    expect(slugEnvelope.error.message).toContain('--all');

    const withRun = cli([
      '--agents-dir',
      agentsDir,
      'reconcile',
      '--all',
      '--run',
      'whatever',
    ]);
    expect(withRun.exitCode).not.toBe(0);
    expect(JSON.parse(withRun.stdout).error.code).toBe('E108');

    // The rejected invocations must not have run a sneaky scoped pass.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'),
    );
    expect(manifest.status).toBe('active');
  });
});
