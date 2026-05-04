/**
 * Plan 018 R2 (T-R2.13) — probe types.
 *
 * Workshop 004 § Q5. Public API for `minih probe` orchestrator + aggregator.
 */

export interface ProbeOutcome {
  name: string;
  outcome: 'succeeded' | 'denied' | 'error' | 'not-attempted';
  reason?: string;
}

/**
 * Per-scenario shape (subset of scenarios.json — agent + aggregator share
 * this contract).
 */
export interface ScenarioDefinition {
  expectedPreset: string;
  permissionsOverride?: string;
  envOverride?: string;
  allowedRootsOnly?: string;
  coordination?: boolean;
  probes: Array<{
    name: string;
    kind: string;
    expected: 'succeeded' | 'denied' | 'error';
  }>;
}

export interface ProbeReport {
  /** Was this report cross-referenced and trusted? */
  trustworthy: boolean;
  /** Why UNTRUSTWORTHY (when trustworthy=false). */
  untrustReasons?: string[];
  /** Scenario name from scenarios.json. */
  scenario: string;
  /** Run ID this probe was for. */
  runId: string;
  /** Was the run terminal-killed by the policy? */
  terminalReason: string | null;
  /** What the agent claimed (untrusted). */
  claimed: {
    presetName: string;
    decisions: Record<string, string>;
    canonicalRoots: string[];
    probes: ProbeOutcome[];
  };
  /** What truth (events.ndjson + run.json) said. */
  truth: {
    permissionDeniedEvents: number;
    permissionDeniedKinds: string[];
    runJsonTerminalReason: string | null;
    runJsonPermissionError: unknown;
  };
  /** PASS = scenario expectations matched truth. */
  verdict: 'PASS' | 'FAIL' | 'UNTRUSTWORTHY';
  /** Brief explanation. */
  message: string;
}

/**
 * Aggregate report across the matrix.
 */
export interface ProbeMatrix {
  generatedAt: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  untrustworthy: number;
  reports: ProbeReport[];
}
