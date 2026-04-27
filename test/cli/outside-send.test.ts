import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');
const runId = 'run-123';
const otherRunId = 'run-456';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-outside-send-'));
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
    return {
      stdout: String(err.stdout ?? ''),
      exitCode: err.status ?? 1,
    };
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

function readOutsideLane(targetRunId = runId): InboxMessage[] {
  return fs
    .readFileSync(
      inboxLanePath(
        coordinationRunLocation('demo', agentsDir, targetRunId),
        'outside',
      ),
      'utf8',
    )
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as InboxMessage);
}

describe('outside-send', () => {
  it('appends a schema-valid outside-lane message and returns ids', () => {
    const { stdout, exitCode } = run([
      'outside-send',
      'demo',
      '--type',
      'note',
      '--subject',
      'Ready',
      '--body',
      'Please begin.',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope).toMatchObject({
      command: 'outside-send',
      status: 'ok',
      data: { slug: 'demo', target: 'inside' },
    });
    expect(envelope.data.messageId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(readOutsideLane()).toEqual([
      expect.objectContaining({
        id: envelope.data.messageId,
        sender: 'outside',
        type: 'note',
        subject: 'Ready',
        body: 'Please begin.',
      }),
    ]);
  });

  it('keeps outside messages isolated between runs of the same agent', () => {
    fs.mkdirSync(path.join(agentsDir, 'demo', 'runs', otherRunId), {
      recursive: true,
    });

    const first = run([
      'outside-send',
      'demo',
      '--type',
      'note',
      '--subject',
      'Run one',
      '--body',
      'First run.',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    const second = run([
      'outside-send',
      'demo',
      '--type',
      'note',
      '--subject',
      'Run two',
      '--body',
      'Second run.',
      '--agents-dir',
      agentsDir,
      '--run',
      otherRunId,
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(readOutsideLane(runId)).toEqual([
      expect.objectContaining({ subject: 'Run one' }),
    ]);
    expect(readOutsideLane(otherRunId)).toEqual([
      expect.objectContaining({ subject: 'Run two' }),
    ]);
  });

  it('requires and persists --ack-of for ack messages', () => {
    const missing = run([
      'outside-send',
      'demo',
      '--type',
      'ack',
      '--subject',
      'Ack',
      '--body',
      'Acked',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout).error.code).toBe('E108');

    const ackOf = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const sent = run([
      'outside-send',
      'demo',
      '--type',
      'ack',
      '--subject',
      'Ack',
      '--body',
      'Acked',
      '--ack-of',
      ackOf,
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);

    expect(sent.exitCode).toBe(0);
    expect(readOutsideLane()).toEqual([
      expect.objectContaining({ type: 'ack', ackOf }),
    ]);
  });

  it('rejects unknown agents and malformed slugs with envelopes', () => {
    const missing = run([
      'outside-send',
      'missing',
      '--type',
      'note',
      '--subject',
      'Ready',
      '--body',
      'Body',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout).error.code).toBe('E121');

    const badSlug = run([
      'outside-send',
      '../bad',
      '--type',
      'note',
      '--subject',
      'Ready',
      '--body',
      'Body',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(badSlug.exitCode).toBe(1);
    expect(JSON.parse(badSlug.stdout).error.code).toBe('E108');
  });

  it('surfaces schema validation failures as invalid args', () => {
    const result = run([
      'outside-send',
      'demo',
      '--type',
      'note',
      '--subject',
      'Ready',
      '--body',
      'x'.repeat(10001),
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe('E108');
    expect(envelope.error.message).toContain('schema validation');
  });
});
