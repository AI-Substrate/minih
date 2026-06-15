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
      unresolvedPeerRequests: 0,
      idleElapsedMs: null,
      lastTaskId: null,
      findings: [],
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
    // Outbound (companion -> peer): ack of m1, one finding, one summary.
    appendMsg('inside', msg('a1', 'inside', 'ack', t1, { ackOf: 'm1' }));
    appendMsg('inside', msg('f1', 'inside', 'finding', t2));
    appendMsg('inside', msg('s1', 'inside', 'summary', t3));
    writeInsideState('reviewing');
  });

  it('derives the full lifecycle summary from raw lanes', () => {
    const now = Date.parse(t3) + 60_000;
    const ledger = deriveCompanionLedger(location, { now });

    expect(ledger.coordinationMode).toBe('enabled');
    expect(ledger.state).toBe('reviewing');
    expect(ledger.statePublished).toBe(true);
    // m1 is an inbound task that the inside agent acked.
    expect(ledger.reviewedIds).toEqual(['m1']);
    expect(ledger.ackedIds).toEqual(['m1']);
    expect(ledger.findingsCount).toBe(1);
    expect(ledger.summariesCount).toBe(1);
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
