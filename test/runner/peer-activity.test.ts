/**
 * derivePeerVerdict — pure verdict ladder rule-by-rule.
 *
 * Test matrix mirrors workshop 001 § Test Matrix
 * (docs/plans/012-peer-activity-telemetry/workshops/001-verdict-derivation-rules.md).
 * Every rule path + every precedence boundary.
 */

import { describe, expect, it } from 'vitest';
import {
  type DerivePeerInputs,
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
