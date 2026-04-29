/**
 * derivePeerVerdict — pure verdict ladder rule-by-rule.
 *
 * Test matrix mirrors workshop 001 § Test Matrix
 * (docs/plans/012-peer-activity-telemetry/workshops/001-verdict-derivation-rules.md).
 * Every rule path + every precedence boundary.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DerivePeerInputs,
  derivePeerActivity,
  derivePeerVerdict,
} from '../../src/runner/peer-activity.js';

const NOW = 1_700_000_000_000;

function inputs(overrides: Partial<DerivePeerInputs> = {}): DerivePeerInputs {
  return {
    eventsReadFailed: false,
    hasInsideState: true,
    runStatus: 'active',
    runAgeMs: 5 * 60_000,
    lastPollAt: NOW - 10_000,
    lastPollFilter: ['task', 'question', 'directive', 'control'],
    lastPollWaitMs: 30_000,
    pollCadenceMs: 30_000,
    lastSendAt: null,
    lastAckOf: null,
    currentlyRunningTool: null,
    selfReportedState: 'idle',
    selfReportedStateAge: 5_000,
    messageType: 'task',
    now: NOW,
    ...overrides,
  };
}

describe('derivePeerVerdict — decision ladder (workshop 001 § Test Matrix)', () => {
  it('Rule 1 — unknown when events read fails', () => {
    const r = derivePeerVerdict(inputs({ eventsReadFailed: true }));
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toMatch(/events\.ndjson/);
  });

  it('Rule 2 — n/a when no inside state', () => {
    const r = derivePeerVerdict(inputs({ hasInsideState: false }));
    expect(r.verdict).toBe('n/a');
    expect(r.reason).toMatch(/coordination/);
  });

  it('Rule 3 — dead when run.json status is failed', () => {
    const r = derivePeerVerdict(inputs({ runStatus: 'failed' }));
    expect(r.verdict).toBe('dead');
    expect(r.reason).toMatch(/failed/);
  });

  it('Rule 3 — dead when run.json status is completed', () => {
    expect(derivePeerVerdict(inputs({ runStatus: 'completed' })).verdict).toBe(
      'dead',
    );
  });

  it('Rule 3 — dead when run.json status is stale', () => {
    expect(derivePeerVerdict(inputs({ runStatus: 'stale' })).verdict).toBe(
      'dead',
    );
  });

  it('Rule 3 — does NOT fire dead for runStatus "idle" (idle is healthy)', () => {
    const r = derivePeerVerdict(inputs({ runStatus: 'idle' }));
    expect(r.verdict).not.toBe('dead');
  });

  it('Rule 4 — dead when no polls past grace period', () => {
    const r = derivePeerVerdict(inputs({ lastPollAt: null, runAgeMs: 90_000 }));
    expect(r.verdict).toBe('dead');
    expect(r.reason).toMatch(/no inbox_list/);
  });

  it('Rule 5 — dead when last poll >30min ago', () => {
    const r = derivePeerVerdict(inputs({ lastPollAt: NOW - 35 * 60_000 }));
    expect(r.verdict).toBe('dead');
    expect(r.reason).toMatch(/last poll/);
  });

  it('Rule 6 — silent when run just started (in grace period)', () => {
    const r = derivePeerVerdict(inputs({ lastPollAt: null, runAgeMs: 5_000 }));
    expect(r.verdict).toBe('silent');
    expect(r.reason).toMatch(/just started|no inbox_list/);
  });

  it('Rule 7 — silent when idle past threshold (default 5min)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 8 * 60_000,
        lastPollWaitMs: null,
        pollCadenceMs: 30_000,
      }),
    );
    expect(r.verdict).toBe('silent');
    expect(r.reason).toMatch(/no poll for/);
  });

  it('Rule 8 — deaf when filter excludes the sent type', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollFilter: ['task', 'question'],
        messageType: 'review-request',
      }),
    );
    expect(r.verdict).toBe('deaf');
    expect(r.reason).toMatch(/does not include 'review-request'/);
    expect(r.reason).toMatch(/try one of:.*task.*question/);
  });

  it('Rule 9 — listening when polling AND filter matches', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 5_000,
        lastPollWaitMs: 30_000,
        messageType: 'task',
      }),
    );
    expect(r.verdict).toBe('listening');
    expect(r.reason).toMatch(/active poll window/);
  });

  it('Rule 10 — between-polls when healthy and matches (default)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 30_000,
        lastPollWaitMs: null,
        pollCadenceMs: 30_000,
        messageType: 'task',
      }),
    );
    expect(r.verdict).toBe('between-polls');
    expect(r.reason).toMatch(/last poll/);
  });

  it('precedence: silent over deaf when long-idle (rule 7 wins over rule 8)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 8 * 60_000,
        lastPollWaitMs: null,
        pollCadenceMs: 30_000,
        lastPollFilter: ['task', 'question'],
        messageType: 'review-request',
      }),
    );
    expect(r.verdict).toBe('silent');
  });

  it('precedence: dead over silent when run.json says failed', () => {
    const r = derivePeerVerdict(
      inputs({ runStatus: 'failed', lastPollAt: NOW - 8 * 60_000 }),
    );
    expect(r.verdict).toBe('dead');
  });

  it('listening when no messageType (read command — rule 8 skipped)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 5_000,
        lastPollWaitMs: 30_000,
        messageType: null,
      }),
    );
    expect(r.verdict).toBe('listening');
  });
});

describe('computeWillMatch via verdict — defensive cases', () => {
  it('null filter treated as open (matches all)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 5_000,
        lastPollWaitMs: 30_000,
        lastPollFilter: null,
        messageType: 'review-request',
      }),
    );
    expect(r.verdict).toBe('listening');
  });

  it('empty filter treated as open (matches all)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 5_000,
        lastPollWaitMs: 30_000,
        lastPollFilter: [],
        messageType: 'review-request',
      }),
    );
    expect(r.verdict).toBe('listening');
  });

  it('lastPollWaitMs absent → currentlyPolling=false (between-polls path)', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollAt: NOW - 5_000,
        lastPollWaitMs: null,
        pollCadenceMs: 30_000,
        messageType: 'task',
      }),
    );
    expect(r.verdict).toBe('between-polls');
  });
});

describe('verdict reason formatting', () => {
  it('deaf reason includes both excluded type and "try one of:" hint', () => {
    const r = derivePeerVerdict(
      inputs({
        lastPollFilter: ['a', 'b', 'c'],
        messageType: 'x',
      }),
    );
    expect(r.reason).toContain("'x'");
    expect(r.reason).toContain('try one of:');
    expect(r.reason).toContain('a');
    expect(r.reason).toContain('b');
    expect(r.reason).toContain('c');
  });

  it('reason is non-empty for every verdict', () => {
    const allInputs: Array<[string, Partial<DerivePeerInputs>]> = [
      ['unknown', { eventsReadFailed: true }],
      ['n/a', { hasInsideState: false }],
      ['dead', { runStatus: 'failed' }],
      ['silent', { lastPollAt: null, runAgeMs: 5_000 }],
      ['deaf', { lastPollFilter: ['x'], messageType: 'y' }],
      ['listening', { lastPollAt: NOW - 5_000, lastPollWaitMs: 30_000 }],
      [
        'between-polls',
        {
          lastPollAt: NOW - 30_000,
          lastPollWaitMs: null,
          pollCadenceMs: 30_000,
        },
      ],
    ];
    for (const [_label, override] of allInputs) {
      const r = derivePeerVerdict(inputs(override));
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// derivePeerActivity — I/O wrapper + reverse-tail edge cases (workshop §F1-F8)
// ============================================================================

let runDir: string;

beforeEach(() => {
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-activity-'));
});

afterEach(() => {
  fs.rmSync(runDir, { recursive: true, force: true });
});

function writeRunJson(extras: Record<string, unknown> = {}): void {
  const manifest = {
    schemaVersion: 1,
    slug: 'fixture',
    runId: 'run-test',
    runDir,
    pid: 12345,
    startedAt: new Date(NOW - 5 * 60_000).toISOString(),
    updatedAt: new Date(NOW - 1_000).toISOString(),
    status: 'active',
    sessionId: 'sess-1',
    model: 'gpt-test',
    control: { available: true, kind: 'none' },
    counters: {},
    ...extras,
  };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(manifest));
}

function writeInsideState(status = 'idle'): void {
  fs.mkdirSync(path.join(runDir, 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'state', 'inside.json'),
    JSON.stringify({
      status,
      data: {},
      updatedAt: new Date(NOW - 5_000).toISOString(),
      updatedBy: 'inside',
    }),
  );
}

function writeEvents(lines: object[]): void {
  fs.writeFileSync(
    path.join(runDir, 'events.ndjson'),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  );
}

function pollEvent(
  tsOffsetMs: number,
  filter: string[] = ['task'],
  waitMs = 30_000,
) {
  return {
    type: 'tool_call',
    timestamp: new Date(NOW + tsOffsetMs).toISOString(),
    data: {
      toolName: 'minih-coordination-inbox_list',
      input: { unread: true, waitMs, waitForAny: filter },
      toolCallId: `tc-${Math.abs(tsOffsetMs)}`,
    },
  };
}

describe('derivePeerActivity — end-to-end with fixture run dir', () => {
  it('returns n/a when state/inside.json missing', async () => {
    writeRunJson();
    writeEvents([]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('n/a');
  });

  it('returns silent when run just started and no polls', async () => {
    writeRunJson({ startedAt: new Date(NOW - 5_000).toISOString() });
    writeInsideState();
    writeEvents([]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('silent');
  });

  it('returns listening when actively polling and filter matches', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([pollEvent(-5_000, ['task', 'control'])]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('listening');
    expect(r.lastPollFilter).toEqual(['task', 'control']);
    expect(r.lastPollWaitMs).toBe(30_000);
    expect(r.currentlyPolling).toBe(true);
    expect(r.pollWindowEndsAt).toBeTruthy();
  });

  it('returns deaf when filter excludes the type', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([pollEvent(-5_000, ['task', 'question'])]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'review-request',
      now: () => NOW,
    });
    expect(r.verdict).toBe('deaf');
    expect(r.willMatchType).toBe(false);
    expect(r.reason).toMatch(/try one of:.*task.*question/);
  });

  it('computes pollCadenceMs from multiple polls', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([
      pollEvent(-90_000, ['task']),
      pollEvent(-60_000, ['task']),
      pollEvent(-30_000, ['task']),
      pollEvent(-5_000, ['task']),
    ]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    // Deltas: 30000, 30000, 25000 → median 30000
    expect(r.pollCadenceMs).toBe(30_000);
  });

  it('populates currentlyRunningTool with most recent non-coordination tool', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([
      pollEvent(-90_000, ['task']),
      {
        type: 'tool_call',
        timestamp: new Date(NOW - 60_000).toISOString(),
        data: { toolName: 'bash', input: { command: 'ls' } },
      },
      {
        type: 'tool_call',
        timestamp: new Date(NOW - 30_000).toISOString(),
        data: { toolName: 'view', input: { path: '/foo' } },
      },
      pollEvent(-10_000, ['task']),
    ]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.currentlyRunningTool).toBe('view');
  });

  it('tolerates missing events.ndjson (treated as silent in grace period)', async () => {
    writeRunJson({ startedAt: new Date(NOW - 5_000).toISOString() });
    writeInsideState();
    // No events.ndjson written
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('silent');
  });

  it('tolerates torn last line in events.ndjson', async () => {
    writeRunJson();
    writeInsideState();
    const goodEvent = JSON.stringify(pollEvent(-5_000, ['task']));
    fs.writeFileSync(
      path.join(runDir, 'events.ndjson'),
      `${goodEvent}\n{"type":"tool_call","data":{"toolName":"minih-coordi`, // torn
    );
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('listening'); // good event still parsed
  });

  it('tolerates resume / session_start events interleaved with tool_calls', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([
      {
        type: 'session_start',
        timestamp: new Date(NOW - 100_000).toISOString(),
        data: {},
      },
      {
        type: 'resume',
        timestamp: new Date(NOW - 95_000).toISOString(),
        data: {},
      },
      pollEvent(-10_000, ['task']),
    ]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('listening');
  });

  it('returns dead when run.json status is failed', async () => {
    writeRunJson({ status: 'failed' });
    writeInsideState();
    writeEvents([pollEvent(-5_000, ['task'])]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.verdict).toBe('dead');
    expect(r.reason).toMatch(/failed/);
  });

  it('exposes ISO timestamps on lastPollAt / pollWindowEndsAt / lastSendAt', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([
      pollEvent(-5_000, ['task']),
      {
        type: 'tool_call',
        timestamp: new Date(NOW - 7_000).toISOString(),
        data: {
          toolName: 'minih-coordination-inbox_send',
          input: { type: 'progress' },
        },
      },
    ]);
    const r = await derivePeerActivity({
      runDir,
      messageType: 'task',
      now: () => NOW,
    });
    expect(r.lastPollAt).toBe(new Date(NOW - 5_000).toISOString());
    expect(r.lastSendAt).toBe(new Date(NOW - 7_000).toISOString());
    expect(r.pollWindowEndsAt).toBe(
      new Date(NOW - 5_000 + 30_000).toISOString(),
    );
  });

  it('returns listening (not deaf) when messageType is null (read command)', async () => {
    writeRunJson();
    writeInsideState();
    writeEvents([pollEvent(-5_000, ['task', 'question'])]);
    const r = await derivePeerActivity({
      runDir,
      messageType: null,
      now: () => NOW,
    });
    expect(r.verdict).toBe('listening');
    expect(r.willMatchType).toBeNull();
  });
});
