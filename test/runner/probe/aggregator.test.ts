/**
 * Plan 018 R2 (T-R2.13) — aggregator unit tests.
 *
 * Verifies trust gates: nonce mismatch, false-claim of denial, etc.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateReport,
  buildMatrix,
} from '../../../src/runner/probe/index.js';
import type { ScenarioDefinition } from '../../../src/runner/probe/types.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-aggregator-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeRunArtifacts(opts: {
  events: Array<{ type: string; data?: unknown }>;
  runJson: { terminalReason?: string | null; permissionError?: unknown };
  report: unknown;
}): string {
  const runDir = path.join(tmp, 'runs', 'test-run');
  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'events.ndjson'),
    `${opts.events.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({ schemaVersion: 1, ...opts.runJson }),
  );
  if (opts.report !== undefined) {
    fs.writeFileSync(
      path.join(runDir, 'output', 'report.json'),
      JSON.stringify(opts.report),
    );
  }
  return runDir;
}

const scenario: ScenarioDefinition = {
  expectedPreset: 'restricted',
  permissionsOverride: 'restricted',
  probes: [
    { name: 'shell whoami', kind: 'shell', expected: 'denied' },
    { name: 'read /etc', kind: 'read', expected: 'denied' },
  ],
};

describe('aggregator — trust gates', () => {
  it('PASS when truth and claim align', () => {
    const runDir = writeRunArtifacts({
      events: [
        { type: 'permission_denied', data: { kind: 'shell' } },
        { type: 'permission_denied', data: { kind: 'read' } },
      ],
      runJson: {
        terminalReason: 'permission-denied',
        permissionError: { kind: 'shell' },
      },
      report: {
        nonce: 'abc12345',
        claimedPolicy: {
          presetName: 'restricted',
          decisions: { shell: 'deny', read: 'deny' },
          canonicalRoots: ['/repo'],
        },
        probes: [
          { name: 'shell whoami', outcome: 'denied' },
          { name: 'read /etc', outcome: 'denied' },
        ],
      },
    });
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'restricted-default',
      scenarioDef: scenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('PASS');
    expect(result.trustworthy).toBe(true);
  });

  it('UNTRUSTWORTHY on nonce mismatch', () => {
    const runDir = writeRunArtifacts({
      events: [],
      runJson: { terminalReason: null },
      report: {
        nonce: 'WRONG',
        claimedPolicy: { presetName: 'restricted' },
        probes: [],
      },
    });
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'x',
      scenarioDef: scenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('UNTRUSTWORTHY');
    expect(result.untrustReasons?.[0]).toMatch(/nonce mismatch/);
  });

  it('UNTRUSTWORTHY when agent fakes denial without events.ndjson backup', () => {
    const runDir = writeRunArtifacts({
      events: [], // no permission_denied events
      runJson: { terminalReason: null },
      report: {
        nonce: 'abc12345',
        claimedPolicy: { presetName: 'restricted' },
        probes: [{ name: 'shell whoami', outcome: 'denied' }],
      },
    });
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'x',
      scenarioDef: scenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('UNTRUSTWORTHY');
    expect(result.untrustReasons?.join(' ')).toMatch(/claims.*denial/);
  });

  it('FAIL when claimed preset does not match expected', () => {
    const runDir = writeRunArtifacts({
      events: [],
      runJson: { terminalReason: null },
      report: {
        nonce: 'abc12345',
        claimedPolicy: { presetName: 'yolo' }, // expected restricted
        probes: [],
      },
    });
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'x',
      scenarioDef: scenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.message).toMatch(/expected preset restricted/);
  });
});

describe('aggregator — companion findings', () => {
  it('F003: FAIL when an expected probe is omitted from the report', () => {
    const runDir = writeRunArtifacts({
      events: [{ type: 'permission_denied', data: { kind: 'shell' } }],
      runJson: { terminalReason: 'permission-denied' },
      report: {
        nonce: 'abc12345',
        claimedPolicy: { presetName: 'restricted' },
        // Only reports 1 of 2 expected probes
        probes: [{ name: 'shell whoami', outcome: 'denied' }],
      },
    });
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'restricted-default',
      scenarioDef: scenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.message).toMatch(/probe omitted|read \/etc.*not-attempted/);
  });

  it('F004: error outcome only matches when expected was denied AND truth confirms denial', () => {
    const runDir = writeRunArtifacts({
      events: [], // NO permission_denied events
      runJson: { terminalReason: null },
      report: {
        nonce: 'abc12345',
        claimedPolicy: { presetName: 'yolo' },
        probes: [
          // expected was 'succeeded' but agent reports 'error' — must FAIL
          {
            name: 'shell whoami',
            outcome: 'error',
          },
        ],
      },
    });
    const yoloScenario: typeof scenario = {
      ...scenario,
      expectedPreset: 'yolo',
      probes: [{ name: 'shell whoami', kind: 'shell', expected: 'succeeded' }],
    };
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'yolo',
      scenarioDef: yoloScenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.message).toMatch(/expected=succeeded got=error/);
  });

  it('F004 cont: error matches denied when truth shows denial', () => {
    const runDir = writeRunArtifacts({
      events: [{ type: 'permission_denied', data: { kind: 'shell' } }],
      runJson: { terminalReason: null },
      report: {
        nonce: 'abc12345',
        claimedPolicy: { presetName: 'restricted' },
        probes: [
          { name: 'shell whoami', outcome: 'error' },
          { name: 'read /etc', outcome: 'denied' },
        ],
      },
    });
    const result = aggregateReport({
      runDir,
      runId: 'test-run',
      scenario: 'restricted-default',
      scenarioDef: scenario,
      expectedNonce: 'abc12345',
    });
    expect(result.verdict).toBe('PASS');
  });
});

describe('buildMatrix', () => {
  it('counts verdicts correctly', () => {
    const reports = [
      { verdict: 'PASS' as const, trustworthy: true } as never,
      { verdict: 'FAIL' as const, trustworthy: true } as never,
      { verdict: 'UNTRUSTWORTHY' as const, trustworthy: false } as never,
      { verdict: 'PASS' as const, trustworthy: true } as never,
    ];
    const matrix = buildMatrix(reports);
    expect(matrix.passed).toBe(2);
    expect(matrix.failed).toBe(1);
    expect(matrix.untrustworthy).toBe(1);
    expect(matrix.totalScenarios).toBe(4);
  });
});
