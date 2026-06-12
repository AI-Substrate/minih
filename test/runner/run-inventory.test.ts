import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  makeCompleted,
  makeManifest,
} from '../../src/runner/human-view-fixtures.js';
import { isProcessAliveDefault } from '../../src/runner/run-eligibility.js';
import {
  getRunStatuses,
  listRunInventory,
  summarizeStatusRows,
} from '../../src/runner/run-inventory.js';
import { writeManifest } from '../../src/runner/run-manifest.js';

let root: string;
let agentsDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'minih-run-inventory-'));
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

describe('listRunInventory', () => {
  // FT-005 (plan 026 review F005) — inventory rows pass terminalReason
  // through from run.json so `runs` can show WHY a run failed (AC-7).
  it('passes terminalReason through from the manifest', async () => {
    const runId = '2026-06-08T00-00-09-000Z-tr';
    const dir = makeRunDir('alpha', runId);
    await writeManifest(
      dir,
      makeManifest({
        slug: 'alpha',
        runId,
        runDir: dir,
        status: 'failed',
        terminalReason: 'stalled-stream',
      }),
    );

    const rows = await listRunInventory({ agentsDir, all: true });

    expect(rows.find((r) => r.runId === runId)).toMatchObject({
      liveness: 'failed',
      terminalReason: 'stalled-stream',
    });
  });

  it('lists active runs across slugs with label and paramsSummary', async () => {
    const dirA = makeRunDir('alpha', '2026-06-08T00-00-00-000Z-a');
    const dirB = makeRunDir('bravo', '2026-06-08T00-00-01-000Z-b');
    await writeManifest(
      dirA,
      makeManifest({
        slug: 'alpha',
        runId: '2026-06-08T00-00-00-000Z-a',
        runDir: dirA,
        status: 'active',
        pid: 111,
        label: 'id=1',
        paramsSummary: {
          schemaVersion: 1,
          display: { id: '1' },
          truncated: false,
          redactedKeys: [],
        },
        counters: { events: 3, toolCalls: 1, messages: 0, errors: 0 },
      }),
    );
    await writeManifest(
      dirB,
      makeManifest({
        slug: 'bravo',
        runId: '2026-06-08T00-00-01-000Z-b',
        runDir: dirB,
        status: 'active',
        pid: 222,
      }),
    );

    const rows = await listRunInventory({
      agentsDir,
      active: true,
      staleThresholdMs: Number.MAX_SAFE_INTEGER,
      isProcessAlive: () => true,
    });

    expect(rows.map((r) => r.slug).sort()).toEqual(['alpha', 'bravo']);
    expect(rows.find((r) => r.slug === 'alpha')).toMatchObject({
      runId: '2026-06-08T00-00-00-000Z-a',
      liveness: 'active',
      label: 'id=1',
      eventCount: 3,
      toolCallCount: 1,
      paramsSummary: { display: { id: '1' } },
    });
  });

  it('includes completed rows for --all --slug without leaking runDir or velocity', async () => {
    const runId = '2026-06-08T00-00-02-000Z-c';
    const dir = makeRunDir('alpha', runId);
    writeFileSync(
      path.join(dir, 'completed.json'),
      JSON.stringify(
        makeCompleted({
          slug: 'alpha',
          runId,
          sessionId: 'sess-c',
          label: 'done',
          paramsSummary: {
            schemaVersion: 1,
            display: { id: 'done' },
            truncated: false,
            redactedKeys: [],
          },
          velocity: {
            previousDurationMs: 1,
            changePercent: 0,
            runNumber: 99,
            firstDurationMs: 1,
            overallChangePercent: 0,
          },
        }),
      ),
    );

    const rows = await listRunInventory({
      agentsDir,
      all: true,
      slug: 'alpha',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: 'alpha',
      runId,
      liveness: 'completed',
      result: 'completed',
      label: 'done',
    });
    expect(rows[0]).not.toHaveProperty('runDir');
    expect(rows[0]).not.toHaveProperty('velocity');
  });

  // T005 (plan 025, CF-01) — vocabulary unify: a dead pid is 'dead', not
  // 'stale'. Stale stays reserved for live-but-quiet (mtime) runs.
  it("reports 'dead' (not 'stale') for an active manifest with a dead pid", async () => {
    const runId = '2026-06-08T00-00-06-000Z-f';
    const dir = makeRunDir('alpha', runId);
    await writeManifest(
      dir,
      makeManifest({
        slug: 'alpha',
        runId,
        runDir: dir,
        status: 'active',
        pid: 4242,
      }),
    );

    const rows = await listRunInventory({
      agentsDir,
      slug: 'alpha',
      staleThresholdMs: Number.MAX_SAFE_INTEGER,
      isProcessAlive: () => false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.liveness).toBe('dead');
  });

  it("keeps dead rows visible under the --active filter (they were 'stale' before)", async () => {
    const runId = '2026-06-08T00-00-07-000Z-g';
    const dir = makeRunDir('alpha', runId);
    await writeManifest(
      dir,
      makeManifest({
        slug: 'alpha',
        runId,
        runDir: dir,
        status: 'active',
        pid: 4242,
      }),
    );

    const rows = await listRunInventory({
      agentsDir,
      slug: 'alpha',
      active: true,
      staleThresholdMs: Number.MAX_SAFE_INTEGER,
      isProcessAlive: () => false,
    });

    expect(rows.map((r) => r.liveness)).toEqual(['dead']);
  });

  // T010 (plan 025, FX011) — healed runs read 'dead' but leave the --active
  // attention queue (that's what the heal is for).
  it("maps healed manifests (status 'crashed') to 'dead', excluded from --active", async () => {
    const runId = '2026-06-08T00-00-10-000Z-k';
    const dir = makeRunDir('alpha', runId);
    await writeManifest(
      dir,
      makeManifest({
        slug: 'alpha',
        runId,
        runDir: dir,
        status: 'crashed',
        terminalReason: 'pid-vanished',
        pid: 4242,
      }),
    );

    const allRows = await listRunInventory({ agentsDir, slug: 'alpha' });
    expect(allRows).toHaveLength(1);
    expect(allRows[0]).toMatchObject({
      liveness: 'dead',
      manifestStatus: 'crashed',
    });

    const activeRows = await listRunInventory({
      agentsDir,
      slug: 'alpha',
      active: true,
    });
    expect(activeRows).toHaveLength(0);
  });

  // T001 (plan 025, FX009-3) — EPERM means the process exists; the probe's
  // error spec must keep such a run active through this caller too.
  it('keeps a run active when the probe hits EPERM (exists, not ours)', async () => {
    const runId = '2026-06-08T00-00-05-000Z-e';
    const dir = makeRunDir('alpha', runId);
    await writeManifest(
      dir,
      makeManifest({
        slug: 'alpha',
        runId,
        runDir: dir,
        status: 'active',
        pid: 4242,
      }),
    );

    const epermKill = (): void => {
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    };
    const rows = await listRunInventory({
      agentsDir,
      slug: 'alpha',
      staleThresholdMs: Number.MAX_SAFE_INTEGER,
      isProcessAlive: (pid) => isProcessAliveDefault(pid, { kill: epermKill }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.liveness).toBe('active');
  });

  it('returns globally newest rows across slugs before applying limit', async () => {
    for (let i = 0; i < 4; i++) {
      const runId = `2026-06-08T00-00-0${i}-000Z-${i}`;
      const dir = makeRunDir('alpha', runId);
      writeFileSync(
        path.join(dir, 'completed.json'),
        JSON.stringify(makeCompleted({ slug: 'alpha', runId })),
      );
    }
    const newest = '2026-06-08T00-00-09-000Z-z';
    const newestDir = makeRunDir('zulu', newest);
    writeFileSync(
      path.join(newestDir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'zulu', runId: newest })),
    );

    const rows = await listRunInventory({ agentsDir, limit: 2 });

    expect(rows.map((r) => `${r.slug}/${r.runId}`)).toEqual([
      `zulu/${newest}`,
      'alpha/2026-06-08T00-00-03-000Z-3',
    ]);
  });
});

describe('getRunStatuses', () => {
  it('returns row-level missing errors without aborting the batch', async () => {
    const runId = '2026-06-08T00-00-03-000Z-d';
    const dir = makeRunDir('alpha', runId);
    writeFileSync(
      path.join(dir, 'completed.json'),
      JSON.stringify(makeCompleted({ slug: 'alpha', runId })),
    );

    const rows = await getRunStatuses({
      agentsDir,
      targets: [
        { slug: 'alpha', runId },
        { slug: 'alpha', runId: 'missing' },
      ],
    });

    expect(rows[0]).toMatchObject({ found: true, runId });
    expect(rows[1]).toMatchObject({
      found: false,
      error: { code: 'E171' },
    });
    expect(summarizeStatusRows(rows)).toMatchObject({
      total: 2,
      found: 1,
      missing: 1,
      completed: 1,
    });
  });
});
