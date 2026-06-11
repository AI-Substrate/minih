/**
 * T010 (plan 025, FX011) — `reconcileRuns` healer core.
 *
 * Heals non-terminal manifests whose recorded pid is gone:
 * status → 'crashed', terminalReason → 'pid-vanished' ONLY when unset
 * (preservation invariant AC-FX11.9 / case b2). Idempotent — healed runs
 * leave the probe-eligible set, so a second pass is a no-op.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeManifest } from '../../src/runner/human-view-fixtures.js';
import { reconcileRuns } from '../../src/runner/reconcile.js';
import { writeManifest } from '../../src/runner/run-manifest.js';
import type { LiveRunManifest } from '../../src/runner/types.js';

let root: string;
let agentsDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'minih-reconcile-'));
  agentsDir = path.join(root, 'agents');
  mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeRunDir(slug: string, runId: string): string {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

async function seedRun(
  slug: string,
  runId: string,
  patch: Partial<LiveRunManifest> = {},
): Promise<string> {
  const runDir = makeRunDir(slug, runId);
  await writeManifest(
    runDir,
    makeManifest({
      slug,
      runId,
      runDir,
      status: 'active',
      pid: 4242,
      ...patch,
    }),
  );
  return runDir;
}

function readRunJson(runDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
}

const deadProbe = () => false;
const aliveProbe = () => true;

describe('reconcileRuns', () => {
  it("heals a dead active run to status 'crashed' + terminalReason 'pid-vanished'", async () => {
    const runDir = await seedRun('alpha', '2026-06-11T00-00-00-000Z-a');

    const report = await reconcileRuns({
      agentsDir,
      isProcessAlive: deadProbe,
    });

    expect(report.healed).toEqual([
      {
        slug: 'alpha',
        runId: '2026-06-11T00-00-00-000Z-a',
        pid: 4242,
        previousStatus: 'active',
      },
    ]);
    const manifest = readRunJson(runDir);
    expect(manifest.status).toBe('crashed');
    expect(manifest.terminalReason).toBe('pid-vanished');
  });

  it('case b2: never overwrites an existing terminalReason (preservation invariant)', async () => {
    const runDir = await seedRun('alpha', '2026-06-11T00-00-01-000Z-b', {
      terminalReason: 'provider-stream-aborted',
    });

    const report = await reconcileRuns({
      agentsDir,
      isProcessAlive: deadProbe,
    });

    expect(report.healed).toHaveLength(1);
    const manifest = readRunJson(runDir);
    expect(manifest.status).toBe('crashed');
    expect(manifest.terminalReason).toBe('provider-stream-aborted');
  });

  it('is idempotent — a second pass heals nothing', async () => {
    await seedRun('alpha', '2026-06-11T00-00-02-000Z-c');

    const first = await reconcileRuns({ agentsDir, isProcessAlive: deadProbe });
    const second = await reconcileRuns({
      agentsDir,
      isProcessAlive: deadProbe,
    });

    expect(first.healed).toHaveLength(1);
    expect(second.healed).toHaveLength(0);
  });

  it('never touches runs with completed.json (probe not even called)', async () => {
    const runDir = await seedRun('alpha', '2026-06-11T00-00-03-000Z-d', {
      status: 'completed',
    });
    writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify({ result: 'completed', sessionId: 'sess-1' }),
    );
    const throwing = vi.fn(() => {
      throw new Error('probe must not run for terminal runs');
    });

    const report = await reconcileRuns({ agentsDir, isProcessAlive: throwing });

    expect(report.healed).toHaveLength(0);
    expect(throwing).not.toHaveBeenCalled();
    expect(readRunJson(runDir).status).toBe('completed');
  });

  it('leaves live runs untouched', async () => {
    const runDir = await seedRun('alpha', '2026-06-11T00-00-04-000Z-e');

    const report = await reconcileRuns({
      agentsDir,
      isProcessAlive: aliveProbe,
    });

    expect(report.healed).toHaveLength(0);
    expect(readRunJson(runDir).status).toBe('active');
  });

  it('skips non-terminal runs without a pid (no proof of death)', async () => {
    const runDir = await seedRun('alpha', '2026-06-11T00-00-05-000Z-f', {
      pid: null as unknown as number,
    });

    const report = await reconcileRuns({
      agentsDir,
      isProcessAlive: deadProbe,
    });

    expect(report.healed).toHaveLength(0);
    expect(report.skipped.noPid).toBe(1);
    expect(readRunJson(runDir).status).toBe('active');
  });

  it('scopes to a single slug and runId when asked', async () => {
    const target = await seedRun('alpha', '2026-06-11T00-00-06-000Z-g');
    const other = await seedRun('alpha', '2026-06-11T00-00-07-000Z-h');
    const otherSlug = await seedRun('bravo', '2026-06-11T00-00-08-000Z-i');

    const report = await reconcileRuns({
      agentsDir,
      slug: 'alpha',
      runId: '2026-06-11T00-00-06-000Z-g',
      isProcessAlive: deadProbe,
    });

    expect(report.healed.map((h) => h.runId)).toEqual([
      '2026-06-11T00-00-06-000Z-g',
    ]);
    expect(readRunJson(target).status).toBe('crashed');
    expect(readRunJson(other).status).toBe('active');
    expect(readRunJson(otherSlug).status).toBe('active');
  });

  it('healed run.json stays valid JSON with all prior fields intact', async () => {
    const runDir = await seedRun('alpha', '2026-06-11T00-00-09-000Z-j', {
      label: 'important-run',
      sessionId: 'sess-keep',
    });

    await reconcileRuns({ agentsDir, isProcessAlive: deadProbe });

    const manifest = readRunJson(runDir);
    expect(manifest).toMatchObject({
      status: 'crashed',
      terminalReason: 'pid-vanished',
      label: 'important-run',
      sessionId: 'sess-keep',
      slug: 'alpha',
    });
  });
});
