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
  /**
   * Body of `outside.md` if present (raw markdown, frontmatter unparsed —
   * outside.md is plain markdown by design per workshop 008). `''` for
   * present-but-empty file; `undefined` for absent. Truncated to 16KB
   * with a `console.warn` if the file is larger (4KB / 8KB doctor warnings
   * land in P6 task 6.8).
   */
  outsideContract?: string;
  /**
   * Parsed `coordination` frontmatter, always populated (workshop 005:95).
   * Absent / unset → `{ enabled: false }`.
   */
  coordination?: CoordinationFrontmatter;
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
  /** Optional domain-supplied MCP servers created after runId/runDir are known. */
  insideMcpServerFactory?: (
    context: InsideMcpServerFactoryContext,
  ) => Record<string, unknown>;
  /** Tool-name prefixes reserved by internally supplied MCP servers. */
  reservedMcpToolPrefixes?: string[];
}

export interface InsideMcpServerFactoryContext {
  runId: string;
  runDir: string;
  agentSlug: string;
  agentsDir: string;
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

// ---------------------------------------------------------------------------
// Coordination types (Phase 1 — workshop 001 + 005 + 008).
//
// Mirror the JSON schemas under src/schemas/. Drift here cascades to every
// downstream phase — keep types and schemas in lockstep.
//
// `RetrospectiveCoordination` and the `MagicWandTarget` widening to include
// 'coordination' are intentionally NOT defined in P1 — they belong to P6
// alongside the matching schema widening (system-output.json + retrospective.json).
// Defining them in P1 would create type-vs-validator drift.
//
// `Status` is intentionally NOT introduced as a type alias — runtime validation
// (per-agent inside-state.schema.json enum at MCP `state.transition` time, P4)
// is the source of truth. A discriminated union here would re-introduce the
// rule engine workshop 002 down-scoped.
// ---------------------------------------------------------------------------

/** Which side of the outside↔inside coordination boundary. */
export type Side = 'outside' | 'inside';

/** A single inbox message — mirrors `src/schemas/inbox-message.json`. */
export interface InboxMessage {
  /** Crockford-base32 ULID (26 chars). */
  id: string;
  sender: Side;
  /** Free-form short tag (e.g., 'note', 'ack', 'retro'). */
  type: string;
  subject: string;
  body: string;
  /** ISO-8601 date-time. */
  ts: string;
  /** ULID of a message this message acknowledges. */
  ackOf?: string;
  meta?: Record<string, unknown>;
}

/** Outside state — mirrors `src/schemas/outside-state.json`. */
export interface OutsideState {
  /** Author-defined string; default schema enum: idle | in-progress | paused | done | error. */
  status: string;
  data: Record<string, unknown>;
  /** ISO-8601 date-time of the last write. */
  updatedAt: string;
  updatedBy: 'outside';
}

/** Inside state — mirrors `src/schemas/inside-state.json`. */
export interface InsideState {
  /** Author-defined string; default schema enum: idle | in-progress | paused | reviewing | complete | error. */
  status: string;
  data: Record<string, unknown>;
  /** ISO-8601 date-time of the last write. */
  updatedAt: string;
  updatedBy: 'inside';
}

/** Either side's state, discriminated by `updatedBy`. */
export type SideState = OutsideState | InsideState;

/** A single transition entry — mirrors `src/schemas/state-history-entry.json`. */
export interface StateHistoryEntry {
  /** ISO-8601 date-time of the transition. */
  ts: string;
  side: Side;
  from: string;
  to: string;
  reason: string | null;
  peerStateAtTime: { status: string };
}

/**
 * Parsed `coordination` frontmatter field from prompt.md.
 *
 * Always populated by the parser — never omitted (workshop 005:95).
 * String inputs (`enabled` / `disabled`) and the object form normalize to
 * this stable shape; absent → `{ enabled: false }` so consumers can
 * destructure `coordination.enabled` without optional-chaining.
 */
export interface CoordinationFrontmatter {
  enabled: boolean;
  outside?: Record<string, unknown>;
  inside?: Record<string, unknown>;
}
