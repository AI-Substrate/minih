/**
 * T002/T003/T004 (plan 025) — direct-import verdict matrix for `minih status`.
 *
 * `computeStatusVerdict` is the exported seam (FX009-2): tests build run dirs
 * on disk and call the function directly — no subprocess, no real processes.
 * T002 pins the pre-probe behavior (characterization); T003 extends the matrix
 * with the pid probe; T004 covers the envelope diagnostic fields.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeStatusVerdict,
  STATUS_VERDICT_COLORS,
  STATUS_VERDICT_ICONS,
} from '../../src/cli/commands/status.js';
import { isProcessAliveDefault } from '../../src/runner/run-eligibility.js';

let tmpRoot: string;

function makeRunDir(): string {
  return fs.mkdtempSync(path.join(tmpRoot, 'run-'));
}

function writeCompleted(
  runDir: string,
  patch: Record<string, unknown> = {},
): void {
  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug: 'demo',
      runId: path.basename(runDir),
      sessionId: 'sess-1',
      completedAt: '2026-06-11T10:00:00.000Z',
      result: 'completed',
      durationMs: 1234,
      ...patch,
    }),
  );
}

function writeEvents(runDir: string): string {
  const eventsPath = path.join(runDir, 'events.ndjson');
  fs.writeFileSync(
    eventsPath,
    '{"type":"message","timestamp":"2026-06-11T10:00:00.000Z","data":{"content":"hi"}}\n',
  );
  return eventsPath;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-status-verdict-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('computeStatusVerdict — characterization (T002, pre-probe behavior)', () => {
  it('completed.json result=completed → completed, extracting result/durationMs/sessionId', () => {
    const runDir = makeRunDir();
    writeCompleted(runDir, {
      result: 'completed',
      durationMs: 4321,
      sessionId: 'sess-x',
    });
    expect(computeStatusVerdict(runDir)).toMatchObject({
      verdict: 'completed',
      result: 'completed',
      durationMs: 4321,
      sessionId: 'sess-x',
    });
  });

  it('completed.json result=degraded → completed', () => {
    const runDir = makeRunDir();
    writeCompleted(runDir, { result: 'degraded' });
    expect(computeStatusVerdict(runDir).verdict).toBe('completed');
  });

  it('completed.json result=failed → failed', () => {
    const runDir = makeRunDir();
    writeCompleted(runDir, { result: 'failed' });
    expect(computeStatusVerdict(runDir).verdict).toBe('failed');
  });

  it('torn completed.json → unknown', () => {
    const runDir = makeRunDir();
    fs.writeFileSync(path.join(runDir, 'completed.json'), '{ torn');
    expect(computeStatusVerdict(runDir).verdict).toBe('unknown');
  });

  it('fresh events.ndjson without completed.json → active', () => {
    const runDir = makeRunDir();
    writeEvents(runDir);
    expect(computeStatusVerdict(runDir).verdict).toBe('active');
  });

  it('events.ndjson older than the stale threshold → stale', () => {
    const runDir = makeRunDir();
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, { now: () => Date.now() + 120_000 }).verdict,
    ).toBe('stale');
  });

  it('neither completed.json nor events.ndjson → unknown', () => {
    const runDir = makeRunDir();
    expect(computeStatusVerdict(runDir).verdict).toBe('unknown');
  });
});

function writeRunJson(
  runDir: string,
  patch: Record<string, unknown> = {},
): void {
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug: 'demo',
      runId: path.basename(runDir),
      runDir,
      pid: 4242,
      startedAt: '2026-06-11T10:00:00.000Z',
      updatedAt: '2026-06-11T10:00:00.000Z',
      status: 'active',
      sessionId: 'sess-1',
      model: null,
      control: { available: false, kind: 'none' },
      counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
      ...patch,
    }),
  );
}

const killThrowing =
  (code: string) =>
  (_pid: number, _signal: 0): void => {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    throw err;
  };

// T003 (plan 025, FX009) — the 9-case probe matrix. Zero real processes:
// liveness is decided by injected predicates / injected kill fns only.
describe('computeStatusVerdict — pid probe matrix (T003)', () => {
  it('1. alive pid + fresh events → active (mtime semantics unchanged)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir);
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => true }).verdict,
    ).toBe('active');
  });

  it('2. dead pid + non-terminal manifest → dead (even with fresh events)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir);
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => false }).verdict,
    ).toBe('dead');
  });

  it('3. completed.json wins — probe never called for terminal runs', () => {
    const runDir = makeRunDir();
    writeCompleted(runDir);
    writeRunJson(runDir);
    const throwing = vi.fn(() => {
      throw new Error('probe must not be called for terminal runs');
    });
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: throwing }).verdict,
    ).toBe('completed');
    expect(throwing).not.toHaveBeenCalled();
  });

  it('4. manifest without pid → probe not attempted, mtime fall-through', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: null });
    writeEvents(runDir);
    const throwing = vi.fn(() => {
      throw new Error('probe must not be called without a pid');
    });
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: throwing }).verdict,
    ).toBe('active');
    expect(throwing).not.toHaveBeenCalled();
  });

  it('5. injected predicate overrides reality (live process.pid reads dead)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: process.pid });
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => false }).verdict,
    ).toBe('dead');
  });

  it('6. pid 0 → dead via the real probe (non-positive short-circuit)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: 0 });
    writeEvents(runDir);
    expect(computeStatusVerdict(runDir).verdict).toBe('dead');
  });

  it('7. negative pid → dead via the real probe', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: -7 });
    writeEvents(runDir);
    expect(computeStatusVerdict(runDir).verdict).toBe('dead');
  });

  it('8. EPERM probe error → alive → active (conservative-alive)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir);
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, {
        isProcessAlive: (pid) =>
          isProcessAliveDefault(pid, { kill: killThrowing('EPERM') }),
      }).verdict,
    ).toBe('active');
  });

  it('9. EINVAL probe error → dead', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir);
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, {
        isProcessAlive: (pid) =>
          isProcessAliveDefault(pid, { kill: killThrowing('EINVAL') }),
      }).verdict,
    ).toBe('dead');
  });

  it('dead beats stale: dead pid + old events → dead, not stale', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir);
    writeEvents(runDir);
    expect(
      computeStatusVerdict(runDir, {
        isProcessAlive: () => false,
        now: () => Date.now() + 120_000,
      }).verdict,
    ).toBe('dead');
  });

  // T010 (plan 025, FX011) — a healed manifest is already diagnosed: the
  // verdict is 'dead' without re-probing (pid reuse must not flip it back).
  it("healed manifest (status 'crashed') → dead, probe not called", () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, {
      status: 'crashed',
      terminalReason: 'pid-vanished',
    });
    writeEvents(runDir);
    const throwing = vi.fn(() => {
      throw new Error('probe must not be called for healed manifests');
    });
    const info = computeStatusVerdict(runDir, { isProcessAlive: throwing });
    expect(info.verdict).toBe('dead');
    expect(info).toMatchObject({ pid: 4242, pidAlive: false });
    expect(throwing).not.toHaveBeenCalled();
  });

  it('manifest terminal status (completed) skips the probe', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { status: 'completed' });
    writeEvents(runDir);
    const throwing = vi.fn(() => {
      throw new Error('probe must not be called for terminal manifests');
    });
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: throwing }).verdict,
    ).toBe('active');
    expect(throwing).not.toHaveBeenCalled();
  });
});

// T004 (plan 025) — probe diagnostics in the result + explicit TTY arms.
describe('computeStatusVerdict — probe diagnostics (T004)', () => {
  it('dead verdict carries pid, pidAlive:false, lastEventAt', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: 4242 });
    writeEvents(runDir);
    const info = computeStatusVerdict(runDir, { isProcessAlive: () => false });
    expect(info).toMatchObject({ verdict: 'dead', pid: 4242, pidAlive: false });
    expect(typeof info.lastEventAt).toBe('string');
  });

  it('dead verdict without events.ndjson carries lastEventAt: null', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: 4242 });
    const info = computeStatusVerdict(runDir, { isProcessAlive: () => false });
    expect(info).toMatchObject({
      verdict: 'dead',
      pid: 4242,
      pidAlive: false,
      lastEventAt: null,
    });
  });

  it('alive probe carries pid + pidAlive:true alongside the mtime verdict', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: 4242 });
    writeEvents(runDir);
    const info = computeStatusVerdict(runDir, { isProcessAlive: () => true });
    expect(info).toMatchObject({
      verdict: 'active',
      pid: 4242,
      pidAlive: true,
    });
  });

  it('fields are absent when the probe was not consulted (no pid)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { pid: null });
    writeEvents(runDir);
    const info = computeStatusVerdict(runDir, {
      isProcessAlive: () => {
        throw new Error('not consulted');
      },
    });
    expect(info.pid).toBeUndefined();
    expect(info.pidAlive).toBeUndefined();
    expect(info.lastEventAt).toBeUndefined();
  });

  it('fields are absent for terminal runs (completed.json wins)', () => {
    const runDir = makeRunDir();
    writeCompleted(runDir);
    writeRunJson(runDir);
    const info = computeStatusVerdict(runDir);
    expect(info.pidAlive).toBeUndefined();
  });
});

// T004 (plan 025) — the TTY arms are Record<StatusVerdict, …> maps so tsc
// demands an arm per verdict; the old ternary chains ended in default
// fallbacks that would have rendered 'dead' as a dim '?'.
describe('TTY verdict arms (T004)', () => {
  it("has an explicit 'dead' icon distinct from every other verdict", () => {
    const { dead, ...others } = STATUS_VERDICT_ICONS;
    expect(dead).toBe('☠');
    expect(Object.values(others)).not.toContain(dead);
  });

  it("colors 'dead' red — no dim default fall-through", () => {
    expect(STATUS_VERDICT_COLORS.dead).toBe(chalk.red);
    expect(STATUS_VERDICT_COLORS.dead).not.toBe(chalk.dim);
  });

  it('every verdict has an icon and a color arm', () => {
    for (const verdict of [
      'active',
      'dead',
      'stale',
      'completed',
      'failed',
      'unknown',
    ] as const) {
      expect(STATUS_VERDICT_ICONS[verdict]).toBeTruthy();
      expect(typeof STATUS_VERDICT_COLORS[verdict]).toBe('function');
    }
  });
});

// Plan 028 Phase 1 (defect A) — a freshly-booted live-pid run in an ACTIVE
// status with a fresh `updatedAt` is `active` even before events.ndjson exists.
// Today computeStatusVerdict falls to `unknown` here: the pid probe sets the
// diagnostic fields then falls through to the events.ndjson mtime path. The fix
// mirrors the resolver/inventory predicate (run-inventory.ts:204) — freshness
// from manifest.updatedAt — while keeping events.ndjson mtime as a tie-break so
// a stale updatedAt never overrides a genuinely fresh events log.
describe('computeStatusVerdict — defect A: live-pid fail-open (plan 028)', () => {
  const ACTIVE_AT = '2026-06-11T10:00:00.000Z';
  const within = () => Date.parse('2026-06-11T10:00:30.000Z'); // +30s, < 60s
  const beyond = () => Date.parse('2026-06-11T10:02:00.000Z'); // +120s, > 60s

  it('live pid + status:active + fresh updatedAt + NO events.ndjson → active', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { status: 'active', updatedAt: ACTIVE_AT });
    // intentionally no events.ndjson — the defect-A boot window
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => true, now: within })
        .verdict,
    ).toBe('active');
  });

  it('live pid + status:starting + fresh updatedAt + NO events.ndjson → active', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { status: 'starting', updatedAt: ACTIVE_AT });
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => true, now: within })
        .verdict,
    ).toBe('active');
  });

  it('live pid + ACTIVE status + STALE updatedAt + NO events.ndjson → stale (not unknown)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { status: 'active', updatedAt: ACTIVE_AT });
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => true, now: beyond })
        .verdict,
    ).toBe('stale');
  });

  it('a fresh events.ndjson still yields active even when updatedAt is stale (tie-break preserved)', () => {
    const runDir = makeRunDir();
    writeRunJson(runDir, { status: 'active', updatedAt: ACTIVE_AT });
    writeEvents(runDir);
    // real now ≫ updatedAt, but the fresh events log carries the verdict
    expect(
      computeStatusVerdict(runDir, { isProcessAlive: () => true }).verdict,
    ).toBe('active');
  });
});
