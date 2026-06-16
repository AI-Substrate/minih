import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { reconcileRuns } from '../../src/runner/reconcile.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

// Plan 028 Phase 4 — C-F001 (companion HIGH). The clean-stop marker must be
// stamped on the live manifest the moment the agent resolves cleanly (the
// 'completing' transition), NOT only in the terminal patch. Otherwise a process
// killed during the finalization window (drain / validate / completed.json
// write, all AFTER a clean farewell) leaves a PROBE-status manifest with no
// marker, which reconcile mis-diagnoses as a crash.
//
// We simulate that kill deterministically: `completed.json` is written with
// `fs.writeFileSync` (node:fs), while the manifest is written via node:fs/
// promises (atomic). Mocking node:fs to throw on the completed.json write
// stops the runner in the finalization window — exactly where a SIGKILL would
// land — without touching the manifest writes that precede it.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const writeFileSync: typeof actual.writeFileSync = (p, data, options) => {
    if (typeof p === 'string' && p.endsWith('completed.json')) {
      throw new Error('simulated crash during finalization (completed.json)');
    }
    return actual.writeFileSync(p, data, options);
  };
  return { ...actual, default: actual, writeFileSync };
});

// Imported AFTER the mock so the test's own fs calls use the mocked module
// (harmless — it only throws for completed.json writes, which the test never makes).
import * as fs from 'node:fs';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-finalcrash-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Minimal on-disk agent seed (mirrors runner-terminal.test.ts). */
function createAgent(slug: string) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Test agent"\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  fs.writeFileSync(
    path.join(agentDir, 'output-schema.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'string' } },
    }),
  );
  return resolveAgent(slug, tmpDir);
}

function readManifest(runDir: string) {
  return JSON.parse(
    fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'),
  ) as Record<string, unknown>;
}

function onlyRunDir(slug: string): string {
  const runsDir = path.join(tmpDir, slug, 'runs');
  const entries = fs.readdirSync(runsDir);
  expect(entries).toHaveLength(1);
  return path.join(runsDir, entries[0]);
}

describe('C-F001 — active-phase clean-stop producer (killed mid-finalization)', () => {
  it('stamps cleanStop on the still-PROBE manifest before the terminal patch, so a mid-finalization kill reconciles clean', async () => {
    const def = createAgent('finalize-crash');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });

    // The agent resolves cleanly, then the process "dies" during finalization
    // (completed.json write throws) — BEFORE the terminal manifest patch runs.
    await expect(
      runAgent(fake, def, { slug: 'finalize-crash' }, undefined, tmpDir),
    ).rejects.toThrow(/simulated crash/);

    const runDir = onlyRunDir('finalize-crash');
    const manifest = readManifest(runDir);
    // The terminal patch never ran → status is still the PROBE 'completing' …
    expect(manifest.status).toBe('completing');
    // … but the active-phase producer already stamped the clean-stop marker
    // (the gap C-F001 named: marker was previously coupled to the terminal patch).
    expect(manifest.cleanStop).toBe(true);

    // A later dead-pid reconcile honours the marker → completed, NOT crashed.
    const report = await reconcileRuns({
      agentsDir: tmpDir,
      isProcessAlive: () => false,
    });
    expect(readManifest(runDir).status).toBe('completed');
    expect(report.healed).toEqual([]);
    expect(report.reconciledClean.map((r) => r.runId)).toContain(
      path.basename(runDir),
    );
  });
});
