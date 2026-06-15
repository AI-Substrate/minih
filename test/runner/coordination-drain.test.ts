import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  drainAndReadInbox,
  reconcileReportFindings,
} from '../../src/runner/coordination-drain.js';
import {
  type CoordinationRunLocation,
  coordinationRunDir,
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

/**
 * Plan 027 Phase 5 — AC-13 / T003. `drainAndReadInbox` re-derives the companion
 * ledger over the RAW live lanes at the pre-report-write point, so a peer
 * message that lands in the shutdown / report-write window is captured rather
 * than stranded. `reconcileReportFindings` then overwrites ONLY
 * `report.findings[]` on the agent-authored report.json (preserving
 * summary/retrospective), validate-before-write (PIC-P5-D/F). A torn lane in the
 * shutdown window is tolerated and never fails the run (PIC-P5-G).
 */

let tmpDir: string;
let location: CoordinationRunLocation;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-drain-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const slug = 'companion';
  fs.mkdirSync(path.join(agentsDir, slug, 'runs', 'run-1'), {
    recursive: true,
  });
  location = coordinationRunLocation(slug, agentsDir, 'run-1');
  writePrompt('enabled');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

function appendMsg(lane: 'inside' | 'outside', m: InboxMessage): void {
  const file = inboxLanePath(location, lane);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(m)}\n`);
}

function writePrompt(coordination: 'enabled' | 'disabled'): void {
  const file = path.join(coordinationRunDir(location), 'prompt.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `---\ndescription: "companion"\ncoordination: ${coordination}\n---\nbody\n`,
  );
}

const FINDING_META = {
  severity: 'HIGH',
  file: 'src/x.ts',
  category: 'Bug',
  issue: 'boom',
  recommendation: 'fix',
};

function writeAgentReport(reportPath: string): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        summary: 'Reviewed the phase.',
        retrospective: {
          wentWell: ['live review'],
          whatStumped: [],
          magicWand: 'a smoke path',
        },
        findings: [],
      },
      null,
      2,
    )}\n`,
  );
}

describe('drainAndReadInbox + reconcileReportFindings (AC-13)', () => {
  it('captures a finding that lands AFTER the report was authored (ordering discriminator)', () => {
    const reportPath = path.join(
      coordinationRunDir(location),
      'output',
      'report.json',
    );
    appendMsg(
      'outside',
      msg('m1', 'outside', 'task', '2026-06-15T10:00:00.000Z'),
    );
    appendMsg(
      'inside',
      msg('a1', 'inside', 'ack', '2026-06-15T10:01:00.000Z', { ackOf: 'm1' }),
    );

    // Agent authors report.json with NO findings (mirrors writing the report
    // before the final review lands).
    writeAgentReport(reportPath);

    // A first drain at author-time sees no findings.
    const early = drainAndReadInbox(location);
    expect(early).not.toBeNull();
    reconcileReportFindings(reportPath, early!);
    expect(JSON.parse(fs.readFileSync(reportPath, 'utf8')).findings).toEqual(
      [],
    );

    // A late finding lands in the shutdown window, AFTER the report was authored.
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:02:00.000Z', {
        meta: FINDING_META,
      }),
    );

    // The drain re-derives over the live lanes → the late finding is captured.
    const drained = drainAndReadInbox(location);
    expect(drained).not.toBeNull();
    const wrote = reconcileReportFindings(reportPath, drained!);
    expect(wrote.wrote).toBe(true);
    expect(wrote.reason).toBe('written');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.findings).toEqual([FINDING_META]);
    // overwrite-ONLY-findings: summary + retrospective preserved verbatim.
    expect(report.summary).toBe('Reviewed the phase.');
    expect(report.retrospective).toEqual({
      wentWell: ['live review'],
      whatStumped: [],
      magicWand: 'a smoke path',
    });
  });

  it('tolerates a torn lane in the shutdown window — returns null, never throws (PIC-P5-G)', () => {
    const reportPath = path.join(
      coordinationRunDir(location),
      'output',
      'report.json',
    );
    writeAgentReport(reportPath);
    // Half-written NDJSON tail (a concurrent write mid-shutdown).
    const lane = inboxLanePath(location, 'inside');
    fs.mkdirSync(path.dirname(lane), { recursive: true });
    fs.writeFileSync(lane, '{ not json\n');

    let drained: ReturnType<typeof drainAndReadInbox>;
    expect(() => {
      drained = drainAndReadInbox(location);
    }).not.toThrow();
    // biome-ignore lint/style/noNonNullAssertion: assigned in the callback above
    expect(drained!).toBeNull();
    // Report left exactly as the agent authored it.
    expect(JSON.parse(fs.readFileSync(reportPath, 'utf8')).findings).toEqual(
      [],
    );
  });

  it('skips an absent report.json (never fabricates an envelope — PIC-P5-F)', () => {
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:02:00.000Z', {
        meta: FINDING_META,
      }),
    );
    const drained = drainAndReadInbox(location);
    const missing = path.join(
      coordinationRunDir(location),
      'output',
      'report.json',
    );
    const outcome = reconcileReportFindings(missing, drained!);
    expect(outcome.wrote).toBe(false);
    expect(outcome.reason).toBe('report-absent');
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('skips an unparseable report.json (leaves the raw fallback untouched)', () => {
    const reportPath = path.join(
      coordinationRunDir(location),
      'output',
      'report.json',
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, 'Agent execution failed: boom\n');
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:02:00.000Z', {
        meta: FINDING_META,
      }),
    );
    const drained = drainAndReadInbox(location);
    const outcome = reconcileReportFindings(reportPath, drained!);
    expect(outcome.wrote).toBe(false);
    expect(outcome.reason).toBe('report-unparseable');
    expect(fs.readFileSync(reportPath, 'utf8')).toBe(
      'Agent execution failed: boom\n',
    );
  });
});
