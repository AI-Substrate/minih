/**
 * F003 fix pass (plan 025 review, AC-10) — the human/TTY render path for the
 * 'dead' verdict, exercised for real: a child node process forces
 * `process.stderr.isTTY` before importing the built CLI, so the TTY branch
 * runs and its output is captured from the pipe (NO_COLOR keeps it plain).
 *
 * Covers BOTH routes into the dead arm:
 *  - an unhealed dead-pid manifest (real probe, pid > PID_MAX), and
 *  - a healed `status: 'crashed'` manifest whose pid is ALIVE (this very
 *    process) — proving the no-re-probe rule holds in the human path too.
 *
 * The crashed-vs-unhealed *machine* distinction is the runs surface
 * (`manifestStatus`), covered by runs.test.ts / run-inventory.test.ts.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');
const DEAD_PID = 99_999_999;

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-tty-render-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A wrapper FILE (not `node -e`): commander v13 detects the eval context via
// process.execArgv and slices argv differently, breaking command resolution.
const WRAPPER_SOURCE = [
  "import { pathToFileURL } from 'node:url';",
  "Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });",
  'const [cliPath, ...rest] = process.argv.slice(2);',
  'process.argv = [process.argv[0], cliPath, ...rest];',
  'await import(pathToFileURL(cliPath).href);',
  '',
].join('\n');

function cliWithTTY(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const wrapperPath = path.join(tmpDir, 'force-tty-wrapper.mjs');
  if (!fs.existsSync(wrapperPath)) {
    fs.writeFileSync(wrapperPath, WRAPPER_SOURCE);
  }
  const result = spawnSync('node', [wrapperPath, cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function makeFixtureRun(
  slug: string,
  runId: string,
  manifestPatch: Record<string, unknown>,
): void {
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
}

describe('status TTY render (forced isTTY, built CLI)', () => {
  it('unhealed dead-pid manifest renders the dead arm with the explanation line', () => {
    const runId = '2026-06-11T00-00-00-000Z-tty-dead';
    makeFixtureRun('demo', runId, { pid: DEAD_PID });

    const result = cliWithTTY([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('☠ dead');
    expect(result.stderr).toContain(
      `Process ${DEAD_PID} is gone — run never completed.`,
    );
    // stdout stays the machine envelope.
    expect(JSON.parse(result.stdout).data.verdict).toBe('dead');
  });

  it("healed 'crashed' manifest renders the dead arm even though its pid is alive", () => {
    const runId = '2026-06-11T00-00-01-000Z-tty-crashed';
    makeFixtureRun('demo', runId, {
      pid: process.pid, // alive — render must come from the heal, not a probe
      status: 'crashed',
      terminalReason: 'pid-vanished',
    });

    const result = cliWithTTY([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('☠ dead');
    expect(result.stderr).toContain(`Process ${process.pid} is gone`);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.verdict).toBe('dead');
    expect(envelope.data.pidAlive).toBe(false);
    expect(envelope.data.terminalReason).toBe('pid-vanished');
  });
});
