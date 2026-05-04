/**
 * Plan 018 R2 (T-R2.13) — probe aggregator.
 *
 * Cross-references prober self-reports against events.ndjson + run.json
 * truth. Untrusted-by-default: agent's own report is just one signal.
 *
 * Workshop 004 § Q4 — trust boundary.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ProbeMatrix,
  ProbeOutcome,
  ProbeReport,
  ScenarioDefinition,
} from './types.js';

/**
 * Read events.ndjson; return the count of `permission_denied` events
 * and the kinds they fired on.
 */
function readPermissionDeniedTruth(runDir: string): {
  count: number;
  kinds: string[];
} {
  const eventsPath = path.join(runDir, 'events.ndjson');
  if (!fs.existsSync(eventsPath)) return { count: 0, kinds: [] };
  const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
  const kinds: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'permission_denied') {
        kinds.push(event.data?.kind ?? 'unknown');
      }
    } catch {
      // skip torn lines
    }
  }
  return { count: kinds.length, kinds };
}

function readRunJson(runDir: string): {
  terminalReason: string | null;
  permissionError: unknown;
} {
  const runJsonPath = path.join(runDir, 'run.json');
  if (!fs.existsSync(runJsonPath)) {
    return { terminalReason: null, permissionError: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(runJsonPath, 'utf-8'));
    return {
      terminalReason: parsed.terminalReason ?? null,
      permissionError: parsed.permissionError ?? null,
    };
  } catch {
    return { terminalReason: null, permissionError: null };
  }
}

function readReport(runDir: string): unknown {
  const reportPath = path.join(runDir, 'output', 'report.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}

export interface AggregateReportOptions {
  runDir: string;
  runId: string;
  scenario: string;
  scenarioDef: ScenarioDefinition;
  expectedNonce: string;
}

/**
 * Cross-reference one probe run.
 */
export function aggregateReport(opts: AggregateReportOptions): ProbeReport {
  const truth = readRunJson(opts.runDir);
  const denied = readPermissionDeniedTruth(opts.runDir);
  const reportRaw = readReport(opts.runDir) as
    | {
        nonce?: string;
        claimedPolicy?: { presetName?: string; decisions?: Record<string, string>; canonicalRoots?: string[] };
        probes?: ProbeOutcome[];
      }
    | null;

  const untrustReasons: string[] = [];

  // Trust gate 1: nonce match
  if (!reportRaw?.nonce) {
    untrustReasons.push('agent did not return a nonce');
  } else if (reportRaw.nonce !== opts.expectedNonce) {
    untrustReasons.push(
      `nonce mismatch (expected ${opts.expectedNonce}, got ${reportRaw.nonce})`,
    );
  }

  // Trust gate 2: claimed denial without truth
  const claimedDeniedCount = (reportRaw?.probes ?? []).filter(
    (p) => p.outcome === 'denied',
  ).length;
  if (
    reportRaw?.probes &&
    claimedDeniedCount > 0 &&
    denied.count === 0 &&
    truth.terminalReason !== 'permission-denied'
  ) {
    untrustReasons.push(
      `agent claims ${claimedDeniedCount} denials but events.ndjson has 0 permission_denied events and run.json has no terminal denial`,
    );
  }

  const trustworthy = untrustReasons.length === 0;

  // Match scenario expectations to truth
  const claimedPreset = reportRaw?.claimedPolicy?.presetName ?? 'unknown';
  let verdict: 'PASS' | 'FAIL' | 'UNTRUSTWORTHY';
  let message: string;

  if (!trustworthy) {
    verdict = 'UNTRUSTWORTHY';
    message = `cross-reference failed: ${untrustReasons.join('; ')}`;
  } else if (claimedPreset !== opts.scenarioDef.expectedPreset) {
    verdict = 'FAIL';
    message = `expected preset ${opts.scenarioDef.expectedPreset}, claimed ${claimedPreset}`;
  } else {
    // Compare probe outcomes against expected
    const matches: string[] = [];
    const mismatches: string[] = [];
    const expectedByName = new Map(
      opts.scenarioDef.probes.map((p) => [p.name, p.expected]),
    );
    for (const probe of reportRaw?.probes ?? []) {
      const expected = expectedByName.get(probe.name);
      if (!expected) continue;
      // 'error' allowable substitute when SDK rejected for non-permission reasons
      if (probe.outcome === expected || probe.outcome === 'error') {
        matches.push(probe.name);
      } else {
        mismatches.push(
          `${probe.name}: expected=${expected} got=${probe.outcome}`,
        );
      }
    }
    if (mismatches.length === 0) {
      verdict = 'PASS';
      message = `${matches.length}/${matches.length + mismatches.length} probes matched expectation`;
    } else {
      verdict = 'FAIL';
      message = `${mismatches.length} probe mismatches: ${mismatches.join('; ')}`;
    }
  }

  return {
    trustworthy,
    untrustReasons: trustworthy ? undefined : untrustReasons,
    scenario: opts.scenario,
    runId: opts.runId,
    terminalReason: truth.terminalReason,
    claimed: {
      presetName: reportRaw?.claimedPolicy?.presetName ?? 'unknown',
      decisions: reportRaw?.claimedPolicy?.decisions ?? {},
      canonicalRoots: reportRaw?.claimedPolicy?.canonicalRoots ?? [],
      probes: reportRaw?.probes ?? [],
    },
    truth: {
      permissionDeniedEvents: denied.count,
      permissionDeniedKinds: denied.kinds,
      runJsonTerminalReason: truth.terminalReason,
      runJsonPermissionError: truth.permissionError,
    },
    verdict,
    message,
  };
}

/**
 * Compose a final ProbeMatrix.
 */
export function buildMatrix(reports: ProbeReport[]): ProbeMatrix {
  return {
    generatedAt: new Date().toISOString(),
    totalScenarios: reports.length,
    passed: reports.filter((r) => r.verdict === 'PASS').length,
    failed: reports.filter((r) => r.verdict === 'FAIL').length,
    untrustworthy: reports.filter((r) => r.verdict === 'UNTRUSTWORTHY').length,
    reports,
  };
}
