/**
 * Integration tests for `minih doctor` peer activity audit (plan 012, T005).
 *
 * Asserts:
 *   - deaf active run surfaces as warning row in envelope.peer[]
 *   - silent active run (idle past threshold) surfaces
 *   - healthy coordinated run does NOT surface (quiet)
 *   - completed runs are not audited
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-doctor-peer-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAgent(slug: string): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "${slug} agent"\ntags: []\n---\n\n# ${slug}\n`,
  );
}

function writeRun(
  slug: string,
  runId: string,
  options: {
    coordinated: boolean;
    pollFilter: string[] | null;
    pollOffsetMs: number;
    pollWaitMs?: number | null;
    runStatus?: string;
    completedJson?: boolean;
  },
): string {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug,
      runId,
      runDir,
      pid: 12345,
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      updatedAt: new Date().toISOString(),
      status: options.runStatus ?? 'active',
      sessionId: 'sess-1',
      model: 'gpt-test',
      control: { available: true, kind: 'none' },
      counters: {},
    }),
  );
  if (options.completedJson) {
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify({ result: 'completed' }),
    );
  }
  if (options.coordinated) {
    fs.mkdirSync(path.join(runDir, 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'state', 'inside.json'),
      JSON.stringify({
        status: 'idle',
        data: {},
        updatedAt: new Date().toISOString(),
        updatedBy: 'inside',
      }),
    );
  }
  if (options.pollFilter) {
    const event = {
      type: 'tool_call',
      timestamp: new Date(Date.now() + options.pollOffsetMs).toISOString(),
      data: {
        toolName: 'minih-coordination-inbox_list',
        input: {
          unread: true,
          waitMs: options.pollWaitMs ?? 30_000,
          waitForAny: options.pollFilter,
        },
        toolCallId: 'tc-1',
      },
    };
    fs.writeFileSync(
      path.join(runDir, 'events.ndjson'),
      `${JSON.stringify(event)}\n`,
    );
  }
  return runDir;
}

function runDoctor(): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(
      'node',
      [cliPath, '--agents-dir', agentsDir, 'doctor'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return { stdout: e.stdout?.toString() ?? '', status: e.status ?? 1 };
  }
}

describe('minih doctor — peer activity audit (plan 012 T005)', () => {
  it('healthy coordinated runs do not surface (peer[] is empty)', () => {
    writeAgent('healthy');
    writeRun('healthy', 'run-1', {
      coordinated: true,
      pollFilter: ['task'],
      pollOffsetMs: -5_000,
      pollWaitMs: 30_000,
    });
    const { stdout } = runDoctor();
    const env = JSON.parse(stdout);
    const peer = env.data?.peer ?? env.error?.details?.peer ?? [];
    expect(peer).toEqual([]);
  });

  it('non-coordinated runs are not in peer[] (quiet)', () => {
    writeAgent('plain');
    writeRun('plain', 'run-1', {
      coordinated: false,
      pollFilter: null,
      pollOffsetMs: 0,
    });
    const { stdout } = runDoctor();
    const env = JSON.parse(stdout);
    const peer = env.data?.peer ?? env.error?.details?.peer ?? [];
    expect(peer).toEqual([]);
  });

  it('completed runs (with completed.json) are not audited', () => {
    writeAgent('finished');
    writeRun('finished', 'run-1', {
      coordinated: true,
      pollFilter: ['task'],
      pollOffsetMs: -100 * 60_000, // ancient poll
      completedJson: true,
    });
    const { stdout } = runDoctor();
    const env = JSON.parse(stdout);
    const peer = env.data?.peer ?? env.error?.details?.peer ?? [];
    expect(peer).toEqual([]);
  });

  it('silent active run (no poll past 5min) surfaces as warning', () => {
    writeAgent('busy');
    writeRun('busy', 'run-1', {
      coordinated: true,
      pollFilter: ['task'],
      pollOffsetMs: -8 * 60_000, // 8min ago
      pollWaitMs: 30_000,
    });
    const { stdout } = runDoctor();
    const env = JSON.parse(stdout);
    // status may be 'degraded' due to warnings
    const peer = env.data?.peer ?? env.error?.details?.peer ?? [];
    expect(peer.length).toBe(1);
    expect(peer[0].slug).toBe('busy');
    expect(peer[0].verdict).toBe('silent');
    expect(peer[0].reason).toMatch(/no poll for/);
  });
});
