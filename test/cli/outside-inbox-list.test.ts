import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import type { InboxMessage, Side } from '../../src/runner/types.js';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');
const msg1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const msg2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const ack1 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const runId = 'run-123';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-outside-list-'));
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

function writeMessage(lane: Side, message: InboxMessage): void {
  const filePath = inboxLanePath(
    coordinationRunLocation('demo', agentsDir, runId),
    lane,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(message)}\n`);
}

function message(id: string, type: string): InboxMessage {
  return {
    id,
    sender: 'inside',
    type,
    subject: `${type} subject`,
    body: `${type} body`,
    ts: '2026-04-26T00:00:00.000Z',
  };
}

describe('outside-inbox-list', () => {
  it('returns an empty list for a missing inside lane', () => {
    const { stdout, exitCode } = run([
      'outside-inbox-list',
      'demo',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data).toMatchObject({
      slug: 'demo',
      messages: [],
      count: 0,
    });
  });

  it('filters by type and unread via outside ack records', () => {
    writeMessage('inside', message(msg1, 'note'));
    writeMessage('inside', message(msg2, 'status'));
    writeMessage('outside', {
      id: ack1,
      sender: 'outside',
      type: 'ack',
      subject: 'Ack',
      body: 'Acked',
      ts: '2026-04-26T00:00:00.000Z',
      ackOf: msg1,
    });

    const unread = run([
      'outside-inbox-list',
      'demo',
      '--unread',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(JSON.parse(unread.stdout).data.messages).toEqual([
      expect.objectContaining({ id: msg2 }),
    ]);

    const typed = run([
      'outside-inbox-list',
      'demo',
      '--type',
      'status',
      '--unread',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(JSON.parse(typed.stdout).data.messages).toEqual([
      expect.objectContaining({ id: msg2, type: 'status' }),
    ]);
  });

  it('fails loudly for torn and corrupt inbox lanes', () => {
    const insidePath = inboxLanePath(
      coordinationRunLocation('demo', agentsDir, runId),
      'inside',
    );
    fs.mkdirSync(path.dirname(insidePath), { recursive: true });
    fs.writeFileSync(insidePath, '{"id":');

    const torn = run([
      'outside-inbox-list',
      'demo',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(torn.exitCode).toBe(1);
    expect(JSON.parse(torn.stdout).error.code).toBe('E124');

    fs.writeFileSync(insidePath, '{"id":\n');
    const malformed = run([
      'outside-inbox-list',
      'demo',
      '--agents-dir',
      agentsDir,
      '--run',
      runId,
    ]);
    expect(malformed.exitCode).toBe(1);
    expect(JSON.parse(malformed.stdout).error.message).toContain(
      'malformed JSON',
    );
  });
});
