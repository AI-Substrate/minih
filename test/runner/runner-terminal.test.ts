import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { styleTerminalReason } from '../../src/cli/commands/status.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { makeManifest } from '../../src/runner/human-view-fixtures.js';
import { isCleanTerminalReason } from '../../src/runner/index.js';
import { reconcileRuns } from '../../src/runner/reconcile.js';
import { writeManifest } from '../../src/runner/run-manifest.js';
import { runAgent } from '../../src/runner/runner.js';
import type { LiveRunManifest } from '../../src/runner/types.js';
import { validSystemOutput } from '../helpers/fixtures.js';

// Plan 028 Phase 4 — Terminal classification (G).
// Clean terminals (degraded / farewell / operator-stop / idle) must be recorded
// DISTINCT from a crash. These tests pin the runner write-path + the reconcile
// honouring; the idle TRIGGER stays out of scope (#49, Finding 09).

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-terminal-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Minimal on-disk agent seed (mirrors runner.test.ts; no shared factory). */
function createAgent(slug: string, opts: { schema?: object | null } = {}) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Test agent"\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  if (opts.schema !== null) {
    fs.writeFileSync(
      path.join(agentDir, 'output-schema.json'),
      JSON.stringify(
        opts.schema ?? {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
      ),
    );
  }
  return resolveAgent(slug, tmpDir);
}

function readManifest(runDir: string) {
  return JSON.parse(
    fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'),
  ) as Record<string, unknown>;
}

describe('terminal classification — degraded (T001/T002)', () => {
  it('records manifest.status:completed for a degraded run (completed.json.result stays degraded)', async () => {
    const def = createAgent('terminal-degraded');
    // System fields valid, but the user schema's required `result` is missing
    // → agentSucceeded + validated:false ⇒ result:'degraded' (a clean schema nit).
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ wrong: 'field' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'terminal-degraded' },
      undefined,
      tmpDir,
    );

    // completed.json keeps the honest `degraded` result …
    expect(result.metadata.result).toBe('degraded');
    // … but the live manifest must read `completed`, NOT `failed` (AC-G).
    const manifest = readManifest(result.runDir);
    expect(manifest.status).toBe('completed');
  });
});

/** Seed a dead-pid run record under tmpDir (the agents dir) for reconcile. */
async function seedReconcileRun(
  slug: string,
  runId: string,
  patch: Partial<LiveRunManifest>,
): Promise<string> {
  const runDir = path.join(tmpDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  await writeManifest(
    runDir,
    makeManifest({
      slug,
      runId,
      runDir,
      status: 'completing',
      pid: 999999,
      ...patch,
    }),
  );
  return runDir;
}

describe('terminal classification — farewell / cleanStop (T003/T004)', () => {
  it('reconcile keeps a dead-pid run with a cleanStop marker as completed, not crashed', async () => {
    const runDir = await seedReconcileRun(
      'farewelled',
      '2026-06-16T00-00-00-000Z-a',
      { status: 'completing', pid: 999999, cleanStop: true },
    );

    const report = await reconcileRuns({
      agentsDir: tmpDir,
      isProcessAlive: () => false, // pid is gone
    });

    const manifest = readManifest(runDir);
    // Clean stop → completed, NOT a crash diagnosis.
    expect(manifest.status).toBe('completed');
    expect(manifest.terminalReason).not.toBe('pid-vanished');
    // It is reconciled-clean, never "healed" (which means crashed).
    expect(report.healed).toEqual([]);
    expect(report.reconciledClean.map((r) => r.runId)).toEqual([
      '2026-06-16T00-00-00-000Z-a',
    ]);
  });

  it('still crashes a dead-pid run with NO clean-stop marker (regression guard)', async () => {
    const runDir = await seedReconcileRun(
      'orphan',
      '2026-06-16T00-00-00-000Z-b',
      {
        status: 'active',
        pid: 999998,
      },
    );

    await reconcileRuns({ agentsDir: tmpDir, isProcessAlive: () => false });

    const manifest = readManifest(runDir);
    expect(manifest.status).toBe('crashed');
    expect(manifest.terminalReason).toBe('pid-vanished');
  });

  it('a clean run records cleanStop + farewellAt on the manifest (producer)', async () => {
    const def = createAgent('clean-farewell');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'clean-farewell' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    const manifest = readManifest(result.runDir);
    expect(manifest.cleanStop).toBe(true);
    expect(typeof manifest.farewellAt).toBe('number');
  });
});

describe('terminal classification — clean reasons render non-red (T005/T006)', () => {
  it('classifies the 3 new clean reasons as clean; failure reasons as not', () => {
    for (const reason of ['operator-stop', 'idle-budget', 'no-engagement']) {
      expect(isCleanTerminalReason(reason)).toBe(true);
    }
    for (const reason of [
      'timeout',
      'pid-vanished',
      'permission-denied',
      'stalled-stream',
      'max-turns',
    ]) {
      expect(isCleanTerminalReason(reason)).toBe(false);
    }
    expect(isCleanTerminalReason(null)).toBe(false);
    expect(isCleanTerminalReason(undefined)).toBe(false);
  });

  it('status render styles a clean reason dim (not red), a failure reason red', () => {
    const prev = chalk.level;
    chalk.level = 1; // force ANSI so the branch is observable in a non-TTY test
    try {
      const RED = '\x1b[31m';
      // Clean reason → NOT red.
      expect(styleTerminalReason('operator-stop')).not.toContain(RED);
      expect(styleTerminalReason('idle-budget')).not.toContain(RED);
      // Failure reason → still red.
      expect(styleTerminalReason('timeout')).toContain(RED);
      expect(styleTerminalReason('pid-vanished')).toContain(RED);
    } finally {
      chalk.level = prev;
    }
  });
});
