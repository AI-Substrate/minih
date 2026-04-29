/**
 * Integration tests for `outside inbox send` peer block (plan 012, T003).
 *
 * Asserts:
 *   - envelope.data.peer present when run dir has events.ndjson + state/inside.json
 *   - verdict: 'deaf' when filter excludes message type, with 'try one of:' hint
 *   - verdict: 'listening' when polling AND filter matches
 *   - verdict: 'n/a' (or peer omitted) when state/inside.json missing
 *   - --strict-peer exits non-zero (E150 DEAF_PEER) when verdict is 'deaf'
 *   - existing envelope fields (messageId, timestamp, message) unchanged (additivity)
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');
const slug = 'fixture';
const runId = 'run-test';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-outside-peer-'));
  agentsDir = path.join(tmpDir, 'agents');
  writeAgent(slug);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAgent(s: string): void {
  const dir = path.join(agentsDir, s);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "${s} agent"\ntags: []\n---\n\n# ${s}\n`,
  );
  fs.mkdirSync(path.join(dir, 'runs', runId), { recursive: true });
}

function writeRunJson(status = 'active'): void {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug,
      runId,
      runDir,
      pid: 12345,
      startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      updatedAt: new Date().toISOString(),
      status,
      sessionId: 'sess-1',
      model: 'gpt-test',
      control: { available: true, kind: 'none' },
      counters: {},
    }),
  );
}

function writeInsideState(): void {
  const dir = path.join(agentsDir, slug, 'runs', runId, 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'inside.json'),
    JSON.stringify({
      status: 'idle',
      data: {},
      updatedAt: new Date().toISOString(),
      updatedBy: 'inside',
    }),
  );
}

function writePollEvent(filter: string[], offsetMs = -5_000): void {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  const event = {
    type: 'tool_call',
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
    data: {
      toolName: 'minih-coordination-inbox_list',
      input: { unread: true, waitMs: 30_000, waitForAny: filter },
      toolCallId: 'tc-1',
    },
  };
  fs.appendFileSync(
    path.join(runDir, 'events.ndjson'),
    `${JSON.stringify(event)}\n`,
  );
}

function runSend(args: string[] = []): {
  stdout: string;
  stderr: string;
  status: number;
} {
  try {
    const stdout = execFileSync(
      'node',
      [
        cliPath,
        '--agents-dir',
        agentsDir,
        'outside',
        'inbox',
        'send',
        slug,
        '--run',
        runId,
        '--type',
        'task',
        '--subject',
        'test',
        '--body',
        'body',
        ...args,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      status: e.status ?? 1,
    };
  }
}

describe('outside inbox send — peer block (plan 012 T003)', () => {
  it('includes peer block when run is coordinated and events exist', () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['task', 'question']);
    const { stdout, status } = runSend();
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('ok');
    expect(env.data.peer).toBeDefined();
    expect(env.data.peer.verdict).toBe('listening');
    expect(env.data.peer.willMatchType).toBe(true);
    // Existing fields preserved (additivity)
    expect(env.data.messageId).toMatch(/^[A-Z0-9]{26}$/);
    expect(env.data.message.subject).toBe('test');
  });

  it("emits verdict 'deaf' with 'try one of:' hint when filter excludes type", () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['question', 'directive']);
    const { stdout, status } = runSend([
      '--type',
      'review-request',
      '--subject',
      's',
      '--body',
      'b',
    ]);
    // Default: not strict, so still exits 0
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.peer.verdict).toBe('deaf');
    expect(env.data.peer.reason).toContain('try one of:');
    expect(env.data.peer.reason).toMatch(/question/);
    expect(env.data.peer.reason).toMatch(/directive/);
    expect(env.data.peer.willMatchType).toBe(false);
  });

  it('omits peer block when run is not coordination-enabled (no inside.json)', () => {
    writeRunJson();
    // No inside.json
    const { stdout, status } = runSend();
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('ok');
    // peer.verdict is 'n/a' — block IS present but with n/a verdict
    expect(env.data.peer).toBeDefined();
    expect(env.data.peer.verdict).toBe('n/a');
  });

  it("--strict-peer exits E150 AND does not deliver when verdict is 'deaf'", () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['question']);
    const { stdout, status } = runSend([
      '--type',
      'review-request',
      '--subject',
      's',
      '--body',
      'b',
      '--strict-peer',
    ]);
    expect(status).not.toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E150');
    expect(env.error.message).toMatch(/deaf/);
    expect(env.error.details?.peer?.verdict).toBe('deaf');

    // F001 fix: strict-peer must NOT deliver the message. The outside lane
    // file should be empty (no append happened).
    const lanePath = path.join(
      agentsDir,
      slug,
      'runs',
      runId,
      'inbox',
      'outside',
      'messages.ndjson',
    );
    if (fs.existsSync(lanePath)) {
      const content = fs.readFileSync(lanePath, 'utf8');
      expect(content).toBe('');
    }
  });

  it('--strict-peer is a no-op when verdict is not deaf', () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['task']);
    const { stdout, status } = runSend(['--strict-peer']);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.peer.verdict).toBe('listening');
  });
});

// ============================================================================
// T004 — peer block on remaining 4 commands
// ============================================================================

function runCmd(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(
      'node',
      [cliPath, '--agents-dir', agentsDir, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return { stdout: e.stdout?.toString() ?? '', status: e.status ?? 1 };
  }
}

describe('outside state set — peer block (T004)', () => {
  it('includes peer block on success', () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['task', 'question']);
    const { stdout, status } = runCmd([
      'outside',
      'state',
      'set',
      slug,
      '--run',
      runId,
      '--status',
      'in-progress',
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.peer).toBeDefined();
    // messageType: null for state commands → no type-match check
    expect(env.data.peer.willMatchType).toBeNull();
    expect(env.data.peer.verdict).toBe('listening');
    // Existing fields preserved
    expect(env.data.state.status).toBe('in-progress');
  });
});

describe('outside state transition — peer block (T004)', () => {
  it('includes peer block on successful transition', () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['task']);
    // Seed initial state so transition has somewhere to come from
    runCmd([
      'outside',
      'state',
      'set',
      slug,
      '--run',
      runId,
      '--status',
      'idle',
    ]);
    const { stdout, status } = runCmd([
      'outside',
      'state',
      'transition',
      slug,
      '--run',
      runId,
      '--to',
      'in-progress',
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.peer).toBeDefined();
    expect(env.data.peer.willMatchType).toBeNull();
    expect(env.data.transitioned).toBe(true);
    expect(env.data.from).toBe('idle');
    expect(env.data.to).toBe('in-progress');
  });
});

describe('outside retro add — peer block (T004)', () => {
  it("uses messageType='retro' so type-match check applies", () => {
    writeRunJson();
    writeInsideState();
    // Filter excludes 'retro' so verdict should be 'deaf'
    writePollEvent(['task', 'question']);
    const { stdout, status } = runCmd([
      'outside',
      'retro',
      'add',
      slug,
      '--run',
      runId,
      '--body',
      'magicWand: better tooling',
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.peer).toBeDefined();
    expect(env.data.peer.verdict).toBe('deaf');
    expect(env.data.peer.willMatchType).toBe(false);
  });
});

describe('outside inbox list --wait — peer block (T004)', () => {
  it('includes peer block in --wait response (derived post-poll)', async () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['task']);
    // --wait 100 returns quickly with no messages; peer should still be present
    const { stdout, status } = runCmd([
      'outside',
      'inbox',
      'list',
      slug,
      '--run',
      runId,
      '--wait',
      '100',
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.peer).toBeDefined();
    expect(env.data.peer.willMatchType).toBeNull(); // list = read, no type
    // wait envelope present
    expect(env.data.wait).toBeDefined();
  });

  it('does NOT include peer block on bare `list` without --wait', () => {
    writeRunJson();
    writeInsideState();
    writePollEvent(['task']);
    const { stdout, status } = runCmd([
      'outside',
      'inbox',
      'list',
      slug,
      '--run',
      runId,
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    // No peer for plain list — only --wait gets peer per workshop
    expect(env.data.peer).toBeUndefined();
  });
});

// ============================================================================
// T007 (plan 013) — --ack-of accepted for any --type to form reply chains
// ============================================================================

describe('outside inbox send — --ack-of for reply chains (plan 013 T007)', () => {
  function runSendCustom(args: string[]): {
    stdout: string;
    stderr: string;
    status: number;
  } {
    try {
      const stdout = execFileSync(
        'node',
        [cliPath, '--agents-dir', agentsDir, 'outside', 'inbox', 'send', ...args],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return { stdout, stderr: '', status: 0 };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
      return {
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? '',
        status: e.status ?? 1,
      };
    }
  }

  it('AC-1: accepts --ack-of with --type note (non-ack reply)', () => {
    writeRunJson();
    const parentId = '01HXYZXYZXYZXYZXYZXYZXYZAB';
    const { stdout, status } = runSendCustom([
      slug,
      '--run',
      runId,
      '--type',
      'note',
      '--subject',
      'a follow-up',
      '--body',
      'continuing the discussion',
      '--ack-of',
      parentId,
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('ok');
    expect(env.data.message.ackOf).toBe(parentId);
    expect(env.data.message.type).toBe('note');

    // The JSONL file should contain the ackOf field
    const lanePath = path.join(
      agentsDir,
      slug,
      'runs',
      runId,
      'inbox',
      'outside',
      'messages.ndjson',
    );
    const content = fs.readFileSync(lanePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const stored = JSON.parse(lines[0]);
    expect(stored.ackOf).toBe(parentId);
    expect(stored.type).toBe('note');
  });

  it('AC-2: still rejects --type ack without --ack-of', () => {
    writeRunJson();
    const { stdout, status } = runSendCustom([
      slug,
      '--run',
      runId,
      '--type',
      'ack',
      '--subject',
      'ack',
      '--body',
      'ack body',
    ]);
    expect(status).not.toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('error');
    expect(env.error.message).toMatch(/--ack-of is required when --type is ack/);
  });

  it('AC-3: still accepts --type ack with --ack-of (no regression)', () => {
    writeRunJson();
    const parentId = '01HXYZXYZXYZXYZXYZXYZXYZAB';
    const { stdout, status } = runSendCustom([
      slug,
      '--run',
      runId,
      '--type',
      'ack',
      '--subject',
      `Ack: ${parentId}`,
      '--body',
      'acknowledged',
      '--ack-of',
      parentId,
    ]);
    expect(status).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('ok');
    expect(env.data.message.type).toBe('ack');
    expect(env.data.message.ackOf).toBe(parentId);
  });

  it('accepts --ack-of with arbitrary types (question, review, directive)', () => {
    writeRunJson();
    const parentId = '01HXYZXYZXYZXYZXYZXYZXYZAB';
    for (const type of ['question', 'review', 'directive']) {
      const { stdout, status } = runSendCustom([
        slug,
        '--run',
        runId,
        '--type',
        type,
        '--subject',
        `s-${type}`,
        '--body',
        `b-${type}`,
        '--ack-of',
        parentId,
      ]);
      expect(status, `type=${type}`).toBe(0);
      const env = JSON.parse(stdout);
      expect(env.data.message.type).toBe(type);
      expect(env.data.message.ackOf).toBe(parentId);
    }
  });
});
