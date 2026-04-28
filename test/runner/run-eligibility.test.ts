/**
 * T009 (Plan 010 HF-003) — TDD RED bar for `detectRunState`.
 *
 * Workshop 001 § Eligibility State Machine defines five states a run dir
 * can be in: active / stale / completed / failed / nonexistent. Each is
 * distinguished by manifest content + process liveness (NOT time-based —
 * that is the existing `computeLiveness` resolver's job).
 *
 * `detectRunState(runDir, opts?)` is purely a filesystem + pid-liveness
 * inspection. Tests inject `isProcessAlive` to keep them deterministic.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectRunState,
  type RunEligibilityState,
} from '../../src/runner/run-eligibility.js';

let tmpRoot: string;

function makeRunDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'run-'));
  return dir;
}

function writeManifest(
  runDir: string,
  patch: Record<string, unknown> = {},
): void {
  const base = {
    schemaVersion: 1,
    slug: 'test-agent',
    runId: path.basename(runDir),
    runDir,
    pid: 12345,
    startedAt: '2026-04-28T10:00:00.000Z',
    updatedAt: '2026-04-28T10:00:00.000Z',
    status: 'active',
    sessionId: 'sess-1',
    model: 'gpt-5.4',
    control: { available: true, kind: 'none' },
    counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
  };
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    `${JSON.stringify({ ...base, ...patch }, null, 2)}\n`,
  );
}

function writeCompleted(
  runDir: string,
  patch: Record<string, unknown> = {},
): void {
  const base = {
    schemaVersion: 1,
    slug: 'test-agent',
    runId: path.basename(runDir),
    sessionId: 'sess-1',
    completedAt: '2026-04-28T11:00:00.000Z',
    result: 'success',
  };
  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    `${JSON.stringify({ ...base, ...patch }, null, 2)}\n`,
  );
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-eligibility-'));
});

afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe('detectRunState', () => {
  it('returns "nonexistent" when the run dir does not exist', async () => {
    const missing = path.join(tmpRoot, 'no-such-dir');
    const state = await detectRunState(missing);
    expect(state).toBe<RunEligibilityState>('nonexistent');
  });

  it('returns "active" when run.json status is active AND pid is alive', async () => {
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'active', pid: 9999 });
    const state = await detectRunState(runDir, {
      isProcessAlive: (pid) => pid === 9999,
    });
    expect(state).toBe<RunEligibilityState>('active');
  });

  it('returns "stale" when run.json status is active but pid is dead', async () => {
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'active', pid: 9999 });
    const state = await detectRunState(runDir, {
      isProcessAlive: () => false,
    });
    expect(state).toBe<RunEligibilityState>('stale');
  });

  it('returns "stale" when run.json status is active and pid is missing', async () => {
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'active', pid: null as unknown as number });
    const state = await detectRunState(runDir, {
      // Should not be called when pid is missing.
      isProcessAlive: () => true,
    });
    expect(state).toBe<RunEligibilityState>('stale');
  });

  it('returns "completed" when completed.json exists with success result', async () => {
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'completed' });
    writeCompleted(runDir, { result: 'success' });
    const state = await detectRunState(runDir, {
      // pid liveness must be ignored when completed.json is present.
      isProcessAlive: () => true,
    });
    expect(state).toBe<RunEligibilityState>('completed');
  });

  it('returns "failed" when completed.json exists with failed result', async () => {
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'failed' });
    writeCompleted(runDir, { result: 'failed' });
    const state = await detectRunState(runDir);
    expect(state).toBe<RunEligibilityState>('failed');
  });

  it('returns "completed" when completed.json is present even if run.json is missing', async () => {
    // Old-format run dirs may have only completed.json. Workshop 001 §
    // implies completed.json is the authoritative completion marker.
    const runDir = makeRunDir();
    writeCompleted(runDir);
    const state = await detectRunState(runDir);
    expect(state).toBe<RunEligibilityState>('completed');
  });

  it('returns "stale" when run.json is torn (unparseable) but no completed.json', async () => {
    // Corruption shouldn't crash detection — surfacing stale lets the operator
    // resume safely without taking over a possibly-alive pid.
    const runDir = makeRunDir();
    fs.writeFileSync(path.join(runDir, 'run.json'), '{ this is not json');
    const state = await detectRunState(runDir);
    expect(state).toBe<RunEligibilityState>('stale');
  });

  it('uses real process.kill liveness check when isProcessAlive is not injected', async () => {
    // process.pid is by definition alive while this test runs.
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'active', pid: process.pid });
    const state = await detectRunState(runDir);
    expect(state).toBe<RunEligibilityState>('active');
  });

  it('treats run.json status="completed" without completed.json as "completed"', async () => {
    // Matches the existing computeLiveness contract: status field is honored
    // when no separate completed.json marker is present.
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'completed' });
    const state = await detectRunState(runDir);
    expect(state).toBe<RunEligibilityState>('completed');
  });

  it('treats run.json status="failed" without completed.json as "failed"', async () => {
    const runDir = makeRunDir();
    writeManifest(runDir, { status: 'failed' });
    const state = await detectRunState(runDir);
    expect(state).toBe<RunEligibilityState>('failed');
  });
});
