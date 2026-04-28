import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeManifest } from '../../src/runner/human-view-fixtures.js';
import { writeManifest } from '../../src/runner/run-manifest.js';
import { resolveRun } from '../../src/runner/run-resolver.js';

let agentsDir: string;
let cwd: string;
let originalCwd: string;

function makeRunFolder(slug: string, runId: string): string {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'minih-resolver-test-'));
  agentsDir = path.join(cwd, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe('resolveRun by-id', () => {
  it('returns the named run by slug + runId', async () => {
    const runDir = makeRunFolder('demo', '01HRUN_BYID_AAAAAAAAAAAAAA');
    await writeManifest(
      runDir,
      makeManifest({
        runDir,
        slug: 'demo',
        runId: '01HRUN_BYID_AAAAAAAAAAAAAA',
        status: 'active',
      }),
    );
    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'by-id', runId: '01HRUN_BYID_AAAAAAAAAAAAAA' },
      staleThresholdMs: Number.MAX_SAFE_INTEGER,
    });
    expect(result?.runId).toBe('01HRUN_BYID_AAAAAAAAAAAAAA');
    expect(result?.liveness).toBe('active');
  });

  it('returns null when by-id runId does not exist', async () => {
    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'by-id', runId: 'does-not-exist' },
    });
    expect(result).toBeNull();
  });

  it('returns null when slug does not exist', async () => {
    const result = await resolveRun({
      slug: 'never-was',
      mode: { kind: 'by-id', runId: 'irrelevant' },
    });
    expect(result).toBeNull();
  });
});

describe('resolveRun latest-active', () => {
  it('returns the single active run when one exists', async () => {
    const runDir = makeRunFolder('demo', '01HRUN_ACTIVE_SOLO_AAAAAAA');
    await writeManifest(
      runDir,
      makeManifest({
        runDir,
        slug: 'demo',
        runId: '01HRUN_ACTIVE_SOLO_AAAAAAA',
        status: 'active',
      }),
    );
    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'latest-active' },
    });
    expect(result?.runId).toBe('01HRUN_ACTIVE_SOLO_AAAAAAA');
  });

  it('throws MultipleActiveRunsError listing candidates when more than one is active', async () => {
    const runIdA = '01HRUN_ACTIVE_AAAAAAAAAAAAAAA';
    const runIdB = '01HRUN_ACTIVE_BBBBBBBBBBBBBBB';
    const dirA = makeRunFolder('demo', runIdA);
    const dirB = makeRunFolder('demo', runIdB);
    await writeManifest(
      dirA,
      makeManifest({
        runDir: dirA,
        slug: 'demo',
        runId: runIdA,
        status: 'active',
        sessionId: 'sess-a',
        startedAt: '2026-04-28T00:00:00.000Z',
      }),
    );
    await writeManifest(
      dirB,
      makeManifest({
        runDir: dirB,
        slug: 'demo',
        runId: runIdB,
        status: 'active',
        sessionId: 'sess-b',
        startedAt: '2026-04-28T00:00:01.000Z',
      }),
    );

    await expect(
      resolveRun({ slug: 'demo', mode: { kind: 'latest-active' } }),
    ).rejects.toMatchObject({
      name: 'MultipleActiveRunsError',
      candidates: expect.arrayContaining([
        expect.objectContaining({ runId: runIdA, sessionId: 'sess-a' }),
        expect.objectContaining({ runId: runIdB, sessionId: 'sess-b' }),
      ]),
    });
  });

  it('returns null when no active run exists', async () => {
    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'latest-active' },
    });
    expect(result).toBeNull();
  });

  it('per-candidate fault tolerance: skips a torn manifest and returns the healthy active run', async () => {
    const runIdGood = '01HRUN_ACTIVE_GOOD_AAAAAAAAA';
    const runIdBad = '01HRUN_ACTIVE_BAD_AAAAAAAAAA';
    const dirGood = makeRunFolder('demo', runIdGood);
    const dirBad = makeRunFolder('demo', runIdBad);
    await writeManifest(
      dirGood,
      makeManifest({
        runDir: dirGood,
        slug: 'demo',
        runId: runIdGood,
        status: 'active',
      }),
    );
    writeFileSync(path.join(dirBad, 'run.json'), '{torn');

    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'latest-active' },
    });
    expect(result?.runId).toBe(runIdGood);
    expect(result?.diagnostics.some((d) => d.runId === runIdBad)).toBe(true);
  });

  it('reports liveness "stale" when manifest updatedAt exceeds the threshold', async () => {
    const runId = '01HRUN_ACTIVE_STALE_AAAAAAAA';
    const dir = makeRunFolder('demo', runId);
    await writeManifest(
      dir,
      makeManifest({
        runDir: dir,
        slug: 'demo',
        runId,
        status: 'active',
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'latest-active' },
      staleThresholdMs: 1000,
    });
    expect(result?.liveness).toBe('stale');
  });
});

describe('resolveRun latest-completed', () => {
  it('falls back to a completed run via completed.json', async () => {
    const runId = '01HRUN_COMPLETED_AAAAAAAAAAA';
    const dir = makeRunFolder('demo', runId);
    writeFileSync(
      path.join(dir, 'completed.json'),
      JSON.stringify({
        slug: 'demo',
        runId,
        startedAt: '2026-04-28T00:00:00.000Z',
        completedAt: '2026-04-28T00:00:10.000Z',
        durationMs: 10000,
        sessionId: 'sess-c',
        result: 'completed',
        exitCode: 0,
        validated: true,
        validationErrors: [],
        systemValidated: true,
        userValidated: true,
        eventCount: 1,
        toolCallCount: 0,
        artifacts: [],
      }),
    );
    const result = await resolveRun({
      slug: 'demo',
      mode: { kind: 'latest-completed' },
    });
    expect(result?.runId).toBe(runId);
    expect(result?.liveness).toBe('completed');
  });
});
