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
  // FX009 — these tests synthesise manifests with PIDs that aren't alive
  // in the test process; they're testing OTHER resolver behaviours
  // (multi-active throwing, torn-manifest tolerance, stale-threshold).
  // Bypass the PID-liveness filter by injecting "always alive". The
  // dedicated PID-liveness regression test lives further down.
  const allAlive = () => true;

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
      isProcessAlive: allAlive,
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
      resolveRun({
        slug: 'demo',
        mode: { kind: 'latest-active' },
        isProcessAlive: allAlive,
      }),
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
      isProcessAlive: allAlive,
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
      isProcessAlive: allAlive,
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
      isProcessAlive: allAlive,
    });
    expect(result?.liveness).toBe('stale');
  });

  // FX009 — PID-liveness filter regression. A manifest claiming active
  // with a dead PID must be skipped, NOT counted toward MultipleActiveRunsError.
  // Two-run fixture: one fake-live PID, one fake-dead PID. The injected
  // predicate decides which is which without any platform assumptions.
  describe('FX009 — PID-liveness filter (resolves MW11)', () => {
    const FAKE_LIVE_PID = 12345;
    const FAKE_DEAD_PID = 99999;
    const isAlive = (pid: number): boolean => pid === FAKE_LIVE_PID;

    it('skips a manifest with status="active" but dead PID and returns the live one', async () => {
      const liveRunId = '01HRUN_FX009_LIVE_AAAAAAAAAA';
      const deadRunId = '01HRUN_FX009_DEAD_AAAAAAAAAA';
      const liveDir = makeRunFolder('demo', liveRunId);
      const deadDir = makeRunFolder('demo', deadRunId);
      await writeManifest(
        liveDir,
        makeManifest({
          runDir: liveDir,
          slug: 'demo',
          runId: liveRunId,
          status: 'active',
          pid: FAKE_LIVE_PID,
        }),
      );
      await writeManifest(
        deadDir,
        makeManifest({
          runDir: deadDir,
          slug: 'demo',
          runId: deadRunId,
          status: 'active',
          pid: FAKE_DEAD_PID,
        }),
      );

      const result = await resolveRun({
        slug: 'demo',
        mode: { kind: 'latest-active' },
        isProcessAlive: isAlive,
      });

      expect(result?.runId).toBe(liveRunId);
      // Diagnostic for the skipped stale-active candidate is recorded so
      // the CLI can surface it (FX009-4).
      expect(
        result?.diagnostics.some(
          (d) =>
            d.runId === deadRunId &&
            d.message.includes(`pid ${FAKE_DEAD_PID} is dead`),
        ),
      ).toBe(true);
    });

    it('returns null instead of MultipleActiveRunsError when only stale-active candidates exist', async () => {
      const dead1 = '01HRUN_FX009_DEAD1_AAAAAAAAA';
      const dead2 = '01HRUN_FX009_DEAD2_AAAAAAAAA';
      const dir1 = makeRunFolder('demo', dead1);
      const dir2 = makeRunFolder('demo', dead2);
      await writeManifest(
        dir1,
        makeManifest({
          runDir: dir1,
          slug: 'demo',
          runId: dead1,
          status: 'active',
          pid: FAKE_DEAD_PID,
        }),
      );
      await writeManifest(
        dir2,
        makeManifest({
          runDir: dir2,
          slug: 'demo',
          runId: dead2,
          status: 'active',
          pid: FAKE_DEAD_PID + 1,
        }),
      );

      const result = await resolveRun({
        slug: 'demo',
        mode: { kind: 'latest-active' },
        isProcessAlive: isAlive,
      });

      expect(result).toBeNull(); // no active candidates left after filter
    });

    it('does NOT filter manifests where pid is null (freshly-booting runs)', async () => {
      const runId = '01HRUN_FX009_NOPID_AAAAAAAAA';
      const dir = makeRunFolder('demo', runId);
      const m = makeManifest({
        runDir: dir,
        slug: 'demo',
        runId,
        status: 'starting',
      });
      // Force pid:null to simulate a brand-new run that hasn't written its
      // pid yet. The filter must NOT drop these — let the time-based stale
      // threshold catch them later if they're truly dead.
      await writeManifest(dir, { ...m, pid: null as unknown as number });

      const result = await resolveRun({
        slug: 'demo',
        mode: { kind: 'latest-active' },
        // Predicate would reject any pid (always false) — but null pid
        // never reaches it, so the run still resolves.
        isProcessAlive: () => false,
      });
      expect(result?.runId).toBe(runId);
    });
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
