import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assembleDraftFarewell,
  buildDraftFarewell,
  CompanionLedgerError,
  deriveCompanionLedger,
  validateDraftFarewell,
} from '../../src/runner/companion-ledger.js';
import {
  type CoordinationRunLocation,
  coordinationRunDir,
  coordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

/**
 * Plan 027 Phase 4 — AC-8. `deriveCompanionLedger(location)` is a PURE function
 * over the durable inbox/state lanes (no SDK, no spawn). It reuses only the
 * unread/ack MODEL from inbox-poll (`inbox-poll.ts:170-178`), derived over RAW
 * `folder.ts` lanes — NOT the `listUnackedVisible` export (PIC-A).
 *
 * Lane vantage (the inside companion's ledger):
 *   - outside lane = peer -> companion (inbound: task / briefing / directive)
 *   - inside lane  = companion -> peer (ack / finding / summary)
 *   - inside ack.ackOf marks an inbound message as resolved.
 */

let tmpDir: string;
let location: CoordinationRunLocation;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-ledger-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const slug = 'companion';
  fs.mkdirSync(path.join(agentsDir, slug, 'runs', 'run-1'), {
    recursive: true,
  });
  location = coordinationRunLocation(slug, agentsDir, 'run-1');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function appendMsg(lane: 'inside' | 'outside', m: InboxMessage): void {
  const file = inboxLanePath(location, lane);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(m)}\n`);
}

function msg(
  id: string,
  sender: 'inside' | 'outside',
  type: string,
  ts: string,
  extra: Partial<InboxMessage> = {},
): InboxMessage {
  return {
    id,
    sender,
    type,
    subject: `S ${id}`,
    body: `B ${id}`,
    ts,
    ...extra,
  };
}

function writeInsideState(status: string): void {
  const file = stateFilePath(location, 'inside');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      status,
      data: {},
      updatedAt: '2026-06-15T10:05:00.000Z',
      updatedBy: 'inside',
    }),
  );
}

function writePrompt(coordination: 'enabled' | 'disabled'): void {
  const file = path.join(coordinationRunDir(location), 'prompt.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `---\ndescription: "companion"\ncoordination: ${coordination}\n---\nbody\n`,
  );
}

describe('deriveCompanionLedger — empty run', () => {
  it('returns safe defaults when no lanes / state / prompt exist', () => {
    const ledger = deriveCompanionLedger(location, { now: 1_000_000 });
    expect(ledger).toEqual({
      coordinationMode: 'disabled',
      state: null,
      statePublished: false,
      reviewedIds: [],
      ackedIds: [],
      findingsCount: 0,
      summariesCount: 0,
      progressCount: 0,
      unresolvedPeerRequests: 0,
      idleElapsedMs: null,
      lastTaskId: null,
      findings: [],
      ackChains: [],
    });
  });
});

describe('deriveCompanionLedger — full coordination scenario', () => {
  const t0 = '2026-06-15T10:00:00.000Z';
  const t1 = '2026-06-15T10:01:00.000Z';
  const t2 = '2026-06-15T10:02:00.000Z';
  const t3 = '2026-06-15T10:03:00.000Z';

  beforeEach(() => {
    writePrompt('enabled');
    // Inbound (peer -> companion): two review-requests, a directive, a briefing.
    appendMsg('outside', msg('m1', 'outside', 'task', t0));
    appendMsg('outside', msg('m2', 'outside', 'task', t1));
    appendMsg('outside', msg('d1', 'outside', 'directive', t2));
    appendMsg('outside', msg('b1', 'outside', 'briefing', t3));
    // Outbound (companion -> peer): receipt-ack of m1, one finding, and a
    // completion summary acking m1 (the review of m1 is finished).
    appendMsg('inside', msg('a1', 'inside', 'ack', t1, { ackOf: 'm1' }));
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', t2, {
        meta: {
          severity: 'HIGH',
          file: 'src/x.ts',
          category: 'Bug',
          issue: 'boom',
          recommendation: 'fix',
        },
      }),
    );
    appendMsg('inside', msg('s1', 'inside', 'summary', t3, { ackOf: 'm1' }));
    writeInsideState('reviewing');
  });

  it('derives the full lifecycle summary from raw lanes', () => {
    const now = Date.parse(t3) + 60_000;
    const ledger = deriveCompanionLedger(location, { now });

    expect(ledger.coordinationMode).toBe('enabled');
    expect(ledger.state).toBe('reviewing');
    expect(ledger.statePublished).toBe(true);
    // m1 was acked on receipt AND has a completion summary -> reviewed.
    expect(ledger.reviewedIds).toEqual(['m1']);
    expect(ledger.ackedIds).toEqual(['m1']);
    expect(ledger.findingsCount).toBe(1);
    expect(ledger.summariesCount).toBe(1);
    expect(ledger.progressCount).toBe(0);
    // m2 (task) + d1 (directive) are inbound, unacked, not briefing -> 2.
    expect(ledger.unresolvedPeerRequests).toBe(2);
    // idle measured from the most recent inbound ts (t3).
    expect(ledger.idleElapsedMs).toBe(60_000);
    expect(ledger.lastTaskId).toBe('m2');
  });

  it('pins coordinationMode to the binary frontmatter source (PIC-B)', () => {
    writePrompt('disabled');
    const ledger = deriveCompanionLedger(location, { now: Date.parse(t3) });
    expect(ledger.coordinationMode).toBe('disabled');
  });
});

describe('deriveCompanionLedger — corruption convention', () => {
  it('throws CompanionLedgerError on a torn lane line (no silent swallow)', () => {
    appendMsg(
      'outside',
      msg('m1', 'outside', 'task', '2026-06-15T10:00:00.000Z'),
    );
    // Append a torn (non-JSON) line directly.
    fs.appendFileSync(inboxLanePath(location, 'outside'), '{ not json\n');
    expect(() => deriveCompanionLedger(location, { now: 1 })).toThrow(
      CompanionLedgerError,
    );
  });
});

const ta = '2026-06-15T10:00:00.000Z';
const tb = '2026-06-15T10:01:00.000Z';
const tc = '2026-06-15T10:02:00.000Z';

describe('reviewedIds — completion evidence, not receipt (F002)', () => {
  it('counts a task reviewed only when a summary acks it, not on receipt ack', () => {
    writePrompt('enabled');
    appendMsg('outside', msg('t1', 'outside', 'task', ta));
    appendMsg('outside', msg('t2', 'outside', 'task', tb));
    // Both tasks acked on RECEIPT (before review).
    appendMsg('inside', msg('a1', 'inside', 'ack', tb, { ackOf: 't1' }));
    appendMsg('inside', msg('a2', 'inside', 'ack', tb, { ackOf: 't2' }));
    // Only t1 gets a COMPLETION summary.
    appendMsg('inside', msg('s1', 'inside', 'summary', tc, { ackOf: 't1' }));

    const ledger = deriveCompanionLedger(location, { now: 1 });
    expect(ledger.ackedIds).toEqual(['t1', 't2']); // both received
    expect(ledger.reviewedIds).toEqual(['t1']); // only t1 completed
  });
});

describe('findings — body-only parsing + safe-null (F004)', () => {
  it('parses a labelled body-only finding (meta=NONE) instead of empty shells', () => {
    const body = [
      'severity: HIGH',
      'file: src/runner/companion-ledger.ts:180',
      'category: Implementation Quality',
      'issue: toFinding read only meta; body-only findings lost detail.',
      'recommendation: Parse the labelled body as a fallback.',
    ].join('\n');
    appendMsg('inside', msg('f1', 'inside', 'finding', ta, { body }));

    const ledger = deriveCompanionLedger(location, { now: 1 });
    expect(ledger.findings).toEqual([
      {
        severity: 'HIGH',
        file: 'src/runner/companion-ledger.ts:180',
        category: 'Implementation Quality',
        issue: 'toFinding read only meta; body-only findings lost detail.',
        recommendation: 'Parse the labelled body as a fallback.',
      },
    ]);
  });

  it('safe-nulls a finding with no structured content; still counts the message', () => {
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', ta, { body: 'see diff' }),
    );
    const ledger = deriveCompanionLedger(location, { now: 1 });
    expect(ledger.findings).toEqual([]); // no shell persisted
    expect(ledger.findingsCount).toBe(1); // message still counted
  });
});

describe('progressCount → peerUpdatesSent (F003)', () => {
  it('counts inside progress messages and folds them into peerUpdatesSent', () => {
    appendMsg('inside', msg('p1', 'inside', 'progress', ta));
    appendMsg('inside', msg('p2', 'inside', 'progress', tb));
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', tc, {
        meta: {
          severity: 'LOW',
          file: 'a',
          category: 'b',
          issue: 'c',
          recommendation: 'd',
        },
      }),
    );
    appendMsg('inside', msg('s1', 'inside', 'summary', tc));

    const ledger = deriveCompanionLedger(location, { now: 1 });
    expect(ledger.progressCount).toBe(2);
    const draft = assembleDraftFarewell(ledger);
    // 2 progress + 1 finding + 1 summary
    expect(draft.retrospective.coordination.peerUpdatesSent).toBe(4);
  });
});

describe('ackChains — resolved request chains from both lanes (F001)', () => {
  it('links each acked inbound id to its inside responses, in order', () => {
    writePrompt('enabled');
    appendMsg('outside', msg('t1', 'outside', 'task', ta));
    appendMsg('inside', msg('a1', 'inside', 'ack', tb, { ackOf: 't1' }));
    appendMsg('inside', msg('s1', 'inside', 'summary', tc, { ackOf: 't1' }));
    // An ackOf pointing at a non-existent inbound id is ignored.
    appendMsg('inside', msg('x1', 'inside', 'ack', tc, { ackOf: 'ghost' }));

    const ledger = deriveCompanionLedger(location, { now: 1 });
    expect(ledger.ackChains).toEqual([
      {
        inboundId: 't1',
        inboundType: 'task',
        responses: [
          { id: 'a1', type: 'ack' },
          { id: 's1', type: 'summary' },
        ],
      },
    ]);
  });
});

describe('draft farewell — strict validate before write (AC-9, finding 04)', () => {
  it('assembles a draft that passes strict validation (no false-malformed)', () => {
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:00:00.000Z'),
    );
    appendMsg(
      'inside',
      msg('s1', 'inside', 'summary', '2026-06-15T10:01:00.000Z'),
    );
    writeInsideState('reviewing');
    const ledger = deriveCompanionLedger(location, { now: 1 });

    const draft = assembleDraftFarewell(ledger);
    expect(draft.retrospective.coordination.peerUpdatesSent).toBe(2);
    expect(draft.retrospective.coordination.statePublished).toBe(true);
    expect(draft.summary.length).toBeGreaterThanOrEqual(20);
    expect(validateDraftFarewell(draft).valid).toBe(true);
    expect(buildDraftFarewell(ledger)).not.toBeNull();
  });

  it('strict gate rejects a draft missing the coordination block', () => {
    // This object PASSES the permissive system-output.json contract (coordination
    // is optional there) — the strict draft gate is what catches it (finding 04).
    const malformed = {
      summary: 'x'.repeat(25),
      retrospective: {
        workedWell: 'x'.repeat(12),
        confusing: 'x'.repeat(12),
        magicWand: 'x'.repeat(25),
      },
    };
    expect(validateDraftFarewell(malformed).valid).toBe(false);
  });

  it('strict gate rejects junk extra keys (closes additionalProperties:true gap)', () => {
    const base = assembleDraftFarewell(
      deriveCompanionLedger(location, { now: 1 }),
    );
    const junk = { ...base, injectedJunk: 'should not persist' };
    expect(validateDraftFarewell(junk).valid).toBe(false);
  });

  it('buildDraftFarewell safe-nulls an invalid ledger-shaped draft', () => {
    // A negative count must never be offered as a farewell draft.
    const bad = {
      summary: 'x'.repeat(25),
      retrospective: {
        workedWell: 'x'.repeat(12),
        confusing: 'x'.repeat(12),
        magicWand: 'x'.repeat(25),
        coordination: {
          peerUpdatesSent: -1,
          unresolvedPeerRequests: 0,
          statePublished: false,
        },
      },
    };
    expect(validateDraftFarewell(bad).valid).toBe(false);
  });
});

describe('#32 findings home (AC-10 structural)', () => {
  it('derives findings[] from inside finding messages (meta shape)', () => {
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:00:00.000Z', {
        meta: {
          severity: 'HIGH',
          file: 'src/x.ts',
          category: 'Bug',
          issue: 'boom',
          recommendation: 'fix it',
        },
      }),
    );
    const ledger = deriveCompanionLedger(location, { now: 1 });
    expect(ledger.findingsCount).toBe(1);
    expect(ledger.findings).toEqual([
      {
        severity: 'HIGH',
        file: 'src/x.ts',
        category: 'Bug',
        issue: 'boom',
        recommendation: 'fix it',
      },
    ]);
  });

  it('copies derived findings into the draft and they validate against the schema home', () => {
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:00:00.000Z', {
        meta: {
          severity: 'MEDIUM',
          file: 'a',
          category: 'b',
          issue: 'c',
          recommendation: 'd',
        },
      }),
    );
    const ledger = deriveCompanionLedger(location, { now: 1 });
    const draft = buildDraftFarewell(ledger);
    expect(draft).not.toBeNull();
    expect(draft?.findings).toEqual(ledger.findings);
    expect(validateDraftFarewell(draft).valid).toBe(true);
  });

  it('strict gate rejects a malformed finding (missing recommendation)', () => {
    const base = assembleDraftFarewell(
      deriveCompanionLedger(location, { now: 1 }),
    );
    const bad = {
      ...base,
      findings: [{ severity: 'HIGH', file: 'a', category: 'b', issue: 'c' }],
    };
    expect(validateDraftFarewell(bad).valid).toBe(false);
  });
});
