/**
 * Runner types — data structures for agent definitions, run config, and results.
 *
 * Extracted from: harness/src/agent/types.ts
 * Adapted: Added description + tags to AgentDefinition (frontmatter support).
 *          Removed HarnessEnvelope import.
 */

import type { AgentResult } from '../adapter/events.js';

/** An agent definition discovered from the agents/ folder. */
export interface AgentDefinition {
  slug: string;
  /** One-line description from prompt.md frontmatter */
  description: string;
  /** Tags from prompt.md frontmatter */
  tags: string[];
  /** Default model from prompt.md frontmatter (overridable via --model) */
  model?: string;
  /** Default reasoning effort from prompt.md frontmatter (overridable via --reasoning) */
  reasoning?: string;
  /** Default timeout in seconds from prompt.md frontmatter (overridable via --timeout) */
  timeout?: number;
  dir: string;
  promptPath: string;
  schemaPath: string | null;
  instructionsPath: string | null;
  inputSchemaPath: string | null;
}

/** Configuration for a single agent run. */
export interface AgentRunConfig {
  slug: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  timeout?: number;
  cwd?: string;
  params?: Record<string, string>;
  /** Session ID to resume — if set, uses resumeSession() instead of createSession() */
  sessionId?: string;
  /** Run ID of the original run being resumed */
  resumedFromRunId?: string;
  /** Override the prompt text (used by resume — sends follow-up message instead of prompt.md) */
  promptOverride?: string;
  /** Config directory for MCP auto-discovery (typically project root) */
  configDir?: string;
  /** Explicit MCP servers loaded from --mcp-config file */
  mcpServers?: Record<string, unknown>;
}

/** Validation result from JSON Schema check. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Velocity data computed at run end — tracks compounding improvement per agent. */
export interface VelocityData {
  /** Duration of the previous completed run (null if first run) */
  previousDurationMs: number | null;
  /** % change vs previous run (negative = faster) */
  changePercent: number | null;
  /** Which completed run this is (1-indexed) */
  runNumber: number;
  /** Duration of the first ever completed run */
  firstDurationMs: number | null;
  /** % change from first to current (the big number) */
  overallChangePercent: number | null;
}

/** Parsed report fields extracted from agent output for envelope surfacing. */
export interface ParsedReport {
  summary: string | null;
  magicWand: string | null;
  magicWandTarget: string | null;
  difficulties: Array<{
    category: string;
    description: string;
    workaround: string | null;
    severity: string;
  }> | null;
}

/** Metadata written to completed.json after each run. */
export interface CompletedMetadata {
  slug: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sessionId: string;
  result: 'completed' | 'failed' | 'timeout' | 'degraded';
  exitCode: number;
  validated: boolean | null;
  validationErrors: string[];
  /** Did system output fields (summary + retrospective) pass? */
  systemValidated: boolean;
  /** Did user schema pass? null if no output-schema.json */
  userValidated: boolean | null;
  eventCount: number;
  toolCallCount: number;
  artifacts: string[];
  /** Run ID of the original run, if this is a resumed session */
  resumedFromRunId?: string;
  /** Velocity data — compounding improvement tracking */
  velocity?: VelocityData;
}

/** Result returned from the runner to the CLI command. */
export interface AgentRunResult {
  agentResult: AgentResult;
  metadata: CompletedMetadata;
  validation: ValidationResult | null;
  runDir: string;
  /** Parsed fields from report.json for envelope surfacing */
  parsedReport: ParsedReport | null;
}

/** Events collected during a run, for counting and analysis. */
export interface RunEventStats {
  total: number;
  toolCalls: number;
  toolResults: number;
  messages: number;
  thinking: number;
  errors: number;
}
