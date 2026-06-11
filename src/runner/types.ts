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
  /**
   * Parsed `permissions` frontmatter, plan 018 R1. `undefined` when the
   * field is absent (legacy / un-migrated agents); a `PermissionPolicy` when
   * explicit. Resolution to a `ResolvedPolicy` happens at runner entry per
   * AC24 — this is just the raw input.
   */
  permissions?: import('./permissions/policy.js').PermissionPolicy;
}

/** Configuration for a single agent run. */
export interface AgentRunConfig {
  slug: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  timeout?: number;
  cwd?: string;
  params?: Record<string, unknown>;
  /** Session ID to resume — if set, uses resumeSession() instead of createSession() */
  sessionId?: string;
  /** Run ID of the original run being resumed */
  resumedFromRunId?: string;
  /** Resume in place: reuse the original run dir + manifest instead of creating a new run folder. Requires `resumedFromRunId`. */
  resumeInPlace?: boolean;
  /** Eligibility state of the resumed run at takeover (recorded in `run.json.resumes[]`). */
  resumeFromState?: 'active' | 'stale' | 'completed' | 'failed';
  /** Pid of the prior process at takeover (recorded in `run.json.resumes[]`). */
  resumePreviousPid?: number;
  /** Resume kind (recorded in `run.json.resumes[]`). Defaults to 'completed-followup'. */
  resumeKind?: 'takeover' | 'stale-revive' | 'completed-followup';
  /** Override the prompt text (used by resume — sends follow-up message instead of prompt.md) */
  promptOverride?: string;
  /** Config directory for MCP auto-discovery (typically project root) */
  configDir?: string;
  /** Explicit MCP servers loaded from --mcp-config file */
  mcpServers?: Record<string, unknown>;
  /** Resolved SDK-neutral skill directories selected by the CLI. */
  skillDirectories?: string[];
  /** Skill names disabled/excluded by the CLI resolver. */
  disabledSkills?: string[];
  /** Optional human-readable run label persisted for inventory/status views. */
  label?: string;
  /** Bounded/redacted params display metadata persisted for inventory/status views. */
  paramsSummary?: RunParamsSummary;
  /** Optional domain-supplied MCP servers created after runId/runDir are known. */
  insideMcpServerFactory?: (
    context: InsideMcpServerFactoryContext,
  ) => Record<string, unknown>;
  /** Tool-name prefixes reserved by internally supplied MCP servers. */
  reservedMcpToolPrefixes?: string[];
  /**
   * Plan 018 R2 — per-run permission overrides from CLI flags (`--permissions`,
   * `--allowed-roots`, `--allowed-roots-only`, `--strict-fs`).
   *
   * Composed into the `compile()` resolution chain at runner entry. If
   * `permissions.preset` is set, it wins over frontmatter (CLI > frontmatter
   * > sidecar > env > release-default). `allowedRoots` is layered as the
   * top-most layer with the requested mode.
   */
  permissionsOverride?: {
    preset?: import('./permissions/policy.js').PermissionPresetName;
    allowedRoots?: import('./permissions/policy.js').AllowedRootsRule;
    strictFs?: boolean;
    /**
     * FX008-3 — operator opt-out for the coordination-write precondition.
     * Set by `--allow-coord-write-deny` on `minih run`. Per-invocation only;
     * intentionally has no env-var fallback so it can never be silently
     * inherited from a shell config.
     *
     * When `true`, a `coordination: enabled` agent whose resolved policy
     * denies write boots normally (with a stderr deprecation banner).
     * When unset, the precondition fires E205 at boot.
     */
    allowCoordWriteDeny?: boolean;
  };
  /**
   * Optional caller hook invoked when the SDK session is ready and a
   * `SessionSender` is available for same-process writes. Plan 009 Phase 2
   * uses this for the `--human` interactive footer. Coordinated forwarders
   * also fire on `onSessionReady`; this callback runs alongside them.
   *
   * The second argument carries the live runDir/runId so the caller can
   * mount a human-view feed against the run artifacts. FX008 (plan 016)
   * additionally exposes `coordinated` (from frontmatter) and `agentSlug`
   * so callers can mount a coordination-aware InputBridge that routes
   * footer input to the outside inbox lane via `appendInboxMessage`
   * instead of the SDK conversation channel.
   */
  onSessionReady?: (
    sender: import('../adapter/events.js').SessionSender,
    context: {
      runDir: string;
      runId: string;
      coordinated: boolean;
      agentSlug: string;
    },
  ) => void;
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
  magicWandTarget: MagicWandTarget | string | null;
  coordination: RetrospectiveCoordination | null;
  difficulties: Array<{
    category: string;
    description: string;
    workaround: string | null;
    severity: string;
  }> | null;
}

export type MagicWandTarget = 'project' | 'minih' | 'coordination';

export interface RetrospectiveCoordination {
  peerUpdatesSent?: number;
  unresolvedPeerRequests?: number;
  statePublished?: boolean;
  notes?: string;
}

/** Metadata written to completed.json after each run. */
export interface RunParamsSummary {
  schemaVersion: 1;
  display: Record<string, string>;
  truncated: boolean;
  redactedKeys: string[];
  omittedKeys?: string[];
}

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
  /** Optional human-readable run label for inventory/status views. */
  label?: string;
  /** Bounded/redacted params display metadata for inventory/status views. */
  paramsSummary?: RunParamsSummary;
  /**
   * Plan 018 / FX008 — populated when the run failed via the 5-signal
   * permission-denial protocol. Mirrors `LiveRunManifest.permissionError`
   * minus path/request fields. The CLI consumes `permissionError.kind` to
   * route to the appropriate error code (`E200` for SDK-kind denials,
   * `E205` for `'coord-write-deny'`).
   */
  permissionError?: {
    kind: string;
    decision: string;
    message: string;
  };
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
// `Status` is intentionally NOT introduced as a type alias — runtime validation
// (per-agent inside-state.schema.json enum at MCP `state_transition` time, P4)
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

// ===========================================================================
// Human View — Phase 1 (plan 009-human-agent-view)
//
// Live run identity (`run.json`), shared run resolver, and the pure
// `HumanViewModel` reducer contract. These types are the public surface
// Phase 2's CLI renderer will import via `src/runner/index.ts`.
// ===========================================================================

/** Lifecycle status of a live run, written into `run.json`. */
export type LiveRunStatus =
  | 'starting'
  | 'active'
  | 'idle'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'stale';

/**
 * Live run manifest written to `runs/<runId>/run.json` from folder-create
 * onward. Schema-versioned for forward compatibility (workshop 002 §1).
 */
export interface LiveRunManifest {
  schemaVersion: 1;
  slug: string;
  runId: string;
  runDir: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  status: LiveRunStatus;
  sessionId: string | null;
  model: string | null;
  control: {
    available: boolean;
    kind: 'none' | 'file-command-lane';
    commandLanePath?: string;
  };
  /** Optional human-readable run label for inventory/status views. */
  label?: string;
  /** Bounded/redacted params display metadata for inventory/status views. */
  paramsSummary?: RunParamsSummary;
  counters: {
    events: number;
    toolCalls: number;
    messages: number;
    errors: number;
  };
  /** Plan 018 R6 — flipped from `'yolo'` to `'restricted'` per AC-R6.1. */
  /**
   * Plan 018 AC1 — recorded preset and policy snapshot. Mandatory: written
   * immediately after policy resolution so operators / `permission_status`
   * / probe truth surfaces have an audit trail even if the run wedges.
   */
  permissions?: {
    preset: string;
    /**
     * Plan 018 R6 / FX008 — provenance label for `preset`. Captures which
     * resolution layer (frontmatter | sidecar | env | release-default)
     * supplied the preset name. FX008's E205 error message surfaces this
     * to operators so they can fix the right layer.
     *
     * Optional for forward/backward compat: run.json files written before
     * FX008 don't have it. **When absent, readers MUST treat provenance as
     * unknown — do NOT synthesise a fallback label** (a synthesised
     * `'release-default'` could send operators to the wrong remediation
     * layer when the real source was a stale frontmatter or sidecar).
     * Recommended path: fall through to recompile from current sources
     * when this field is absent. See `permission-status.ts` for the
     * canonical implementation pattern.
     */
    presetSource?: 'frontmatter' | 'sidecar' | 'env' | 'release-default';
    canonicalRoots: string[];
    decisions?: Record<string, string>;
    mcpAllowedServers?: string[];
    customToolAllowedNames?: string[];
    strictFs?: boolean;
  };
  /**
   * Plan 018 R1 — recorded once a permission denial fires. Mandatory signal #2
   * of the 5-signal protocol (workshop 002 § Q1).
   */
  terminalReason?: 'permission-denied';
  /**
   * Plan 018 R1 — populated alongside `terminalReason: 'permission-denied'`.
   * Shape mirrors the `permission-error.json` envelope without `meta.contractVersion`
   * (which is implicit at this layer).
   */
  permissionError?: {
    kind: string;
    decision: string;
    occurredAt: string;
    message: string;
    toolName?: string;
    attemptedPath?: string;
    requestId?: string;
    toolCallId?: string;
    policyDigest?: { presetName: string; canonicalRoots: string[] };
  };
  /**
   * Plan 018 R1 — best-effort signals (inside-state, outside-inbox) that
   * failed to write. Captured here per workshop 002 § Q1 (failures recorded,
   * never thrown).
   */
  coordinationSignals?: Array<{ signal: string; error: string }>;
}

/** Mode passed to `resolveRun({ slug, mode })`. */
export type RunResolveMode =
  | { kind: 'by-id'; runId: string }
  | { kind: 'latest-active' }
  | { kind: 'latest-completed' }
  | { kind: 'latest-any' };

/** Liveness as inferred by the resolver. */
export type RunLiveness =
  | 'active'
  | 'stale'
  | 'completed'
  | 'failed'
  | 'unknown';

/** Single resolver diagnostic (e.g., a candidate run with a torn manifest). */
export interface ResolverDiagnostic {
  runId: string;
  message: string;
}

/** Result of a successful `resolveRun(...)` call. */
export interface ResolvedRun {
  slug: string;
  runId: string;
  runDir: string;
  manifest: LiveRunManifest | null;
  completed: CompletedMetadata | null;
  liveness: RunLiveness;
  diagnostics: ResolverDiagnostic[];
}

/** Lightweight candidate descriptor used in `MultipleActiveRunsError`. */
export interface ActiveRunCandidate {
  runId: string;
  startedAt: string;
  sessionId: string | null;
  label?: string;
  paramsSummary?: RunParamsSummary;
}

export interface RunInventoryRow {
  slug: string;
  runId: string;
  liveness: RunLiveness;
  manifestStatus: LiveRunStatus | null;
  result: CompletedMetadata['result'] | null;
  label?: string;
  paramsSummary?: RunParamsSummary;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  pid: number | null;
  model: string | null;
  sessionId: string | null;
  eventCount: number;
  toolCallCount: number;
  diagnostics: ResolverDiagnostic[];
}

export interface RunStatusRow extends RunInventoryRow {
  target: string;
  found: boolean;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// HumanViewModel — Workshop 004 contract.
// Pure reducer output; no I/O on this side. Phase 2 destructures everything
// listed below; do NOT change shape without coordinating downstream.
// ---------------------------------------------------------------------------

/** Header pane projection. */
export interface HumanHeaderView {
  slug: string;
  runId: string;
  sessionId: string | null;
  model: string | null;
  status: 'starting' | 'active' | 'stale' | 'completed' | 'failed' | 'unknown';
  capability: 'starting' | 'input-available' | 'input-read-only' | 'completed';
  elapsedMs: number | null;
  eventCount: number;
  toolCallCount: number;
  unreadCount: number;
}

/** A single transcript row. */
export interface TranscriptEntry {
  id: string;
  ts: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  /** Displayed actor label — outside actor / inside agent / system. */
  actorLabel:
    | 'Outside actor'
    | 'Inside agent'
    | 'Inside agent (thinking)'
    | 'System'
    | 'Error';
  content: string;
  status: 'streaming' | 'final' | 'collapsed' | 'error';
  sourceEventIds: string[];
  messageId: string | null;
}

/** A tool call lifecycle row. */
export interface ToolCallView {
  id: string;
  toolName: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'ok' | 'error';
  inputSummary: string;
  outputSummary: string | null;
  outputTruncated: boolean;
}

/** Inbox entry on the merged coordination timeline. */
export interface InboxTimelineEntry {
  kind: 'inbox';
  id: string;
  ts: string;
  lane: 'outside' | 'inside';
  type: string;
  subject: string;
  bodyPreview: string;
  ackOf: string | null;
  ackState: 'not-ack' | 'acks-other' | 'acked' | 'unacked';
}

/** State transition entry on the timeline. */
export interface StateTransitionTimelineEntry {
  kind: 'state-transition';
  id: string;
  ts: string;
  side: Side;
  from: string;
  to: string;
  reason: string | null;
  peerStatus: string | null;
}

/** Output validation entry on the timeline. */
export interface ValidationTimelineEntry {
  kind: 'validation';
  id: string;
  ts: string;
  valid: boolean;
  errors: string[];
}

/** Future cross-process control entry on the timeline (placeholder). */
export interface ControlTimelineEntry {
  kind: 'control';
  id: string;
  ts: string;
  controlType: string;
  description: string;
}

/** Diagnostic entry on the timeline (degraded source / parse error). */
export interface DiagnosticTimelineEntry {
  kind: 'diagnostic';
  id: string;
  ts: string;
  source: string;
  message: string;
}

/** Discriminated union for the merged coordination timeline. */
export type CoordinationTimelineEntry =
  | InboxTimelineEntry
  | StateTransitionTimelineEntry
  | ValidationTimelineEntry
  | ControlTimelineEntry
  | DiagnosticTimelineEntry;

/** State pane projection (inside/outside snapshots). */
export interface StatePaneView {
  inside: { status: string; updatedAt: string | null } | null;
  outside: { status: string; updatedAt: string | null } | null;
}

/** Output pane projection (output path, validation, recent-write info). */
export interface OutputPaneView {
  outputPath: string | null;
  exists: boolean;
  bytes: number | null;
  lastValidation: ValidationResult | null;
}

/** Input footer projection — drives footer enable/disable + reason. */
export interface InputFooterView {
  enabled: boolean;
  mode:
    | 'same-process'
    | 'attached-read-only'
    | 'attached-control'
    | 'completed';
  disabledReason: string | null;
  draft: string;
  followPaused: boolean;
  pendingCommandCount: number;
}

/** A single view-model diagnostic surfaced in the diagnostics pane. */
export interface ViewDiagnostic {
  source:
    | 'events'
    | 'manifest'
    | 'completed'
    | 'inbox'
    | 'state'
    | 'history'
    | 'output'
    | 'validation';
  message: string;
  /** Optional original line/path/ref for the implementor to chase down. */
  ref?: string;
}

/** Full Workshop 004 top-level model. */
export interface HumanViewModel {
  header: HumanHeaderView;
  transcript: TranscriptEntry[];
  tools: ToolCallView[];
  coordination: CoordinationTimelineEntry[];
  state: StatePaneView;
  output: OutputPaneView;
  input: InputFooterView;
  diagnostics: ViewDiagnostic[];
}

// ---------------------------------------------------------------------------
// Plan 014 — wait_for_any event-wait primitive types.
// Discriminated union over `kind`. Future event sources (fs.changed,
// tool.completed, ...) plug in by extending these unions.
// ---------------------------------------------------------------------------

/** Event kinds supported by `wait_for_any` in v1. */
export type EventKind =
  | 'inbox.message'
  | 'state.peer.changed'
  | 'state.self.changed';

/** A single event-watch registration; discriminated by `kind`. */
export type WatchEntry =
  | { kind: 'inbox.message'; filter?: { types?: string[] } }
  | { kind: 'state.peer.changed' }
  | { kind: 'state.self.changed' };

/** Tagged event envelope returned in WaitForAnyResult.events. */
export type EventEnvelope =
  | {
      kind: 'inbox.message';
      /** Envelope-level delivery timestamp (ISO-8601). Distinct from message.ts. */
      ts: string;
      data: { message: InboxMessage };
    }
  | {
      kind: 'state.peer.changed';
      ts: string;
      data: { newState: SideState };
    }
  | {
      kind: 'state.self.changed';
      ts: string;
      data: { newState: SideState };
    };

/** Result envelope returned by `waitForAny`. */
export interface WaitForAnyResult {
  /** All events fired during the wait window, sorted ascending by `ts`. Empty on clean timeout. */
  events: EventEnvelope[];
  wait: {
    requestedMs: number;
    elapsedMs: number;
    timedOut: boolean;
    matched: boolean;
  };
}
