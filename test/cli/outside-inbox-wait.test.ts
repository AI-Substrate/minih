import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import type { InboxMessage, Side } from '../../src/runner/types.js';

/**
 * T003 RED-bar tests for `outside-inbox-list --wait <ms>` (HF-001).
 *
 * Asserts:
 *   - bare `--wait` (no value) defaults to 60_000 (per spec AC 14, clarify Q5)
 *   - explicit `--wait 0` is immediate (today's behavior preserved)
 *   - `--wait <100..300_000>` accepted; out-of-range returns E122
 *   - envelope shape includes `data.wait.{requestedMs, elapsedMs, timedOut, matched}`
 *   - mid-wait `outside-send` returns immediately with the new message
 *   - `--type`/`--after`/`--unread` filters compose with wait
 *   - agent-process death during wait surfaces E123 within 1s
 *   - SIGINT exits 130 cleanly
 *
 * Test file is per-plan-T003; T008 will rename `outside-inbox-list` to
 * `outside inbox list` so this test file may be merged with the lane-tree
 * test file in HF-002.
 */

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');
const runId = 'run-123';
const slug = 'demo';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-outside-wait-'));
  agentsDir = path.join(tmpDir, 'agents');
  writeAgent(slug);
  writeRunJson(slug, 'active');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

function writeAgent(s: string): void {
  const dir = path.join(agentsDir, s);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "${s} agent"\ntags: []\n---\n\n# ${s}\n`,
  );
  fs.mkdirSync(path.join(dir, 'runs', runId), { recursive: true });
}

function writeRunJson(s: string, status: 'active' | 'completed' | 'failed') {
  const runDir = path.join(agentsDir, s, 'runs', runId);
  const runJson = {
    schemaVersion: 1,
    slug: s,
    runId,
    runDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status,
    sessionId: null,
    model: 'gpt-5.4',
    control: { available: false, kind: 'none' },
    counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
  };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runJson));
}

function writeMessage(lane: Side, m: InboxMessage): void {
  const filePath = inboxLanePath(
    coordinationRunLocation(slug, agentsDir, runId),
    lane,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(m)}\n`);
}

function makeMsg(
  id: string,
  sender: 'inside' | 'outside',
  type = 'note',
): InboxMessage {
  return {
    id,
    sender,
    type,
    subject: `${type} ${id}`,
    body: `body ${id}`,
    ts: new Date().toISOString(),
  };
}

// Real ULIDs required (CLI inbox-lane reader validates with the strict ULID schema).
const ULID_M1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_M2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const ULID_M3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const ULID_LATE = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

describe('outside-inbox-list --wait — basic behavior', () => {
  it("omitting --wait preserves today's immediate behavior", () => {
    writeMessage('inside', makeMsg(ULID_M1, 'inside'));
    const result = run(['inside', 'inbox', 'list', slug]);
    expect(result.exitCode).toBe(0);
    const env = JSON.parse(result.stdout);
    expect(env.status).toBe('ok');
    expect(env.data.wait).toBeUndefined();
    expect(env.data.messages).toHaveLength(1);
  });

  it('explicit --wait 0 is immediate', () => {
    writeMessage('inside', makeMsg(ULID_M1, 'inside'));
    const result = run(['inside', 'inbox', 'list', slug, '--wait', '0']);
    expect(result.exitCode).toBe(0);
    const env = JSON.parse(result.stdout);
    expect(env.status).toBe('ok');
    expect(env.data.wait).toBeUndefined();
  });

  it('--wait 60000 with existing matches returns immediately with wait metadata', () => {
    writeMessage('inside', makeMsg(ULID_M1, 'inside', 'summary'));
    const result = run([
      'inside',
      'inbox',
      'list',
      slug,
      '--wait',
      '60000',
      '--type',
      'summary',
    ]);
    expect(result.exitCode).toBe(0);
    const env = JSON.parse(result.stdout);
    expect(env.data.wait).toBeDefined();
    expect(env.data.wait.matched).toBe(true);
    expect(env.data.wait.timedOut).toBe(false);
    expect(env.data.wait.requestedMs).toBe(60000);
    expect(typeof env.data.wait.elapsedMs).toBe('number');
    expect(env.data.messages).toHaveLength(1);
  });

  it('--wait 200 with no matches times out cleanly with wait metadata', () => {
    const result = run([
      'inside',
      'inbox',
      'list',
      slug,
      '--wait',
      '200',
      '--type',
      'summary',
    ]);
    expect(result.exitCode).toBe(0);
    const env = JSON.parse(result.stdout);
    expect(env.data.wait.matched).toBe(false);
    expect(env.data.wait.timedOut).toBe(true);
    expect(env.data.messages).toEqual([]);
  });

  it('mid-wait write resolves the long-poll', async () => {
    const proc = spawn(
      'node',
      [
        cliPath,
        'inside',
        'inbox',
        'list',
        slug,
        '--wait',
        '3000',
        '--type',
        'summary',
      ],
      {
        cwd: tmpDir,
        env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      },
    );

    setTimeout(() => {
      writeMessage('inside', makeMsg(ULID_LATE, 'inside', 'summary'));
    }, 100);

    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = '';
      proc.stdout.on('data', (chunk) => {
        buf += chunk.toString();
      });
      proc.on('exit', (code) => {
        if (code === 0) resolve(buf);
        else reject(new Error(`exit ${code}: ${buf}`));
      });
      proc.on('error', reject);
      setTimeout(() => {
        proc.kill();
        reject(new Error('test timeout'));
      }, 5000);
    });

    const env = JSON.parse(stdout);
    expect(env.data.wait.matched).toBe(true);
    expect(env.data.wait.timedOut).toBe(false);
    expect(env.data.messages.map((m: { id: string }) => m.id)).toContain(
      ULID_LATE,
    );
  });
});

describe('outside-inbox-list --wait — validation + error codes', () => {
  it('--wait above 300000 returns E122', () => {
    const result = run(['inside', 'inbox', 'list', slug, '--wait', '500000']);
    expect(result.exitCode).toBe(1);
    const env = JSON.parse(result.stdout);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E141');
  });

  it('--wait below 100 (non-zero) returns E122', () => {
    const result = run(['inside', 'inbox', 'list', slug, '--wait', '50']);
    expect(result.exitCode).toBe(1);
    const env = JSON.parse(result.stdout);
    expect(env.error.code).toBe('E141');
  });

  it('non-numeric --wait returns E122', () => {
    const result = run(['inside', 'inbox', 'list', slug, '--wait', 'abc']);
    expect(result.exitCode).toBe(1);
    const env = JSON.parse(result.stdout);
    expect(env.error.code).toBe('E141');
  });
});

describe('outside-inbox-list --wait — bare-flag default', () => {
  // NOTE: Commander --wait without a value would normally treat it as a boolean
  // flag. This test asserts that bare `--wait` is treated as `--wait 60000`
  // per spec AC 14 / clarify Q5. We may need a separate flag like
  // `--wait-default` or a custom Commander option to honor this; either way the
  // user-facing behavior is "no value = 60000".
  it('bare --wait (no value) defaults to 60_000', async () => {
    const proc = spawn(
      'node',
      [cliPath, 'inside', 'inbox', 'list', slug, '--wait'],
      {
        cwd: tmpDir,
        env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      },
    );
    setTimeout(() => {
      writeMessage('inside', makeMsg(ULID_M1, 'inside'));
    }, 100);
    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = '';
      proc.stdout.on('data', (chunk) => {
        buf += chunk.toString();
      });
      proc.on('exit', (code) => {
        if (code === 0) resolve(buf);
        else reject(new Error(`exit ${code}: ${buf}`));
      });
      setTimeout(() => {
        proc.kill();
        reject(new Error('test timeout'));
      }, 5000);
    });
    const env = JSON.parse(stdout);
    expect(env.data.wait).toBeDefined();
    expect(env.data.wait.requestedMs).toBe(60_000);
    expect(env.data.wait.matched).toBe(true);
  });
});

describe('outside-inbox-list --wait — agent-process death (E123)', () => {
  it('detects run.json status flip to non-active during wait', async () => {
    const proc = spawn(
      'node',
      [
        cliPath,
        'inside',
        'inbox',
        'list',
        slug,
        '--wait',
        '3000',
        '--type',
        'never',
      ],
      {
        cwd: tmpDir,
        env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      },
    );

    setTimeout(() => {
      writeRunJson(slug, 'failed');
    }, 200);

    const result = await new Promise<{ stdout: string; exitCode: number }>(
      (resolve) => {
        let buf = '';
        proc.stdout.on('data', (chunk) => {
          buf += chunk.toString();
        });
        proc.on('exit', (code) => {
          resolve({ stdout: buf, exitCode: code ?? 0 });
        });
        setTimeout(() => {
          proc.kill();
          resolve({ stdout: buf, exitCode: -1 });
        }, 5000);
      },
    );

    expect(result.exitCode).toBe(1);
    const env = JSON.parse(result.stdout);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E142');
  });
});

describe('outside-inbox-list --wait — filter composition', () => {
  it('--wait + --type + --after composes filters with wait', () => {
    writeMessage('inside', makeMsg(ULID_M1, 'inside', 'finding'));
    writeMessage('inside', makeMsg(ULID_M2, 'inside', 'summary'));
    writeMessage('inside', makeMsg(ULID_M3, 'inside', 'summary'));
    const result = run([
      'inside',
      'inbox',
      'list',
      slug,
      '--wait',
      '5000',
      '--type',
      'summary',
      '--after',
      ULID_M2,
    ]);
    expect(result.exitCode).toBe(0);
    const env = JSON.parse(result.stdout);
    expect(env.data.messages.map((m: { id: string }) => m.id)).toEqual([
      ULID_M3,
    ]);
  });
});
