/**
 * T006 (plan 025, AC-11) — reaped-pid smokes through the BUILT CLI with the
 * REAL probe. Confirmatory only: the deterministic proof load is carried by
 * the injected-predicate matrix in status-verdict.test.ts (PL-08).
 *
 * Budget: ≤2 spawn-based tests. The corpse is `node -e "process.exit(0)"`,
 * awaited to exit (libuv reaps it), so its pid is genuinely gone.
 *
 * Targeting note: smokes resolve by `--run <runId>`. Plain `status <slug>`
 * on a slug whose ONLY run is a dead-pid active manifest returns E171 — the
 * resolver's active-collection filters dead pids (plan 016) and the
 * completed fallback requires completed.json. Pre-existing resolver
 * behavior, deliberately out of scope this plan (see run-liveness.md).
 */

import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-dead-smoke-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function cli(args: string[]): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout.toString('utf8') };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString('utf8') ?? '',
    };
  }
}

function makeFixtureRun(
  slug: string,
  runId: string,
  manifestPatch: Record<string, unknown>,
): string {
  const agentDir = path.join(agentsDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    ['---', 'description: demo', '---', '', 'hello'].join('\n'),
  );
  const runDir = path.join(agentDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug,
      runId,
      runDir,
      pid: 12345,
      startedAt: '2026-06-11T10:00:00.000Z',
      updatedAt: new Date().toISOString(),
      status: 'active',
      sessionId: 'sess-1',
      model: null,
      control: { available: false, kind: 'none' },
      counters: { events: 1, toolCalls: 0, messages: 1, errors: 0 },
      ...manifestPatch,
    }),
  );
  fs.writeFileSync(
    path.join(runDir, 'events.ndjson'),
    '{"type":"message","timestamp":"2026-06-11T10:00:00.000Z","data":{"content":"hi"}}\n',
  );
  return runDir;
}

/** Spawn a process that exits immediately and wait until it is reaped. */
async function spawnCorpse(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'ignore',
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('spawn failed to produce a pid');
  await new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  return pid;
}

describe('status dead-pid smokes (real probe, built CLI)', () => {
  it("(a) reaped corpse pid → verdict 'dead' with probe diagnostics", async () => {
    const corpsePid = await spawnCorpse();
    const runId = '2026-06-11T00-00-00-000Z-corpse';
    makeFixtureRun('demo', runId, { pid: corpsePid });

    const result = cli([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data).toMatchObject({
      verdict: 'dead',
      pid: corpsePid,
      pidAlive: false,
    });
    expect(typeof envelope.data.lastEventAt).toBe('string');
  });

  it("(b) live twin (process.pid) → verdict 'active'", () => {
    const runId = '2026-06-11T00-00-01-000Z-live';
    makeFixtureRun('demo', runId, { pid: process.pid });

    const result = cli([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data).toMatchObject({
      verdict: 'active',
      pid: process.pid,
      pidAlive: true,
    });
  });

  // T004 Done-When (terminalReason passthrough) — no spawns: the fixture pid
  // exceeds PID_MAX on macOS/Linux so the real probe reports it gone.
  it('passes every terminalReason value through the envelope verbatim', () => {
    for (const reason of [
      'permission-denied',
      'provider-stream-aborted',
      'pid-vanished',
    ]) {
      const runId = `2026-06-11T00-00-02-000Z-${reason}`;
      makeFixtureRun('demo', runId, {
        pid: 99_999_999,
        terminalReason: reason,
      });

      const result = cli([
        '--agents-dir',
        agentsDir,
        'status',
        'demo',
        '--run',
        runId,
      ]);

      expect(result.exitCode).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.data.terminalReason).toBe(reason);
      expect(envelope.data.verdict).toBe('dead');
    }
  });
});
