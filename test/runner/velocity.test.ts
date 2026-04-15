/**
 * Velocity computation tests.
 * Tests the computeVelocity function with real fixture folders.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeVelocity } from '../../src/runner/runner.js';

describe('computeVelocity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(import.meta.dirname ?? __dirname, 'tmp-velocity-'),
    );
    fs.mkdirSync(path.join(tmpDir, 'runs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRun(
    runId: string,
    result: string,
    durationMs: number,
    velocity?: Record<string, unknown>,
  ) {
    const runDir = path.join(tmpDir, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const meta: Record<string, unknown> = {
      slug: 'test-agent',
      runId,
      result,
      durationMs,
    };
    if (velocity) meta.velocity = velocity;
    fs.writeFileSync(path.join(runDir, 'completed.json'), JSON.stringify(meta));
  }

  it('returns runNumber=1 for first run with no history', () => {
    const v = computeVelocity(5000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(1);
    expect(v.previousDurationMs).toBeNull();
    expect(v.changePercent).toBeNull();
    expect(v.firstDurationMs).toBe(5000);
    expect(v.overallChangePercent).toBeNull();
  });

  it('computes velocity from previous completed run', () => {
    writeRun('2026-04-10T00-00-00Z-0001', 'completed', 10000);

    const v = computeVelocity(8000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(2);
    expect(v.previousDurationMs).toBe(10000);
    expect(v.changePercent).toBe(-20); // 20% faster
    expect(v.firstDurationMs).toBe(10000);
    expect(v.overallChangePercent).toBe(-20);
  });

  it('skips failed runs', () => {
    writeRun('2026-04-10T00-00-00Z-0001', 'completed', 10000);
    writeRun('2026-04-11T00-00-00Z-0002', 'failed', 3000);

    const v = computeVelocity(7000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(2);
    expect(v.previousDurationMs).toBe(10000);
  });

  it('skips degraded runs', () => {
    writeRun('2026-04-10T00-00-00Z-0001', 'completed', 10000);
    writeRun('2026-04-11T00-00-00Z-0002', 'degraded', 3000);

    const v = computeVelocity(7000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(2);
    expect(v.previousDurationMs).toBe(10000);
  });

  it('chains from prior velocity block (O(1))', () => {
    writeRun('2026-04-10T00-00-00Z-0001', 'completed', 20000, {
      previousDurationMs: null,
      changePercent: null,
      runNumber: 1,
      firstDurationMs: 20000,
      overallChangePercent: null,
    });
    writeRun('2026-04-11T00-00-00Z-0002', 'completed', 15000, {
      previousDurationMs: 20000,
      changePercent: -25,
      runNumber: 2,
      firstDurationMs: 20000,
      overallChangePercent: -25,
    });

    const v = computeVelocity(10000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(3);
    expect(v.previousDurationMs).toBe(15000);
    expect(v.firstDurationMs).toBe(20000);
    expect(v.overallChangePercent).toBe(-50);
  });

  it('handles legacy runs without velocity block', () => {
    writeRun('2026-04-10T00-00-00Z-0001', 'completed', 20000);
    writeRun('2026-04-11T00-00-00Z-0002', 'completed', 15000);

    const v = computeVelocity(10000, tmpDir, 'current-run');
    expect(v.previousDurationMs).toBe(15000);
    expect(v.firstDurationMs).toBe(20000);
  });

  it('handles corrupted completed.json gracefully', () => {
    const runDir = path.join(tmpDir, 'runs', '2026-04-10T00-00-00Z-0001');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'completed.json'), 'not valid json');

    const v = computeVelocity(5000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(1);
    expect(v.previousDurationMs).toBeNull();
  });

  it('handles all-failed history', () => {
    writeRun('2026-04-10T00-00-00Z-0001', 'failed', 10000);
    writeRun('2026-04-11T00-00-00Z-0002', 'timeout', 20000);

    const v = computeVelocity(5000, tmpDir, 'current-run');
    expect(v.runNumber).toBe(1);
    expect(v.previousDurationMs).toBeNull();
  });
});
