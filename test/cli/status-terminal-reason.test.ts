/**
 * Plan 026 T008 — status surfacing of the new budget terminal reasons:
 * the machine envelope passes `terminalReason` through end-to-end for a
 * seeded terminalized run, the TTY arm prints a `Reason:` line, and the
 * E170 ambiguity remedy mentions `--latest`. Built CLI; forced-TTY wrapper
 * follows the status-tty-render.test.ts precedent (plan 025 AC-10).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-status-reason-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { exitCode: number; stdout: string } {
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

// Wrapper FILE (not `node -e`) — commander v13 detects eval contexts via
// process.execArgv and slices argv differently (see status-tty-render).
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
  options: { completed?: Record<string, unknown> } = {},
): void {
  const agentDir = path.join(agentsDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  const promptPath = path.join(agentDir, 'prompt.md');
  if (!fs.existsSync(promptPath)) {
    fs.writeFileSync(
      promptPath,
      ['---', 'description: demo', '---', '', 'hello'].join('\n'),
    );
  }
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
      counters: { events: 2, toolCalls: 0, messages: 1, errors: 0 },
      ...manifestPatch,
    }),
  );
  fs.writeFileSync(
    path.join(runDir, 'events.ndjson'),
    [
      '{"type":"message","timestamp":"2026-06-11T10:00:00.000Z","data":{"content":"hi"}}',
      '{"type":"run_stalled","timestamp":"2026-06-11T10:05:00.000Z","data":{"stallTimeoutSec":300}}',
      '',
    ].join('\n'),
  );
  if (options.completed) {
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify({
        slug,
        runId,
        startedAt: '2026-06-11T10:00:00.000Z',
        completedAt: '2026-06-11T10:05:00.000Z',
        durationMs: 300_000,
        sessionId: 'sess-1',
        exitCode: 124,
        validated: null,
        validationErrors: [],
        eventCount: 2,
        toolCallCount: 0,
        artifacts: [],
        ...options.completed,
      }),
    );
  }
}

describe('status terminal-reason surfacing (plan 026 T008)', () => {
  it('envelope passes stalled-stream through for a seeded terminalized run', () => {
    const runId = '2026-06-11T00-00-00-000Z-stalled';
    makeFixtureRun(
      'demo',
      runId,
      { status: 'failed', terminalReason: 'stalled-stream' },
      { completed: { result: 'failed' } },
    );

    const result = run([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.data.terminalReason).toBe('stalled-stream');
    expect(envelope.data.result).toBe('failed');
  });

  it('TTY arm prints a Reason line when terminalReason is present', () => {
    const runId = '2026-06-11T00-00-01-000Z-stalled-tty';
    makeFixtureRun(
      'demo',
      runId,
      { status: 'failed', terminalReason: 'stalled-stream' },
      { completed: { result: 'failed' } },
    );

    const result = cliWithTTY([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Reason:\s+stalled-stream/);
  });

  it('TTY arm prints no Reason line for a clean run', () => {
    const runId = '2026-06-11T00-00-02-000Z-clean';
    makeFixtureRun(
      'demo',
      runId,
      { status: 'completed' },
      { completed: { result: 'completed', exitCode: 0 } },
    );

    const result = cliWithTTY([
      '--agents-dir',
      agentsDir,
      'status',
      'demo',
      '--run',
      runId,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/Reason:/);
  });

  it('E170 ambiguity remedy mentions --latest', () => {
    // Two active runs with a live pid (this process) → MultipleActiveRunsError.
    makeFixtureRun('demo', '2026-06-11T00-00-03-000Z-a', {
      status: 'active',
      pid: process.pid,
    });
    makeFixtureRun('demo', '2026-06-11T00-00-04-000Z-b', {
      status: 'active',
      pid: process.pid,
    });

    const result = run(['--agents-dir', agentsDir, 'status', 'demo']);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E170');
    const remedyText = [
      envelope.error.message,
      JSON.stringify(envelope.error.details ?? {}),
    ].join(' ');
    expect(remedyText).toContain('--latest');
  });
});
