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
  const lines = fs
    .readFileSync(eventsPath, 'utf-8')
    .split('\n')
    .filter(Boolean);
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
 *
 * Two paths:
 *  - Report present: full claim-vs-truth comparison + nonce gate.
 *  - Report missing: truth-only verdict (likely the prober's own write
 *    was blocked by policy — the policy IS working). Mark trustworthy
 *    only when events.ndjson shows enough permission_denied activity to
 *    explain the missing report.
 */
export function aggregateReport(opts: AggregateReportOptions): ProbeReport {
  const truth = readRunJson(opts.runDir);
  const denied = readPermissionDeniedTruth(opts.runDir);
  const reportRaw = readReport(opts.runDir) as {
    nonce?: string;
    claimedPolicy?: {
      presetName?: string;
      decisions?: Record<string, string>;
      canonicalRoots?: string[];
    };
    probes?: ProbeOutcome[];
  } | null;

  const untrustReasons: string[] = [];

  // === Report-missing path ===
  if (reportRaw === null) {
    // The prober didn't (couldn't?) write a report. If events.ndjson shows
    // permission_denied events, the policy was correctly enforced — verdict
    // PASS for any scenario that expects denials.
    const expectedDenialKinds = new Set(
      opts.scenarioDef.probes
        .filter((p) => p.expected === 'denied')
        .map((p) => p.kind),
    );
    const expectedSomeDenials = expectedDenialKinds.size > 0;
    const truthHasDenials =
      denied.count > 0 || truth.terminalReason === 'permission-denied';

    if (expectedSomeDenials && truthHasDenials) {
      return {
        trustworthy: true,
        scenario: opts.scenario,
        runId: opts.runId,
        terminalReason: truth.terminalReason,
        claimed: {
          presetName: 'unobserved',
          decisions: {},
          canonicalRoots: [],
          probes: [],
        },
        truth: {
          permissionDeniedEvents: denied.count,
          permissionDeniedKinds: denied.kinds,
          runJsonTerminalReason: truth.terminalReason,
          runJsonPermissionError: truth.permissionError,
        },
        verdict: 'PASS',
        message: `truth-only verdict (no report — likely write-denied by policy, which is the correct behaviour); ${denied.count} permission_denied events observed for kinds [${denied.kinds.join(', ')}]`,
      };
    }

    // Report missing AND no denials in truth → we can't tell what happened.
    return {
      trustworthy: false,
      untrustReasons: [
        'no report.json + no permission_denied events in events.ndjson — agent silently failed?',
      ],
      scenario: opts.scenario,
      runId: opts.runId,
      terminalReason: truth.terminalReason,
      claimed: {
        presetName: 'unknown',
        decisions: {},
        canonicalRoots: [],
        probes: [],
      },
      truth: {
        permissionDeniedEvents: denied.count,
        permissionDeniedKinds: denied.kinds,
        runJsonTerminalReason: truth.terminalReason,
        runJsonPermissionError: truth.permissionError,
      },
      verdict: 'UNTRUSTWORTHY',
      message: 'no report and no truth-side denial evidence',
    };
  }

  // === Report-present path: full claim-vs-truth with trust gates ===

  // Trust gate 1: nonce match
  if (!reportRaw.nonce) {
    untrustReasons.push('agent did not return a nonce');
  } else if (reportRaw.nonce !== opts.expectedNonce) {
    untrustReasons.push(
      `nonce mismatch (expected ${opts.expectedNonce}, got ${reportRaw.nonce})`,
    );
  }

  // Trust gate 2: claimed denial without truth
  const claimedDeniedCount = (reportRaw.probes ?? []).filter(
    (p) => p.outcome === 'denied',
  ).length;
  if (
    reportRaw.probes &&
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
  const claimedPreset = reportRaw.claimedPolicy?.presetName ?? 'unknown';
  let verdict: 'PASS' | 'FAIL' | 'UNTRUSTWORTHY';
  let message: string;

  if (!trustworthy) {
    verdict = 'UNTRUSTWORTHY';
    message = `cross-reference failed: ${untrustReasons.join('; ')}`;
  } else if (claimedPreset !== opts.scenarioDef.expectedPreset) {
    verdict = 'FAIL';
    message = `expected preset ${opts.scenarioDef.expectedPreset}, claimed ${claimedPreset}`;
  } else {
    // Compare probe outcomes against expected.
    // Companion F003: track which expected probes were attempted.
    // Companion F004: 'error' substitutes only when expected was 'denied' AND
    // truth shows a permission denial (i.e., SDK rejected for permission
    // reasons not other errors).
    const matches: string[] = [];
    const mismatches: string[] = [];
    const claimedNames = new Set(
      (reportRaw.probes ?? []).map((p) => p.name),
    );
    const expectedByName = new Map(
      opts.scenarioDef.probes.map((p) => [p.name, p.expected]),
    );
    // F003: any expected probe missing from the report = mismatch.
    for (const expected of opts.scenarioDef.probes) {
      if (!claimedNames.has(expected.name)) {
        mismatches.push(
          `${expected.name}: expected=${expected.expected} got=not-attempted (probe omitted)`,
        );
      }
    }
    for (const probe of reportRaw.probes ?? []) {
      const expected = expectedByName.get(probe.name);
      if (!expected) continue;
      if (probe.outcome === expected) {
        matches.push(probe.name);
        continue;
      }
      // F004: 'error' is permitted only as a substitute for 'denied' and
      // only when truth shows a permission_denied event (otherwise it's a
      // generic SDK error, not a policy enforcement).
      if (
        probe.outcome === 'error' &&
        expected === 'denied' &&
        denied.count > 0
      ) {
        matches.push(probe.name);
        continue;
      }
      mismatches.push(
        `${probe.name}: expected=${expected} got=${probe.outcome}`,
      );
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
      presetName: reportRaw.claimedPolicy?.presetName ?? 'unknown',
      decisions: reportRaw.claimedPolicy?.decisions ?? {},
      canonicalRoots: reportRaw.claimedPolicy?.canonicalRoots ?? [],
      probes: reportRaw.probes ?? [],
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
