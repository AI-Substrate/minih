import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  makeCompleted,
  makeManifest,
} from '../../src/runner/human-view-fixtures.js';
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
