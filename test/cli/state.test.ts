import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationRunLocation,
  historyPath,
  stateFilePath,
} from '../../src/runner/folder.js';
import type { OutsideState } from '../../src/runner/types.js';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');
const runId = 'run-123';
const otherRunId = 'run-456';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-state-cli-'));
  agentsDir = path.join(tmpDir, 'agents');
  writeAgent('demo');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

function writeAgent(slug: string): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---
description: "${slug} agent"
tags: []
---

# ${slug}
`,
  );
  fs.mkdirSync(path.join(dir, 'runs', runId), { recursive: true });
}

function readOutsideState(targetRunId = runId): OutsideState {
  return JSON.parse(
    fs.readFileSync(stateFilePath(location(targetRunId), 'outside'), 'utf8'),
  ) as OutsideState;
}

function readHistory(): Array<Record<string, unknown>> {
  return fs
    .readFileSync(historyPath(location()), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function location(targetRunId = runId) {
  return coordinationRunLocation('demo', agentsDir, targetRunId);
}

describe('state CLI', () => {
  it('gets both lazy states and returns null for missing keyed reads', () => {
    const { stdout, exitCode } = run([
      'state',
      'get',
      'demo',
      '--key',
      'data.phase',
      '--agents-dir',
      agentsDir,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data).toMatchObject({
      slug: 'demo',
      side: 'both',
      key: 'data.phase',
      outside: null,
      inside: null,
    });
    expect(fs.existsSync(stateFilePath(location(), 'outside'))).toBe(false);
  });

  it('sets outside status, validates schema, and appends history before write', () => {
    const { stdout, exitCode } = run([
      'outside',
      'state',
      'set',
      'demo',
      '--status',
      'done',
      '--agents-dir',
      agentsDir,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data.state).toMatchObject({
      status: 'done',
      data: {},
      updatedBy: 'outside',
    });
    expect(readOutsideState().status).toBe('done');
    const history = readHistory();
    expect(history).toEqual([
      expect.objectContaining({
        side: 'outside',
        from: 'idle',
        to: 'done',
      }),
    ]);
  });

  it('appends history for data-only state set mutations', () => {
    const dataJson = run([
      'outside',
      'state',
      'set',
      'demo',
      '--data-json',
      '{"phase":"review"}',
      '--agents-dir',
      agentsDir,
    ]);
    expect(dataJson.exitCode).toBe(0);

    const keyWrite = run([
      'outside',
      'state',
      'set',
      'demo',
      '--key',
      'data.count',
      '--value-json',
      '2',
      '--agents-dir',
      agentsDir,
    ]);
    expect(keyWrite.exitCode).toBe(0);

    expect(readHistory()).toEqual([
      expect.objectContaining({ side: 'outside', from: 'idle', to: 'idle' }),
      expect.objectContaining({ side: 'outside', from: 'idle', to: 'idle' }),
    ]);
    expect(readOutsideState().data).toEqual({ phase: 'review', count: 2 });
  });

  it('supports key writes and value-json writes under data', () => {
    const phase = run([
      'outside',
      'state',
      'set',
      'demo',
      '--key',
      'data.phase',
      '--value',
      '5',
      '--agents-dir',
      agentsDir,
    ]);
    expect(phase.exitCode).toBe(0);

    const count = run([
      'outside',
      'state',
      'set',
      'demo',
      '--key',
      'data.count',
      '--value-json',
      '3',
      '--agents-dir',
      agentsDir,
    ]);
    expect(count.exitCode).toBe(0);
    expect(readOutsideState().data).toEqual({ phase: '5', count: 3 });
  });

  it('rejects inside writes and invalid JSON as invalid args', () => {
    const inside = run([
      'inside',
      'state',
      'set',
      'demo',
      '--status',
      'done',
      '--agents-dir',
      agentsDir,
    ]);
    expect(inside.exitCode).toBe(1);
    expect(JSON.parse(inside.stdout).error.code).toBe('E143');

    const invalidJson = run([
      'outside',
      'state',
      'set',
      'demo',
      '--data-json',
      '{bad',
      '--agents-dir',
      agentsDir,
    ]);
    expect(invalidJson.exitCode).toBe(1);
    expect(JSON.parse(invalidJson.stdout).error.code).toBe('E108');
  });

  it('transitions outside state and avoids partial writes when history append fails', () => {
    const ok = run([
      'outside',
      'state',
      'transition',
      'demo',
      '--to',
      'in-progress',
      '--reason',
      'started',
      '--data-json',
      '{"task":"T005"}',
      '--agents-dir',
      agentsDir,
    ]);
    expect(ok.exitCode).toBe(0);
    expect(readOutsideState()).toMatchObject({
      status: 'in-progress',
      data: { task: 'T005' },
    });

    const previous = fs.readFileSync(
      stateFilePath(location(), 'outside'),
      'utf8',
    );
    const tooLarge = run([
      'outside',
      'state',
      'transition',
      'demo',
      '--to',
      'done',
      '--reason',
      'x'.repeat(5000),
      '--agents-dir',
      agentsDir,
    ]);
    expect(tooLarge.exitCode).toBe(1);
    expect(JSON.parse(tooLarge.stdout).error.code).toBe('E124');
    expect(fs.readFileSync(stateFilePath(location(), 'outside'), 'utf8')).toBe(
      previous,
    );

    const sameStatusTooLarge = run([
      'outside',
      'state',
      'transition',
      'demo',
      '--to',
      'in-progress',
      '--reason',
      'x'.repeat(5000),
      '--data-json',
      '{"task":"changed"}',
      '--agents-dir',
      agentsDir,
    ]);
    expect(sameStatusTooLarge.exitCode).toBe(1);
    expect(JSON.parse(sameStatusTooLarge.stdout).error.code).toBe('E124');
    expect(fs.readFileSync(stateFilePath(location(), 'outside'), 'utf8')).toBe(
      previous,
    );
  });

  it('prefers an agent-local outside-state schema', () => {
    fs.writeFileSync(
      path.join(agentsDir, 'demo', 'outside-state.schema.json'),
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['status', 'data', 'updatedAt', 'updatedBy'],
        properties: {
          status: { type: 'string', enum: ['idle', 'blocked'] },
          data: { type: 'object' },
          updatedAt: { type: 'string', format: 'date-time' },
          updatedBy: { const: 'outside' },
        },
        additionalProperties: false,
      }),
    );

    const blocked = run([
      'outside',
      'state',
      'transition',
      'demo',
      '--to',
      'blocked',
      '--agents-dir',
      agentsDir,
    ]);
    expect(blocked.exitCode).toBe(0);

    const done = run([
      'outside',
      'state',
      'transition',
      'demo',
      '--to',
      'done',
      '--agents-dir',
      agentsDir,
    ]);
    expect(done.exitCode).toBe(1);
    expect(JSON.parse(done.stdout).error.code).toBe('E108');
  });

  it('keeps outside state isolated between runs of the same agent', () => {
    fs.mkdirSync(path.join(agentsDir, 'demo', 'runs', otherRunId), {
      recursive: true,
    });

    const first = run([
      'outside',
      'state',
      'set',
      'demo',
      '--status',
      'in-progress',
      '--data-json',
      '{"run":"one"}',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    const second = run([
      'outside',
      'state',
      'set',
      'demo',
      '--status',
      'done',
      '--data-json',
      '{"run":"two"}',
      '--agents-dir',
      agentsDir,
      '--run',
      otherRunId,
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(readOutsideState(runId)).toMatchObject({
      status: 'in-progress',
      data: { run: 'one' },
    });
    expect(readOutsideState(otherRunId)).toMatchObject({
      status: 'done',
      data: { run: 'two' },
    });
  });
});
